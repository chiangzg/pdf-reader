"""认证工具：内部会话 JWT 的签发与校验。

OIDC（Authentik）只负责登录时刻的身份引导；登录成功后仍签发本地 JWT
写入 httpOnly cookie，下游接口（get_current_user）只认这个内部 token。
密码哈希相关函数已随密码登录一并移除。
"""
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 天


def create_access_token(
    subject: int | str, secret_key: str, expires_minutes: int = ACCESS_TOKEN_EXPIRE_MINUTES
) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=expires_minutes)
    # PyJWT 要求 sub 为字符串
    sub = str(subject)
    payload: dict[str, Any] = {"sub": sub, "exp": expire}
    return jwt.encode(payload, secret_key, algorithm=ALGORITHM)


def decode_access_token(token: str, secret_key: str) -> dict[str, Any] | None:
    try:
        payload = jwt.decode(token, secret_key, algorithms=[ALGORITHM])
        # sub 必须存在且为正整数字符串
        sub = payload.get("sub")
        if sub is None:
            return None
        uid = int(sub)
        if uid <= 0:
            return None
        payload["sub"] = uid
        return payload
    except (jwt.PyJWTError, ValueError, TypeError):
        return None
