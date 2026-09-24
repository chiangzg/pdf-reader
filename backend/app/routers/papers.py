"""论文路由：上传、列表、详情、删除、翻译状态、文件服务。

上传只存原始 PDF + 元信息（标题/页数），并异步触发 pdf2zh 翻译生成译文 PDF。
前端通过轮询翻译状态 + 译文文件接口渲染双语对照。
"""
import hashlib
import logging
import os
import shutil
import threading
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from pypdf import PdfReader
from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.deps import get_current_user, get_db
from app.models import Paper, User
from app.schemas.paper import PaperDetail, PaperListOut, PaperOut, TranslationStatusOut
from app.services.pdf2zh_client import Pdf2zhClient

logger = logging.getLogger(__name__)
router = APIRouter()
settings = get_settings()

UPLOAD_DIR = Path("/app/uploads")
TRANSLATIONS_DIR = Path("/app/translations")
ALLOWED_EXT = {".pdf"}

# 全局 pdf2zh 客户端（懒加载，模型常驻 pdf2zh 服务）
_pdf2zh: Pdf2zhClient | None = None


def _get_pdf2zh() -> Pdf2zhClient:
    global _pdf2zh
    if _pdf2zh is None:
        _pdf2zh = Pdf2zhClient(settings)
    return _pdf2zh


def _ensure_dirs() -> None:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    TRANSLATIONS_DIR.mkdir(parents=True, exist_ok=True)


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _safe_unlink(path: str | Path | None) -> None:
    """安全删除单个文件：路径为空/文件不存在/删除失败都只记日志，不抛异常。

    磁盘整洁是尽力而为——绝不能因为删文件失败让 DELETE 接口返回 500，
    那样会破坏「DB 行已删」与用户可见状态的一致性。
    """
    if not path:
        return
    p = Path(path)
    try:
        p.unlink(missing_ok=True)
    except Exception as e:  # noqa: BLE001
        logger.warning("删除文件失败（忽略）: %s -> %s", p, e)


def _rmtree_if_exists(dir_path: str | Path | None) -> None:
    """删除目录（含内容），不存在或失败都只记日志，不抛异常。

    用于清理 pdf2zh 翻译后在 translations/<hash>/ 下残留的 mono.pdf + dual.pdf——
    客户端把 mono 复制到 flat 的 <hash>-mono.pdf 之后，子目录再无引用。
    """
    if not dir_path:
        return
    p = Path(dir_path)
    try:
        if p.exists():
            shutil.rmtree(p, ignore_errors=True)
    except Exception as e:  # noqa: BLE001
        logger.warning("删除目录失败（忽略）: %s -> %s", p, e)


def _count_papers_with_hash(db: Session, source_hash: str, exclude_id: int) -> int:
    """统计除 exclude_id 外，还有多少 Paper 行引用同一份原文（按 source_hash）。

    原文与译文均按 SHA256 内容寻址、跨用户/记录复用，故删文件前必须确认
    没有其它行还在用同一份磁盘文件——这就是引用计数。返回 0 才可安全删除。
    """
    return int(
        db.execute(
            select(func.count())
            .select_from(Paper)
            .where(Paper.source_hash == source_hash, Paper.id != exclude_id)
        ).scalar()
        or 0
    )


def _get_pdf_title(path: str, fallback_name: str, max_len: int = 200) -> str:
    """从 PDF 元信息取标题，失败则回退到原始文件名（去扩展名）。

    fallback_name 必须是用户上传时的原始文件名——绝不能用磁盘存储路径的 stem，
    因为原文按 SHA256 存为 <hash>.pdf，stem 就是一串 hash，作为标题毫无意义。
    """
    try:
        reader = PdfReader(path)
        info = reader.metadata
        if info and info.title:
            return info.title[:max_len]
    except Exception:  # noqa: BLE001
        pass
    return Path(fallback_name).stem[:max_len] or "Untitled"


def _get_pdf_pages(path: str) -> int:
    try:
        return len(PdfReader(path).pages)
    except Exception:  # noqa: BLE001
        return 0


async def _save_upload(file: UploadFile) -> tuple[Path, str]:
    _ensure_dirs()
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(status_code=400, detail="仅支持 PDF 文件")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="文件为空")
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"文件超过 {settings.max_upload_mb}MB 限制")
    source_hash = _sha256_bytes(data)
    store_path = UPLOAD_DIR / f"{source_hash}.pdf"
    if not store_path.exists():
        store_path.write_bytes(data)
    return store_path, source_hash


def _translation_task(paper_id: int, source_hash: str, storage_path: str) -> None:
    """后台线程：调用 pdf2zh 翻译，更新状态。

    用独立 DB 会话（脱离请求生命周期）。
    """
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        paper = db.get(Paper, paper_id)
        if paper is None:
            return
        paper.translation_status = "running"
        paper.translation_error = None
        db.commit()

        output_path = str(TRANSLATIONS_DIR / f"{source_hash}-mono.pdf")
        client = _get_pdf2zh()
        client.translate(storage_path, output_path)

        paper.translated_storage_path = output_path
        paper.translation_status = "done"
        paper.translation_error = None
        paper.translated_at = datetime.now(timezone.utc)
        db.commit()
        # 翻译产物已被复制到 flat 路径，pdf2zh 在 translations/<hash>/ 下残留的
        # mono.pdf + dual.pdf 再无引用，及时回收避免译文占两到三倍空间。
        _rmtree_if_exists(TRANSLATIONS_DIR / source_hash)
        logger.info("论文 %d 翻译完成", paper_id)
    except Exception as e:  # noqa: BLE001
        logger.exception("论文 %d 翻译失败", paper_id)
        paper = db.get(Paper, paper_id)
        if paper is not None:
            paper.translation_status = "failed"
            paper.translation_error = str(e)[:500]
            db.commit()
    finally:
        db.close()


def _trigger_translation(paper_id: int, source_hash: str, storage_path: str) -> None:
    """启动后台翻译线程。

    供上传、手动重试、以及进程重启后的孤儿任务恢复复用。
    """
    t = threading.Thread(
        target=_translation_task,
        args=(paper_id, source_hash, storage_path),
        daemon=True,
    )
    t.start()


def resume_pending_translations(db: Session) -> int:
    """进程启动后恢复孤儿翻译任务。

    daemon 线程随进程退出而消失，DB 里可能残留 translation_status='running' 的记录
    （其实已没人处理）。把它们重置为 pending 并重新提交翻译。

    在 main.py 的 startup 钩子调用。返回恢复的任务数。
    """
    orphans = db.execute(
        select(Paper).where(Paper.translation_status == "running")
    ).scalars().all()
    count = 0
    for paper in orphans:
        if not paper.storage_path:
            continue
        logger.info("恢复孤儿翻译任务: paper_id=%s hash=%s", paper.id, paper.source_hash)
        paper.translation_status = "pending"
        paper.translation_error = None
        db.commit()
        _trigger_translation(paper.id, paper.source_hash, paper.storage_path)
        count += 1
    if count:
        logger.info("共恢复 %d 个孤儿翻译任务", count)
    return count


@router.post("", response_model=PaperDetail, status_code=status.HTTP_201_CREATED)
async def upload_paper(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """上传 PDF，自动触发异步翻译。

    同一文件（SHA256）已存在则复用原文件与译文（若已翻译完成），
    但仍为当前用户创建独立记录以便管理。
    """
    store_path, source_hash = await _save_upload(file)

    # 复用已存在的译文（同 hash 已翻译过）
    existing_translated = db.execute(
        select(Paper.translated_storage_path).where(
            Paper.source_hash == source_hash,
            Paper.translation_status == "done",
            Paper.translated_storage_path.isnot(None),
        )
    ).scalars().first()

    title = _get_pdf_title(str(store_path), file.filename or "document.pdf")
    total_pages = _get_pdf_pages(str(store_path))

    paper = Paper(
        user_id=user.id,
        title=title,
        filename=file.filename or "document.pdf",
        source_hash=source_hash,
        storage_path=str(store_path),
        total_pages=total_pages,
        translation_status="done" if existing_translated else "pending",
        translated_storage_path=existing_translated,
        translated_at=datetime.now(timezone.utc) if existing_translated else None,
    )
    db.add(paper)
    db.commit()
    db.refresh(paper)

    # 若无可复用译文，触发异步翻译
    if not existing_translated:
        _trigger_translation(paper.id, source_hash, str(store_path))

    logger.info("论文入库 id=%s 标题=%r", paper.id, paper.title)
    return paper


@router.get("", response_model=PaperListOut)
def list_papers(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    q = select(Paper).where(Paper.user_id == user.id).order_by(desc(Paper.created_at))
    papers = db.execute(q).scalars().all()
    return PaperListOut(total=len(papers), items=list(papers))


@router.get("/{paper_id}", response_model=PaperDetail)
def get_paper(paper_id: int, db: Session = Depends(get_db)):
    paper = db.get(Paper, paper_id)
    if paper is None:
        raise HTTPException(status_code=404, detail="论文不存在")
    return paper


@router.get("/{paper_id}/translation-status", response_model=TranslationStatusOut)
def get_translation_status(paper_id: int, db: Session = Depends(get_db)):
    paper = db.get(Paper, paper_id)
    if paper is None:
        raise HTTPException(status_code=404, detail="论文不存在")
    progress = None
    # 仅 running 时现查 pdf2zh 任务进度（source_hash 即 task_id）。
    # pdf2zh 不可达时 get_task_status 返回 None，progress 保持 None，不报错。
    if paper.translation_status == "running":
        client = _get_pdf2zh()
        status = client.get_task_status(paper.source_hash)
        if status and isinstance(status.get("progress"), (int, float)):
            progress = float(status["progress"])
    return TranslationStatusOut(
        paper_id=paper_id,
        status=paper.translation_status,
        error=paper.translation_error,
        progress=progress,
    )


@router.post("/{paper_id}/translate", response_model=TranslationStatusOut)
def retry_translate(paper_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """手动重新触发翻译（失败重试 / 强制重译）。"""
    paper = db.get(Paper, paper_id)
    if paper is None:
        raise HTTPException(status_code=404, detail="论文不存在")
    if paper.translation_status == "running":
        raise HTTPException(status_code=409, detail="翻译进行中")
    paper.translation_status = "pending"
    paper.translation_error = None
    db.commit()
    _trigger_translation(paper.id, paper.source_hash, paper.storage_path)
    return TranslationStatusOut(paper_id=paper_id, status="pending")


@router.get("/{paper_id}/file")
def get_paper_file(paper_id: int, db: Session = Depends(get_db)):
    """返回原始 PDF 文件。"""
    paper = db.get(Paper, paper_id)
    if paper is None:
        raise HTTPException(status_code=404, detail="论文不存在")
    if not os.path.exists(paper.storage_path):
        raise HTTPException(status_code=404, detail="PDF 文件不存在")
    return FileResponse(paper.storage_path, media_type="application/pdf", filename=paper.filename)


@router.get("/{paper_id}/translated_file")
def get_translated_file(paper_id: int, db: Session = Depends(get_db)):
    """返回译文 PDF（mono，纯中文版面）。

    翻译未完成时返回 409。
    """
    paper = db.get(Paper, paper_id)
    if paper is None:
        raise HTTPException(status_code=404, detail="论文不存在")
    if paper.translation_status != "done" or not paper.translated_storage_path:
        raise HTTPException(
            status_code=409 if paper.translation_status == "running" else 404,
            detail=f"译文未就绪（当前状态：{paper.translation_status}）",
        )
    if not os.path.exists(paper.translated_storage_path):
        raise HTTPException(status_code=404, detail="译文文件不存在")
    return FileResponse(
        paper.translated_storage_path,
        media_type="application/pdf",
        filename=f"{Path(paper.filename).stem}-zh.pdf",
    )


@router.delete("/{paper_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_paper(paper_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """删除论文记录，并在无其它记录引用同一份文件时回收磁盘空间。

    原文与译文均按 source_hash 内容寻址、跨记录复用，故不能无条件删文件——
    先用引用计数（除当前行外还有多少行同 hash）判断是否真正物理删除：
      - ref_count > 0：仍有其它记录在用，只删 DB 行，保留磁盘文件。
      - ref_count = 0：物理删除原文 + 译文 + 译文子目录残留。
    顺序为「先查引用数 → 删 DB 行 → 按需清磁盘」，确保引用计数在删除前算准。
    """
    paper = db.get(Paper, paper_id)
    if paper is None or paper.user_id != user.id:
        raise HTTPException(status_code=404, detail="论文不存在")

    source_hash = paper.source_hash
    storage_path = paper.storage_path
    translated_path = paper.translated_storage_path
    # 在 commit 前查引用数：此刻当前行仍在表中，用 exclude_id 排除它自己
    ref_count = _count_papers_with_hash(db, source_hash, exclude_id=paper.id)

    db.delete(paper)
    db.commit()

    if ref_count > 0:
        logger.info(
            "论文 %d 已删除（保留磁盘文件，仍有 %d 条记录引用 hash=%s）",
            paper_id, ref_count, source_hash,
        )
        return

    # 引用归零：物理回收原文 + 译文 + 译文子目录残留
    _safe_unlink(storage_path)
    _safe_unlink(translated_path)
    _rmtree_if_exists(TRANSLATIONS_DIR / source_hash)
    logger.info("论文 %d 已删除并回收磁盘文件 hash=%s", paper_id, source_hash)
