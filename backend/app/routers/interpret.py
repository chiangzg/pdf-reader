"""AI 解读路由：对选中文本做学术解读，SSE 流式返回。

POST /api/interpret  body: {"text": "...", "context": "..."}
返回 text/event-stream，每行 data: <增量>\n\n
"""
from __future__ import annotations

import json

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.config import get_settings
from app.services.interpreter import Interpreter

router = APIRouter()
settings = get_settings()


class InterpretRequest(BaseModel):
    text: str = Field(min_length=1, max_length=8000)
    context: str | None = Field(default=None, max_length=2000)


def _sse(event: str, data: str) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/interpret")
def interpret(req: InterpretRequest):
    interpreter = Interpreter(settings)

    def event_stream():
        try:
            yield _sse("start", "")
            for chunk in interpreter.stream(req.text, req.context):
                if chunk:
                    yield _sse("delta", chunk)
            yield _sse("done", "")
        except Exception as e:  # noqa: BLE001
            yield _sse("error", str(e)[:500])

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # nginx 不缓冲
        },
    )
