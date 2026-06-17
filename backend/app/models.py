"""ORM 模型。

表设计：
- users          用户
- papers         论文（按 source_hash 去重，归属用户；含翻译状态与译文 PDF 路径）
- progress       阅读进度（user+paper 唯一）

翻译由独立的 pdf2zh 服务生成译文 PDF 文件，不再做段落级文本提取。
"""
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    papers: Mapped[list["Paper"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Paper(Base):
    __tablename__ = "papers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=True
    )
    title: Mapped[str] = mapped_column(String(512), default="Untitled")
    filename: Mapped[str] = mapped_column(String(512), nullable=False)
    source_hash: Mapped[str] = mapped_column(String(64), index=True, comment="PDF 文件 SHA256")
    storage_path: Mapped[str] = mapped_column(String(512), nullable=False, comment="原始 PDF 路径")
    total_pages: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    # 翻译相关：由 pdf2zh 生成译文 PDF
    translated_storage_path: Mapped[str | None] = mapped_column(
        String(512), nullable=True, comment="译文 mono.pdf 路径"
    )
    translation_status: Mapped[str] = mapped_column(
        String(16), default="pending", comment="pending / running / done / failed"
    )
    translation_error: Mapped[str | None] = mapped_column(Text(), nullable=True)
    translated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    user: Mapped["User"] = relationship(back_populates="papers")
    progresses: Mapped[list["Progress"]] = relationship(back_populates="paper", cascade="all, delete-orphan")

    __table_args__ = (Index("ix_papers_user_source", "user_id", "source_hash"),)


class Progress(Base):
    __tablename__ = "progress"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    paper_id: Mapped[int] = mapped_column(ForeignKey("papers.id", ondelete="CASCADE"), index=True, nullable=False)
    mode: Mapped[str] = mapped_column(String(16), default="overlay", comment="overlay / bilingual")
    page: Mapped[int] = mapped_column(Integer, default=0)
    scroll_ratio: Mapped[float] = mapped_column(Float, default=0.0)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    paper: Mapped["Paper"] = relationship(back_populates="progresses")

    __table_args__ = (UniqueConstraint("user_id", "paper_id", name="uq_progress_user_paper"),)
