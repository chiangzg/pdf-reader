"""划词 AI 解读历史路由。

GET    /api/highlights/{paper_id}      → 当前用户该论文全部记录（按时间倒序）
POST   /api/highlights/{paper_id}      → 新建一条记录（每次划词都新增）
DELETE /api/highlights/{id}            → 删除单条

说明：
- /api/interpret 保持无状态 SSE 不变；解读完成后由前端调用本路由持久化。
- coords 存 JSON 字符串：[{page,x,y,w,h}, ...]，归一化 0~1，每个矩形带 page（支持跨页）。
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db
from app.models import Highlight, Paper, User

router = APIRouter()


class CoordItem(BaseModel):
    page: int = Field(ge=1)
    x: float = Field(ge=0.0, le=1.0)
    y: float = Field(ge=0.0, le=1.0)
    w: float = Field(ge=0.0, le=1.0)
    h: float = Field(ge=0.0, le=1.0)


class HighlightIn(BaseModel):
    variant: str = Field(pattern="^(original|translated)$")
    text: str = Field(min_length=1, max_length=8000)
    result: str = Field(min_length=1, max_length=20000)
    coords: list[CoordItem] = Field(min_length=1, max_length=200)


class HighlightOut(BaseModel):
    id: int
    paper_id: int
    variant: str
    text: str
    result: str
    coords: list[CoordItem]
    created_at: datetime


def _to_out(h: Highlight) -> HighlightOut:
    import json

    try:
        coords = json.loads(h.coords)
    except (ValueError, TypeError):
        coords = []
    return HighlightOut(
        id=h.id,
        paper_id=h.paper_id,
        variant=h.variant,
        text=h.text,
        result=h.result,
        coords=coords,
        created_at=h.created_at,
    )


@router.get("/{paper_id}", response_model=list[HighlightOut])
def list_highlights(paper_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    paper = db.get(Paper, paper_id)
    if paper is None:
        raise HTTPException(status_code=404, detail="论文不存在")
    rows = db.execute(
        select(Highlight)
        .where(Highlight.user_id == user.id, Highlight.paper_id == paper_id)
        .order_by(Highlight.created_at.desc())
    ).scalars().all()
    return [_to_out(h) for h in rows]


@router.post("/{paper_id}", response_model=HighlightOut)
def create_highlight(
    paper_id: int,
    payload: HighlightIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    paper = db.get(Paper, paper_id)
    if paper is None:
        raise HTTPException(status_code=404, detail="论文不存在")
    import json

    h = Highlight(
        user_id=user.id,
        paper_id=paper_id,
        variant=payload.variant,
        text=payload.text,
        result=payload.result,
        coords=json.dumps([c.model_dump() for c in payload.coords], ensure_ascii=False),
    )
    db.add(h)
    db.commit()
    db.refresh(h)
    return _to_out(h)


@router.delete("/{highlight_id}")
def delete_highlight(highlight_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    h = db.get(Highlight, highlight_id)
    if h is None:
        raise HTTPException(status_code=404, detail="记录不存在")
    if h.user_id != user.id:
        raise HTTPException(status_code=403, detail="无权删除他人记录")
    db.execute(delete(Highlight).where(Highlight.id == highlight_id))
    db.commit()
    return {"ok": True}
