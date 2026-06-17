"""论文相关响应模型。"""
from datetime import datetime

from pydantic import BaseModel


class PaperOut(BaseModel):
    id: int
    title: str
    filename: str
    total_pages: int
    created_at: datetime
    translation_status: str = "pending"

    model_config = {"from_attributes": True}


class PaperDetail(PaperOut):
    """论文详情。"""
    translation_error: str | None = None
    translated_at: datetime | None = None


class PaperListOut(BaseModel):
    total: int
    items: list[PaperOut]


class TranslationStatusOut(BaseModel):
    paper_id: int
    status: str  # pending / running / done / failed
    error: str | None = None
