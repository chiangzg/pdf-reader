"""划词解读会话路由。

会话模型：Highlight = 会话头（原文/坐标/页/variant），Message = 会话消息（首轮解读 + 追问）。
用 highlight.id 作 session id 隔离上下文。

GET    /api/highlights/{paper_id}            → 当前用户该论文全部会话头（按时间倒序）
POST   /api/highlights/{paper_id}            → 一次事务建「会话头 + 首条 assistant 消息」（首轮解读落库）
DELETE /api/highlights/{id}                  → 删除整个会话（CASCADE 删消息）
GET    /api/highlights/{id}/messages         → 该会话全部消息（created_at 升序）

说明：
- /api/interpret 保持无状态 SSE 不变；首轮解读完成后由前端调本路由 POST 落库。
- 追问流式见 routers/chat.py（POST /api/highlights/{id}/messages，body {question}）。
"""
import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db
from app.models import Highlight, Message, Paper, User

router = APIRouter()


class CoordItem(BaseModel):
    page: int = Field(ge=1)
    x: float = Field(ge=0.0, le=1.0)
    y: float = Field(ge=0.0, le=1.0)
    w: float = Field(ge=0.0, le=1.0)
    h: float = Field(ge=0.0, le=1.0)


class HighlightIn(BaseModel):
    """首轮解读落库：建会话头 + 首条 assistant 消息（组合接口，省一次往返）。"""
    variant: str = Field(pattern="^(original|translated)$")
    text: str = Field(min_length=1, max_length=8000)
    coords: list[CoordItem] = Field(min_length=1, max_length=200)
    result: str = Field(min_length=1, max_length=20000, description="首轮解读全文")


class MessageOut(BaseModel):
    id: int
    highlight_id: int
    role: str
    content: str
    created_at: datetime


class HighlightOut(BaseModel):
    id: int
    paper_id: int
    variant: str
    text: str
    coords: list[CoordItem]
    created_at: datetime
    message_count: int = 0
    """末条 assistant 消息预览（截断），供抽屉列表扫读，无则空串"""
    preview: str = ""


def _parse_coords(raw: str) -> list[CoordItem]:
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        return []
    return [CoordItem(**c) for c in data if isinstance(c, dict)]


def _highlight_to_out(h: Highlight, message_count: int = 0, preview: str = "") -> HighlightOut:
    return HighlightOut(
        id=h.id,
        paper_id=h.paper_id,
        variant=h.variant,
        text=h.text,
        coords=_parse_coords(h.coords),
        created_at=h.created_at,
        message_count=message_count,
        preview=preview,
    )


def _preview_of(content: str, limit: int = 80) -> str:
    """取末条预览：去 markdown 加粗符号、折叠空白、截断。"""
    s = content.replace("**", "").strip()
    s = " ".join(s.split())
    return s[:limit]


def _load_counts_and_previews(db: Session, highlight_ids: list[int]) -> dict[int, tuple[int, str]]:
    """批量取各会话的消息数 + 末条 assistant 预览。返回 {highlight_id: (count, preview)}。"""
    out: dict[int, tuple[int, str]] = {hid: (0, "") for hid in highlight_ids}
    if not highlight_ids:
        return out
    # 消息数
    count_rows = (
        db.execute(
            select(Message.highlight_id)
            .where(Message.highlight_id.in_(highlight_ids))
        )
        .all()
    )
    counts: dict[int, int] = {}
    for (hid,) in count_rows:
        counts[hid] = counts.get(hid, 0) + 1
    # 末条 assistant：取每个会话 created_at 最大的 assistant 消息
    # 简化：拉这些会话的所有 assistant 消息，内存里按会话取最新
    rows = (
        db.execute(
            select(Message)
            .where(Message.highlight_id.in_(highlight_ids), Message.role == "assistant")
            .order_by(Message.created_at.asc())
        )
        .scalars()
        .all()
    )
    latest: dict[int, Message] = {}
    for m in rows:
        latest[m.highlight_id] = m  # 升序遍历，最后留下即最新
    for hid in highlight_ids:
        preview = _preview_of(latest[hid].content) if hid in latest else ""
        out[hid] = (counts.get(hid, 0), preview)
    return out


def _get_owned_highlight(db: Session, highlight_id: int, user: User) -> Highlight:
    """取会话并校验归属当前用户，否则 404/403。"""
    h = db.get(Highlight, highlight_id)
    if h is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    if h.user_id != user.id:
        # 统一返回 404，避免泄露存在性
        raise HTTPException(status_code=404, detail="会话不存在")
    return h


@router.get("/{paper_id}", response_model=list[HighlightOut])
def list_highlights(paper_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    paper = db.get(Paper, paper_id)
    if paper is None:
        raise HTTPException(status_code=404, detail="论文不存在")
    rows = (
        db.execute(
            select(Highlight)
            .where(Highlight.user_id == user.id, Highlight.paper_id == paper_id)
            .order_by(Highlight.created_at.desc())
        )
        .scalars()
        .all()
    )
    meta = _load_counts_and_previews(db, [r.id for r in rows])
    return [_highlight_to_out(h, *meta.get(h.id, (0, ""))) for h in rows]


@router.post("/{paper_id}", response_model=HighlightOut)
def create_highlight(
    paper_id: int,
    payload: HighlightIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """首轮解读落库：一次事务建「会话头 + 首条 assistant 消息」。"""
    paper = db.get(Paper, paper_id)
    if paper is None:
        raise HTTPException(status_code=404, detail="论文不存在")
    h = Highlight(
        user_id=user.id,
        paper_id=paper_id,
        variant=payload.variant,
        text=payload.text,
        coords=json.dumps([c.model_dump() for c in payload.coords], ensure_ascii=False),
    )
    db.add(h)
    db.flush()  # 拿到 h.id
    db.add(
        Message(
            highlight_id=h.id,
            role="assistant",
            content=payload.result,
        )
    )
    db.commit()
    db.refresh(h)
    return _highlight_to_out(h, message_count=1, preview=_preview_of(payload.result))


@router.delete("/{highlight_id}")
def delete_highlight(highlight_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _get_owned_highlight(db, highlight_id, user)
    db.execute(delete(Highlight).where(Highlight.id == highlight_id))
    db.commit()
    return {"ok": True}


@router.get("/{highlight_id}/messages", response_model=list[MessageOut])
def list_messages(
    highlight_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """返回该会话全部消息（created_at 升序），用于前端重建对话上下文。"""
    _get_owned_highlight(db, highlight_id, user)
    rows = (
        db.execute(
            select(Message)
            .where(Message.highlight_id == highlight_id)
            .order_by(Message.created_at.asc())
        )
        .scalars()
        .all()
    )
    return [
        MessageOut(
            id=m.id,
            highlight_id=m.highlight_id,
            role=m.role,
            content=m.content,
            created_at=m.created_at,
        )
        for m in rows
    ]
