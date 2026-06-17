"""pdf2zh 翻译服务客户端。

通过 gradio_client 调用独立的 pdf2zh Gradio 服务（byaidu/pdf2zh 镜像），
生成保留公式/图表/版面的译文 PDF。

pdf2zh 的 /translate_file 端点参数（实测确认）：
  file_type: 'File' | 'Link'
  file_input: 文件（FileData）
  link_input: URL（当 file_type='Link' 时）
  service: 'DeepSeek' / 'OpenAI' / 'Google' / ...（首字母大写）
  lang_from: 'English' / 'Simplified Chinese' / ...（完整语言名）
  lang_to: 同上
  page_range: 'All' / 'First' / 'First 5 pages' / 'Others'

返回（多个 FileData）：
  [0] download_translation_mono  ← 我们要的纯中文 PDF
  [1] document_preview
  [2] download_translation_dual  ← 中英对照 PDF
  ...
"""
from __future__ import annotations

import logging
import shutil
from pathlib import Path

from gradio_client import Client, handle_file

from app.config import Settings

logger = logging.getLogger(__name__)

# pdf2zh 端点名
TRANSLATE_API = "/translate_file"

# 语言名映射（我们用短码，pdf2zh 用完整名）
LANG_MAP = {
    "en": "English",
    "zh": "Simplified Chinese",
    "zh-Hant": "Traditional Chinese",
    "ja": "Japanese",
    "ko": "Korean",
    "fr": "French",
    "de": "German",
    "ru": "Russian",
    "es": "Spanish",
    "it": "Italian",
}


class Pdf2zhClient:
    """封装对 pdf2zh Gradio 服务的调用。"""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._client: Client | None = None

    @property
    def client(self) -> Client:
        """懒加载 Gradio Client。"""
        if self._client is None:
            logger.info("连接 pdf2zh 服务: %s", self.settings.pdf2zh_url)
            self._client = Client(self.settings.pdf2zh_url, verbose=False)
        return self._client

    def translate(self, input_pdf_path: str, output_path: str) -> str:
        """调用 pdf2zh 翻译，返回译文 PDF（mono）的本地路径。

        input_pdf_path: 原始 PDF 路径（本容器内可达）
        output_path: 译文 PDF 持久化目标路径
        返回: output_path

        DeepSeek API Key 通过环境变量 DEEPSEEK_API_KEY 注入 pdf2zh 服务，
        故无需在调用时传 key（pdf2zh 内部读取）。
        """
        c = self.client
        lang_from = LANG_MAP.get(self.settings.pdf2zh_lang_in, self.settings.pdf2zh_lang_in)
        lang_to = LANG_MAP.get(self.settings.pdf2zh_lang_out, self.settings.pdf2zh_lang_out)

        logger.info(
            "触发 pdf2zh 翻译: %s -> %s (service=%s %s->%s)",
            input_pdf_path,
            output_path,
            self.settings.pdf2zh_service,
            lang_from,
            lang_to,
        )

        result = c.predict(
            api_name=TRANSLATE_API,
            file_type="File",
            file_input=handle_file(input_pdf_path),
            link_input="",
            service=self.settings.pdf2zh_service,
            lang_from=lang_from,
            lang_to=lang_to,
            page_range="All",
            page_input="",
            prompt="",
            threads="",
            skip_subset_fonts=False,
            ignore_cache=False,
            vfont="",
            use_babeldoc=True,
            recaptcha_response="",
            progress="",
            param_17="",
            param_18="",
            param_19="",
        )

        # 从返回值提取 mono PDF（第一个文件）
        mono_path = _extract_mono_path(result)
        if mono_path is None:
            raise RuntimeError(f"pdf2zh 返回结果无法解析为文件路径: {_truncate(str(result))}")

        # 复制到持久化目录
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(mono_path, output_path)
        logger.info("译文 PDF 已保存: %s", output_path)
        return output_path


def _extract_mono_path(result) -> str | None:
    """从 /translate_file 返回值提取 mono PDF 文件路径。

    返回结构（实测）：第一个元素是 mono PDF 的 FileData。
    FileData 可能是 dict（含 path/url）或字符串路径。
    """
    if isinstance(result, str):
        return result
    if isinstance(result, (list, tuple)) and result:
        return _file_data_path(result[0])
    return None


def _file_data_path(item) -> str | None:
    """从单个 FileData 项提取 path。"""
    if isinstance(item, str):
        return item
    if isinstance(item, dict):
        return item.get("path") or item.get("url")
    if isinstance(item, (list, tuple)) and item:
        return _file_data_path(item[0])
    return None


def _truncate(s: str, n: int = 300) -> str:
    return s if len(s) <= n else s[:n] + "..."
