"""pdf2zh 翻译服务客户端。

通过 HTTP 调用 pdf2zh 容器内自定义的 FastAPI 翻译服务（server.py），
生成保留公式/图表/版面的译文 PDF。

为什么不用 gradio_client 调 pdf2zh 的 Gradio GUI：
  pdf2zh 自带的 Gradio /translate_file 端点是给浏览器交互设计的，其 *envs
  （翻译器环境变量）经 Gradio 序列化 + special_args 注入后极为脆弱——API 调用者
  被迫为 progress 槽传值，该值会被 gradio 挤进 *envs[0]，导致真实 envs 整体后移、
  base_url 被置空，openai client 报 "Request URL is missing scheme" 并静默跳过段落。

  改为：pdf2zh 容器跑 server.py（直接调 high_level.translate），envs 以 JSON dict
  传递，backend 用 httpx 调 POST /translate。契约见 pdf2zh/server.py。

两个容器通过共享 volume 访问文件：
  - uploads volume：源 PDF（pdf2zh 需只读挂载）
  - translations volume：译文 PDF 输出
路径必须用「pdf2zh 容器内」的视角传递（/app/uploads/...、/app/translations/...），
因两容器把这些 volume 挂载到相同的 /app 路径下，路径可直接复用。
"""
from __future__ import annotations

import logging
import shutil
from pathlib import Path

import httpx

from app.config import Settings

logger = logging.getLogger(__name__)

# FastAPI 端点路径
TRANSLATE_PATH = "/translate"


class Pdf2zhClient:
    """封装对 pdf2zh FastAPI 翻译服务的 HTTP 调用。"""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        # 翻译耗时较长（单篇论文 1-3 分钟），给足超时
        self._timeout = httpx.Timeout(300.0, connect=10.0)

    @property
    def base_url(self) -> str:
        return self.settings.pdf2zh_url.rstrip("/")

    def translate(self, input_pdf_path: str, output_path: str) -> str:
        """调用 pdf2zh 翻译，返回译文 PDF（mono）的本地路径。

        input_pdf_path: 原始 PDF 路径（本容器内可达，且需在 pdf2zh 容器内也可见——
                        因两容器共享 uploads/translations volume，路径一致）
        output_path: 译文 PDF 持久化目标路径（本容器内）
        返回: output_path
        """
        envs = self._build_envs()
        # 译文由 pdf2zh 写到 translations volume，与 backend 共享。
        # 用源文件名作为输出子目录，避免并发翻译互相覆盖。
        src_name = Path(input_pdf_path).stem
        remote_output_dir = f"/app/translations/{src_name}"

        payload = {
            "input_path": input_pdf_path,
            "output_dir": remote_output_dir,
            "lang_in": self.settings.pdf2zh_lang_in,
            "lang_out": self.settings.pdf2zh_lang_out,
            "service": self.settings.pdf2zh_service,
            "envs": envs,
            "threads": 1,
        }

        logger.info(
            "触发 pdf2zh 翻译: %s -> %s (service=%s %s->%s, envs=%s)",
            input_pdf_path,
            output_path,
            self.settings.pdf2zh_service,
            self.settings.pdf2zh_lang_in,
            self.settings.pdf2zh_lang_out,
            _mask_envs(envs),
        )

        url = f"{self.base_url}{TRANSLATE_PATH}"
        try:
            resp = httpx.post(url, json=payload, timeout=self._timeout)
        except httpx.RequestError as e:
            raise RuntimeError(f"无法连接 pdf2zh 翻译服务 ({url}): {e}") from e

        if resp.status_code != 200:
            detail = _safe_detail(resp)
            raise RuntimeError(f"pdf2zh 翻译失败 (HTTP {resp.status_code}): {detail}")

        data = resp.json()
        mono_remote = data.get("mono_path")
        if not mono_remote:
            raise RuntimeError(f"pdf2zh 返回缺少 mono_path: {data}")

        # translations volume 共享：pdf2zh 写入的 mono 文件路径在 backend 同路径可读。
        # 但 backend 期望输出到指定的 output_path，故复制过去。
        if not Path(mono_remote).exists():
            raise RuntimeError(f"译文文件未出现在共享 volume: {mono_remote}")

        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(mono_remote, output_path)
        logger.info("译文 PDF 已保存: %s", output_path)
        return output_path

    def _build_envs(self) -> dict[str, str]:
        """按所选翻译器构造环境变量 dict。

        pdf2zh 的 high_level.translate -> converter 用 envs 覆盖 os.environ 读取的值，
        因此必须显式传入真实值，否则空值会把 base_url/api_key 置空，导致
        openai client 报 "Request URL is missing scheme" 并静默跳过段落。

        仅对 openai / deepseek 注入；其它引擎返回空 dict，
        回退到 pdf2zh 内部从环境变量读取。
        """
        service = self.settings.pdf2zh_service
        base_url = self.settings.openai_base_url
        if service == "openai":
            if not base_url or "://" not in base_url:
                logger.error(
                    "OPENAI_BASE_URL 非法 (%r)，翻译将因缺少 scheme 而失败。"
                    "请检查 DEEPSEEK_BASE_URL 配置。",
                    base_url,
                )
            return {
                "OPENAI_BASE_URL": base_url,
                "OPENAI_API_KEY": self.settings.deepseek_api_key,
                "OPENAI_MODEL": self.settings.deepseek_model,
            }
        if service == "deepseek":
            return {
                "DEEPSEEK_API_KEY": self.settings.deepseek_api_key,
                "DEEPSEEK_MODEL": self.settings.deepseek_model,
            }
        return {}


def _safe_detail(resp: httpx.Response) -> str:
    try:
        return resp.json().get("detail", resp.text[:300])
    except Exception:  # noqa: BLE001
        return resp.text[:300]


def _mask_envs(envs: dict[str, str]) -> dict[str, str]:
    """日志中隐藏 API key：对形如 sk- 开头的值只显示前 6 位 + ***。"""
    masked: dict[str, str] = {}
    for k, v in envs.items():
        if isinstance(v, str) and v.startswith("sk-") and len(v) > 6:
            masked[k] = v[:6] + "***"
        else:
            masked[k] = v
    return masked
