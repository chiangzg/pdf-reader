"""追问路由：在某个解读会话内多轮提问，SSE 流式返回。

POST /api/highlights/{id}/messages  body: {"question": "..."}
返回 text/event-stream，事件协议同 /api/interpret（start/delta/error/done）。

上下文隔离：用 highlight.id 取该会话历史消息，拼成 LLM messages：
  - system：固定「解读导师 prompt + 会话原文」（命中 DeepSeek 上下文缓存以省钱）
  - 历史问答（保留最近 MAX_TURNS 轮防爆成本）
  - 末尾新增 question
落库：流式开始前先存 user 消息；SSE done 后存 assistant 回复。
"""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.deps import get_current_user, get_db
from app.models import Highlight, Message, User
from app.services.interpreter import SYSTEM_PROMPT, Interpreter

router = APIRouter()
settings = get_settings()

# 历史保留最近 N 轮（每轮 = user + assistant，故取 2*N 条消息），平衡成本与连贯
MAX_TURNS = 20


class ChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)


def _sse(event: str, data: str) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _build_llm_messages(highlight: Highlight, history: list[Message], question: str) -> list[dict]:
    """拼 LLM messages：system(原文) + 截断历史 + 新问题。

    system 前缀固定含原文，让 DeepSeek 上下文缓存命中，降低追问成本。
    """
    system_content = (
        f"{SYSTEM_PROMPT}\n\n"
        f"【正在讨论的论文片段】\n{highlight.text}"
    )
    messages: list[dict] = [{"role": "system", "content": system_content}]
    # 保留最近 MAX_TURNS*2 条历史（user/assistant 各算一条），按时间正序
    recent = history[-(MAX_TURNS * 2) :] if len(history) > MAX_TURNS * 2 else history
    for m in recent:
        messages.append({"role": m.role, "content": m.content})
    messages.append({"role": "user", "content": question})
    return messages


@router.post("/{highlight_id}/messages")
def chat(
    highlight_id: int,
    payload: ChatRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    highlight = db.get(Highlight, highlight_id)
    if highlight is None or highlight.user_id != user.id:
        raise HTTPException(status_code=404, detail="会话不存在")

    # 取历史消息（首轮 assistant 解读 + 之前的追问）
    history = (
        db.execute(
            select(Message)
            .where(Message.highlight_id == highlight_id)
            .order_by(Message.created_at.asc())
        )
        .scalars()
        .all()
    )

    llm_messages = _build_llm_messages(highlight, history, payload.question)

    # 流式开始前先存 user 消息（保证追问记录不丢）
    user_msg = Message(highlight_id=highlight_id, role="user", content=payload.question)
    db.add(user_msg)
    db.commit()
    db.refresh(user_msg)

    interpreter = Interpreter(settings)

    def event_stream():
        answer_parts: list[str] = []
        try:
            yield _sse("start", "")
            for chunk in interpreter.chat_stream(llm_messages):
                if chunk:
                    answer_parts.append(chunk)
                    yield _sse("delta", chunk)
            # done 后落库 assistant 回复
            full_answer = "".join(answer_parts)
            if full_answer:
                db.add(Message(highlight_id=highlight_id, role="assistant", content=full_answer))
                db.commit()
            yield _sse("done", "")
        except Exception as e:  # noqa: BLE001
            db.rollback()
            yield _sse("error", str(e)[:500])

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # nginx 不缓冲
        },
    )
