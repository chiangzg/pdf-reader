"""FastAPI 应用入口。"""
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import Base, engine
from app.routers import auth, chat, highlights, interpret, papers, progress

settings = get_settings()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("pdf-reader")

app = FastAPI(
    title="PDF 翻译阅读器 API",
    version="0.1.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    """开发环境自动建表；生产环境建议用 alembic 迁移。"""
    Base.metadata.create_all(bind=engine)
    logger.info("数据库表已就绪")
    # 恢复孤儿翻译任务：daemon 线程随上一进程退出而消失，DB 里 status='running'
    # 的记录其实已没人处理，重置为 pending 并重新提交。
    from app.database import SessionLocal
    from app.routers.papers import resume_pending_translations

    db = SessionLocal()
    try:
        resume_pending_translations(db)
    finally:
        db.close()


@app.get("/health", tags=["meta"])
def health() -> dict:
    return {"status": "ok", "env": settings.app_env}


# 路由
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(papers.router, prefix="/api/papers", tags=["papers"])
app.include_router(interpret.router, prefix="/api", tags=["interpret"])
app.include_router(progress.router, prefix="/api/progress", tags=["progress"])
app.include_router(highlights.router, prefix="/api/highlights", tags=["highlights"])
app.include_router(chat.router, prefix="/api/highlights", tags=["chat"])
