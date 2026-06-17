"""pdf2zh 翻译服务客户端（异步任务模式）。

通过 HTTP 调用 pdf2zh 容器内自定义的 FastAPI 翻译服务（server.py），
生成保留公式/图表/版面的译文 PDF。

为什么不用 gradio_client 调 pdf2zh 的 Gradio GUI：
  pdf2zh 自带的 Gradio /translate_file 端点是给浏览器交互设计的，其 *envs
  （翻译器环境变量）经 Gradio 序列化 + special_args 注入后极为脆弱——API 调用者
  被迫为 progress 槽传值，该值会被 gradio 挤进 *envs[0]，导致真实 envs 整体后移、
  base_url 被置空，openai client 报 "Request URL is missing scheme" 并静默跳过段落。

  改为：pdf2zh 容器跑 server.py（直接调 high_level.translate），envs 以 JSON dict
  传递，backend 用 httpx 调 POST /translate。契约见 pdf2zh/server.py。

== 异步任务模式（根除翻译超时）==

翻译单篇论文耗时数分钟到十几分钟。早期实现用单次 httpx.post 阻塞到翻译完成，
必须把 read timeout 设得比翻译耗时还长（300s 也不够），否则翻译还在跑、
客户端先超时——出现「日志显示成功、页面报超时」的假象。

改为提交 + 轮询：
  POST /translate       提交任务，秒级返回 task_id（pdf2zh 侧后台线程跑翻译）
  GET  /tasks/{task_id} 轮询状态：state / progress / mono_path / error

每次 HTTP 连接都是秒级短请求（提交 30s、轮询 10s、状态现查 5s），天然免疫超时。
progress 由 pdf2zh 的 callback 实时回写，本客户端负责轮询拿结果。

两个容器通过共享 volume 访问文件：
  - uploads volume：源 PDF（pdf2zh 需只读挂载）
  - translations volume：译文 PDF 输出
路径必须用「pdf2zh 容器内」的视角传递（/app/uploads/...、/app/translations/...），
因两容器把这些 volume 挂载到相同的 /app 路径下，路径可直接复用。
"""
from __future__ import annotations

import logging
import shutil
import time
from pathlib import Path

import httpx

from app.config import Settings

logger = logging.getLogger(__name__)

# FastAPI 端点路径
TRANSLATE_PATH = "/translate"
TASKS_PATH = "/tasks"

# task_id 复用规则：pdf2zh 用源 PDF 文件名 stem 作 task_id，
# 与 backend 的 source_hash 保持一致，保证幂等。


class Pdf2zhClient:
    """封装对 pdf2zh FastAPI 翻译服务的 HTTP 调用（提交 + 轮询）。"""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        # 提交/轮询/现查各用独立短超时——绝不再有覆盖整个翻译时长的长连接
        self._submit_timeout = httpx.Timeout(30.0, connect=10.0)
        self._poll_timeout = httpx.Timeout(10.0, connect=5.0)
        self._probe_timeout = httpx.Timeout(5.0, connect=3.0)

    @property
    def base_url(self) -> str:
        return self.settings.pdf2zh_url.rstrip("/")

    # ------------------------------------------------------------------
    # 公开方法
    # ------------------------------------------------------------------
    def translate(self, input_pdf_path: str, output_path: str) -> str:
        """提交翻译任务并轮询至完成，返回译文 PDF（mono）的本地路径。

        input_pdf_path: 原始 PDF 路径（本容器内可达，且需在 pdf2zh 容器内也可见——
                        因两容器共享 uploads/translations volume，路径一致）
        output_path: 译文 PDF 持久化目标路径（本容器内）
        返回: output_path

        流程：submit 拿 task_id → 循环 poll → done 则 copy mono 文件；
        failed 则 raise；poll 404（任务丢失，通常是 pdf2zh 重启）则重新 submit 一次。
        """
        task_id = self._submit(input_pdf_path, output_path)
        self._poll_until_done(task_id, input_pdf_path, output_path, allow_resubmit=True)
        return output_path

    def get_task_status(self, task_id: str) -> dict | None:
        """单次查询任务状态，供 /translation-status 现查 progress。

        task_id 为源 PDF 的 source_hash。pdf2zh 不可达或任务不存在时返回 None，
        绝不抛异常——这是非关键路径，不应阻塞翻译状态查询。
        """
        url = f"{self.base_url}{TASKS_PATH}/{task_id}"
        try:
            resp = httpx.get(url, timeout=self._probe_timeout)
        except httpx.RequestError as e:
            logger.debug("现查翻译进度失败（忽略）: %s", e)
            return None
        if resp.status_code != 200:
            return None
        try:
            return resp.json()
        except ValueError:
            return None

    # ------------------------------------------------------------------
    # 内部：提交
    # ------------------------------------------------------------------
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

    def _submit(self, input_pdf_path: str, output_path: str) -> str:
        """提交翻译任务，返回 task_id。

        译文由 pdf2zh 写到 translations volume，与 backend 共享。
        用源文件名（source_hash）作为输出子目录，避免并发翻译互相覆盖。
        """
        envs = self._build_envs()
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
            "提交 pdf2zh 翻译任务: %s (service=%s %s->%s, envs=%s)",
            input_pdf_path,
            self.settings.pdf2zh_service,
            self.settings.pdf2zh_lang_in,
            self.settings.pdf2zh_lang_out,
            _mask_envs(envs),
        )

        url = f"{self.base_url}{TRANSLATE_PATH}"
        try:
            resp = httpx.post(url, json=payload, timeout=self._submit_timeout)
        except httpx.RequestError as e:
            raise RuntimeError(f"无法连接 pdf2zh 翻译服务 ({url}): {e}") from e

        if resp.status_code not in (200, 202):
            detail = _safe_detail(resp)
            raise RuntimeError(f"pdf2zh 提交翻译失败 (HTTP {resp.status_code}): {detail}")

        data = resp.json()
        task_id = data.get("task_id")
        if not task_id:
            raise RuntimeError(f"pdf2zh 提交响应缺少 task_id: {data}")
        logger.info(
            "翻译任务已提交: task_id=%s state=%s", task_id, data.get("state")
        )
        return task_id

    # ------------------------------------------------------------------
    # 内部：轮询
    # ------------------------------------------------------------------
    def _poll_until_done(
        self,
        task_id: str,
        input_pdf_path: str,
        output_path: str,
        allow_resubmit: bool,
    ) -> None:
        """轮询任务直到 done/failed。

        - done: 从共享 volume copy mono 文件到 output_path
        - failed: raise RuntimeError
        - 404 任务丢失（pdf2zh 重启）：若 allow_resubmit 则重新 submit 一次后继续轮询，
          否则 raise

        output_path 仅在 done 时用到（copy 目标），为保持调用简洁在此传入。
        """
        url = f"{self.base_url}{TASKS_PATH}/{task_id}"
        interval = self.settings.pdf2zh_poll_interval
        last_logged_progress = -1.0

        while True:
            try:
                resp = httpx.get(url, timeout=self._poll_timeout)
            except httpx.RequestError as e:
                # 单次轮询网络错误：等待后重试，不打断整体翻译
                logger.warning("轮询翻译状态失败（将重试）: %s", e)
                time.sleep(interval)
                continue

            if resp.status_code == 404:
                # 任务在 pdf2zh 内存表里消失：容器重启 / 任务被清理
                if allow_resubmit:
                    logger.warning(
                        "翻译任务 %s 在 pdf2zh 侧丢失（可能重启），重新提交一次", task_id
                    )
                    new_task_id = self._submit(input_pdf_path, output_path)
                    # 继续轮询新任务，但不再允许 resubmit，避免无限循环
                    self._poll_until_done(
                        new_task_id, input_pdf_path, output_path, allow_resubmit=False
                    )
                    return
                raise RuntimeError(
                    f"翻译任务 {task_id} 在 pdf2zh 侧丢失且重试提交失败"
                )

            if resp.status_code != 200:
                logger.warning(
                    "轮询翻译状态返回非预期码 HTTP %s，%ss 后重试",
                    resp.status_code,
                    interval,
                )
                time.sleep(interval)
                continue

            data = resp.json()
            state = data.get("state")
            progress = data.get("progress")

            # 进度日志：只在整数百分比变化时打印，避免刷屏
            if isinstance(progress, (int, float)) and progress - last_logged_progress >= 5:
                logger.info("翻译中 task_id=%s 进度=%s%%", task_id, progress)
                last_logged_progress = progress

            if state == "done":
                mono_remote = data.get("mono_path")
                if not mono_remote:
                    raise RuntimeError(f"pdf2zh 任务完成但缺少 mono_path: {data}")
                if not Path(mono_remote).exists():
                    raise RuntimeError(f"译文文件未出现在共享 volume: {mono_remote}")
                Path(output_path).parent.mkdir(parents=True, exist_ok=True)
                shutil.copy(mono_remote, output_path)
                logger.info("译文 PDF 已保存: %s", output_path)
                return

            if state == "failed":
                err = data.get("error") or "未知错误"
                raise RuntimeError(f"pdf2zh 翻译失败: {err}")

            # pending / running：继续轮询
            time.sleep(interval)


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
