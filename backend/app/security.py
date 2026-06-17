"""认证工具：密码哈希、JWT 签发与校验。"""
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
import jwt

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 天


def hash_password(password: str) -> str:
    # bcrypt 限制 72 字节，截断避免报错
    pw = password.encode("utf-8")[:72]
    return bcrypt.hashpw(pw, bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        pw = plain.encode("utf-8")[:72]
        return bcrypt.checkpw(pw, hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


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
