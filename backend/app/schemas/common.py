"""通用与认证相关的 Pydantic 模型。"""
from datetime import datetime

from pydantic import BaseModel


class UserOut(BaseModel):
    id: int
    email: str
    name: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class LogoutOut(BaseModel):
    detail: str
    logout_url: str | None = None
