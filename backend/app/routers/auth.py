"""认证路由：OIDC 登录（Authentik）/ 登出 / 当前用户。

后端驱动的授权码模式：
1. GET /api/auth/oidc/login    → 302 跳转 Authentik 授权页（state/nonce 存 session cookie）
2. Authentik 认证后回调 GET /api/auth/oidc/callback?code&state
   → 换 token、校验 ID token、按 sub/email 关联或创建本地用户，
     签发内部 JWT 写 httpOnly cookie（会话机制与密码登录时代完全一致），302 回前端 /
3. POST /api/auth/logout       → 清除本地 cookie，返回 Authentik 全局登出地址供前端跳转
"""
import logging
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.deps import get_current_user, get_db
from app.models import User
from app.oidc import get_client
from app.schemas.common import LogoutOut, UserOut
from app.security import create_access_token

logger = logging.getLogger("pdf-reader")
router = APIRouter()


def _set_auth_cookie(response: Response, token: str, settings: Settings) -> None:
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        secure=settings.is_production,
        samesite="lax",
        max_age=60 * 60 * 24 * 7,  # 7 天，与 token 一致
        path="/",
    )


def _login_error(message: str) -> RedirectResponse:
    """带错误信息回到前端登录页。"""
    return RedirectResponse(f"/login?{urlencode({'error': message})}", status_code=303)


def _external_base(request: Request, settings: Settings) -> str:
    """对外基址：优先 OIDC_REDIRECT_BASE，否则从请求推导（依赖代理头）。"""
    if settings.oidc_redirect_base:
        return settings.oidc_redirect_base.rstrip("/")
    return str(request.base_url).rstrip("/")


@router.get("/oidc/login")
async def oidc_login(request: Request, settings: Settings = Depends(get_settings)):
    client = get_client()
    if client is None:
        return _login_error("OIDC 登录未配置，请在服务端设置 OIDC_ISSUER 等环境变量")
    redirect_uri = _external_base(request, settings) + "/api/auth/oidc/callback"
    return await client.authorize_redirect(request, redirect_uri)


@router.get("/oidc/callback")
async def oidc_callback(
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    # Authentik 侧出错或用户取消授权时带 error 参数回来
    error = request.query_params.get("error")
    if error:
        return _login_error(request.query_params.get("error_description") or error)

    client = get_client()
    if client is None:
        return _login_error("OIDC 登录未配置")

    try:
        # authlib 校验 state 与 ID token（签名/JWKS、iss、aud、exp、nonce）
        token = await client.authorize_access_token(request)
    except Exception:
        logger.exception("OIDC 换取令牌失败")
        return _login_error("登录失败：state 校验或令牌校验未通过")

    userinfo = token.get("userinfo") or {}
    sub = userinfo.get("sub")
    email = userinfo.get("email")
    name = userinfo.get("name") or userinfo.get("preferred_username")
    if not sub or not email:
        logger.warning("OIDC userinfo 缺少 sub/email：%s", list(userinfo.keys()))
        return _login_error("Authentik 未返回邮箱，请先在 Authentik 补全用户邮箱")

    try:
        user = db.execute(select(User).where(User.oidc_sub == sub)).scalar_one_or_none()
        if user is None:
            # 老账号（密码时代注册）按邮箱自动关联，论文/进度/解读历史保留
            user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
            if user is None:
                user = User(email=email, oidc_sub=sub, name=name)
                db.add(user)
            else:
                user.oidc_sub = sub

        if not user.is_active:
            db.rollback()
            return _login_error("账号已被禁用")

        if name:
            user.name = name
        # Authentik 侧邮箱变更时同步（新邮箱未被占用才同步）
        if user.email != email:
            taken = db.execute(
                select(User.id).where(User.email == email, User.id != user.id)
            ).scalar_one_or_none()
            if taken is None:
                user.email = email
            else:
                logger.warning("用户 %s 的 Authentik 新邮箱 %s 已被占用，保留旧邮箱", user.id, email)

        db.commit()
        db.refresh(user)
    except IntegrityError:
        db.rollback()
        logger.exception("OIDC 用户落库冲突")
        return _login_error("登录失败：账号关联冲突，请重试")

    request.session["id_token"] = token.get("id_token", "")  # 供登出 id_token_hint
    resp = RedirectResponse("/", status_code=303)
    _set_auth_cookie(resp, create_access_token(user.id, settings.secret_key), settings)
    return resp


@router.post("/logout", response_model=LogoutOut)
async def logout(request: Request, response: Response, settings: Settings = Depends(get_settings)):
    response.delete_cookie(key="access_token", path="/")
    id_token = request.session.pop("id_token", None)
    logout_url = None
    client = get_client()
    if client is not None:
        try:
            metadata = await client.load_server_metadata()
            end_session = metadata.get("end_session_endpoint")
            if end_session:
                params = {"post_logout_redirect_uri": _external_base(request, settings) + "/login"}
                if id_token:
                    params["id_token_hint"] = id_token
                logout_url = f"{end_session}?{urlencode(params)}"
        except Exception:
            logger.exception("获取 OIDC end_session_endpoint 失败，仅清除本地会话")
    return {"detail": "已退出", "logout_url": logout_url}


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user
