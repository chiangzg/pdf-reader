"""依赖注入：当前用户、DB 会话。

认证支持两种凭证来源（优先级：cookie > Authorization header）：
- httpOnly cookie `access_token`（前端 fetch 自动携带，需 credentials: 'include'）
- Authorization: Bearer <token>（API 直连场景）
"""
from collections.abc import Generator

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.database import SessionLocal

security = HTTPBearer(auto_error=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _extract_token(request: Request, credentials: HTTPAuthorizationCredentials | None) -> str | None:
    # 优先 cookie
    cookie_token = request.cookies.get("access_token")
    if cookie_token:
        return cookie_token
    # 其次 Authorization header
    if credentials and credentials.credentials:
        return credentials.credentials
    return None


def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
):
    """强制认证：未登录或 token 无效返回 401。"""
    from app.models import User
    from app.security import decode_access_token

    token = _extract_token(request, credentials)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="未登录")
    payload = decode_access_token(token, settings.secret_key)
    if payload is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="token 无效或已过期")

    user = db.get(User, payload.get("sub"))
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户不存在")
    return user


def get_optional_current_user(
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
):
    """可选认证：未登录不报错，返回 None。"""
    token = _extract_token(request, credentials)
    if not token:
        return None
    try:
        from app.models import User
        from app.security import decode_access_token

        payload = decode_access_token(token, settings.secret_key)
        if payload is None:
            return None
        user = db.get(User, payload.get("sub"))
        return user if user and user.is_active else None
    except Exception:  # noqa: BLE001
        return None
