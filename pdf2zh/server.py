"""pdf2zh 翻译服务（FastAPI 包装）。

绕过 pdf2zh 自带的 Gradio GUI——GUI 的 /translate_file 端点是为浏览器交互设计的，
其 *envs（翻译器环境变量）经 Gradio 序列化 + special_args 注入后极为脆弱：
API 调用者被迫为 progress 槽传值，该值会被 gradio 挤进 *envs[0]，导致真实
envs 整体后移、base_url 被置空，openai client 报 "Request URL is missing scheme"。

本服务直接调用 pdf2zh.high_level.translate，envs 以 JSON dict 传递，
彻底消除顺序/错位问题。backend 通过 httpx 调用本服务的 /translate。

契约：
  POST /translate
    body: {input_path, output_dir, lang_in, lang_out, service, envs, prompt?}
    returns: {mono_path, dual_path}
  GET /health
    returns: {status: "ok"}
"""
from __future__ import annotations

import logging
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

# babeldoc 用了 numpy 2.x 已移除的 np.fromstring，Dockerfile 已 patch 为 np.frombuffer
from pdf2zh.doclayout import OnnxModel
from pdf2zh.high_level import translate

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("pdf2zh.server")

# 版面分析 ONNX 模型：进程启动时加载一次（加载耗时数秒，避免每次翻译重复加载）。
# high_level.translate 依赖该模型做版面/段落识别；不传会报
# "'NoneType' object has no attribute 'predict'"。
logger.info("加载 doclayout ONNX 模型...")
DOC_LAYOUT_MODEL = OnnxModel.load_available()
logger.info("doclayout ONNX 模型加载完成")

app = FastAPI(title="pdf2zh translate service")

# 支持的翻译引擎。注意：值必须等于 translator.name（小写），
# 因为 high_level.translate -> converter 用 `service_name == translator.name` 匹配。
# service 格式为 "name" 或 "name:model"（如 "ollama:gemma2:9b"）。
SUPPORTED_SERVICES = {
    "openai",
    "deepseek",
    "openailiked",
    "google",
    "bing",
    "ollama",
    "gemini",
}


class TranslateRequest(BaseModel):
    input_path: str = Field(..., description="容器内可读的源 PDF 绝对路径")
    output_dir: str = Field(..., description="容器内可写的输出目录绝对路径")
    lang_in: str = Field("en", description="源语言代码，如 en")
    lang_out: str = Field("zh", description="目标语言代码，如 zh")
    service: str = Field("OpenAI", description="翻译引擎名（pdf2zh service_map key）")
    envs: dict[str, str] = Field(
        default_factory=dict,
        description=(
            "翻译器环境变量，按 key 传递。例如 OpenAI 引擎："
            '{"OPENAI_BASE_URL": "...", "OPENAI_API_KEY": "...", "OPENAI_MODEL": "..."}。'
            "不提供的 key 由 pdf2zh 内部回退到 os.environ。"
        ),
    )
    prompt: str | None = Field(default=None, description="自定义翻译 prompt（可选）")
    threads: int = Field(default=1, ge=1, description="翻译线程数")


class TranslateResponse(BaseModel):
    mono_path: str = Field(..., description="纯目标语言 PDF 路径")
    dual_path: str = Field(..., description="双语对照 PDF 路径")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/translate", response_model=TranslateResponse)
def do_translate(req: TranslateRequest) -> TranslateResponse:
    src = Path(req.input_path)
    if not src.is_file():
        raise HTTPException(status_code=400, detail=f"输入文件不存在: {req.input_path}")

    if req.service not in SUPPORTED_SERVICES:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的翻译引擎: {req.service}（支持: {sorted(SUPPORTED_SERVICES)}）",
        )

    out_dir = Path(req.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    # 校验 OpenAI 系引擎的 envs 完整性，提前给出明确错误而非让 openai client 静默失败
    if req.service in {"openai", "openailiked"}:
        base_url_key = "OPENAI_BASE_URL" if req.service == "openai" else "OPENAILIKED_BASE_URL"
        base_url = req.envs.get(base_url_key) or os.environ.get(base_url_key)
        if not base_url or "://" not in base_url:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"{base_url_key} 缺失或缺少 http(s):// scheme (got {base_url!r})。"
                    "翻译会因 base_url 为空而静默失败，请检查 envs。"
                ),
            )

    logger.info(
        "开始翻译: %s -> %s (service=%s %s->%s)",
        req.input_path,
        req.output_dir,
        req.service,
        req.lang_in,
        req.lang_out,
    )

    try:
        results = translate(
            files=[str(src)],
            output=str(out_dir),
            lang_in=req.lang_in,
            lang_out=req.lang_out,
            service=req.service,
            envs=req.envs or None,
            thread=req.threads,
            model=DOC_LAYOUT_MODEL,
        )
    except Exception as e:  # noqa: BLE001
        logger.exception("翻译失败: %s", req.input_path)
        raise HTTPException(status_code=500, detail=f"翻译失败: {e}") from e

    if not results:
        raise HTTPException(status_code=500, detail="翻译完成但未生成输出文件")

    mono_path, dual_path = results[0]
    logger.info("翻译完成: mono=%s dual=%s", mono_path, dual_path)
    return TranslateResponse(mono_path=mono_path, dual_path=dual_path)
