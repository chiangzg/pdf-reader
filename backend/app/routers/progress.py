"""阅读进度路由：上报 / 恢复。

GET  /api/progress/{paper_id}          → 读取当前用户在该论文的进度
PUT  /api/progress/{paper_id}          → 上报进度（覆盖写，按 user+paper 唯一）

进度字段：mode（overlay/bilingual）、page、scroll_ratio。
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db
from app.models import Paper, Progress, User

router = APIRouter()


class ProgressIn(BaseModel):
    mode: str = Field(default="overlay", pattern="^(overlay|bilingual)$")
    page: int = Field(default=1, ge=1)
    scroll_ratio: float = Field(default=0.0, ge=0.0, le=1.0)


class ProgressOut(BaseModel):
    paper_id: int
    mode: str
    page: int
    scroll_ratio: float
    has_record: bool


@router.get("/{paper_id}", response_model=ProgressOut)
def get_progress(paper_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    paper = db.get(Paper, paper_id)
    if paper is None:
        raise HTTPException(status_code=404, detail="论文不存在")
    prog = db.execute(
        select(Progress).where(Progress.user_id == user.id, Progress.paper_id == paper_id)
    ).scalar_one_or_none()
    if prog is None:
        return ProgressOut(paper_id=paper_id, mode="overlay", page=1, scroll_ratio=0.0, has_record=False)
    return ProgressOut(
        paper_id=paper_id,
        mode=prog.mode,
        page=prog.page,
        scroll_ratio=prog.scroll_ratio,
        has_record=True,
    )


@router.put("/{paper_id}", response_model=ProgressOut)
def upsert_progress(
    paper_id: int,
    payload: ProgressIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    paper = db.get(Paper, paper_id)
    if paper is None:
        raise HTTPException(status_code=404, detail="论文不存在")
    prog = db.execute(
        select(Progress).where(Progress.user_id == user.id, Progress.paper_id == paper_id)
    ).scalar_one_or_none()
    if prog is None:
        prog = Progress(
            user_id=user.id,
            paper_id=paper_id,
            mode=payload.mode,
            page=payload.page,
            scroll_ratio=payload.scroll_ratio,
        )
        db.add(prog)
    else:
        prog.mode = payload.mode
        prog.page = payload.page
        prog.scroll_ratio = payload.scroll_ratio
    db.commit()
    return ProgressOut(
        paper_id=paper_id,
        mode=payload.mode,
        page=payload.page,
        scroll_ratio=payload.scroll_ratio,
        has_record=True,
    )
