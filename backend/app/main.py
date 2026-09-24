"""FastAPI 应用入口。"""
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect, text
from starlette.middleware.sessions import SessionMiddleware

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

# OIDC 登录流程需要 session 存 state/nonce，登录后存 id_token 供登出 id_token_hint。
# 有效期与登录 cookie 对齐（7 天），否则登出时 hint 已丢失，Authentik 会多一步确认页。
# 注意 add_middleware 后加的在最外层，此处须写在 CORS 之前以保持 CORS 最外层。
app.add_middleware(
    SessionMiddleware,
    secret_key=settings.secret_key,
    same_site="lax",
    https_only=settings.is_production,
    max_age=60 * 60 * 24 * 7,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _migrate_users_table() -> None:
    """幂等迁移 users 表（OIDC 适配）。

    项目未启用 alembic，create_all 不会修改已有表，
    故在启动时检查并补齐 OIDC 相关列。
    """
    inspector = inspect(engine)
    if not inspector.has_table("users"):
        return  # 全新数据库，create_all 已按最新模型建表
    columns = {c["name"]: c for c in inspector.get_columns("users")}
    stmts: list[str] = []
    if "oidc_sub" not in columns:
        stmts.append("ALTER TABLE users ADD COLUMN oidc_sub VARCHAR(255)")
        stmts.append("CREATE UNIQUE INDEX ix_users_oidc_sub ON users (oidc_sub)")
    if "name" not in columns:
        stmts.append("ALTER TABLE users ADD COLUMN name VARCHAR(255)")
    if not columns["password_hash"]["nullable"]:
        stmts.append("ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL")
    if stmts:
        with engine.begin() as conn:
            for stmt in stmts:
                conn.execute(text(stmt))
        logger.info("users 表已迁移：%s", "; ".join(stmts))


@app.on_event("startup")
def on_startup() -> None:
    """开发环境自动建表；生产环境建议用 alembic 迁移。"""
    Base.metadata.create_all(bind=engine)
    _migrate_users_table()
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
