"""OIDC 客户端（Authentik）。

- 通过 issuer 的 `/.well-known/openid-configuration` 自动发现端点，
  metadata 在首次使用时拉取并缓存，应用启动不依赖 Authentik 可达。
- issuer 未配置时不注册客户端，登录路由返回 503。
"""
from authlib.integrations.starlette_client import OAuth, StarletteOAuth2App

from app.config import get_settings

PROVIDER_NAME = "authentik"
SCOPE = "openid email profile"

oauth = OAuth()


def register_provider() -> None:
    settings = get_settings()
    if not settings.oidc_issuer:
        return
    oauth.register(
        name=PROVIDER_NAME,
        server_metadata_url=settings.oidc_issuer.rstrip("/") + "/.well-known/openid-configuration",
        client_id=settings.oidc_client_id,
        client_secret=settings.oidc_client_secret,
        client_kwargs={"scope": SCOPE},
    )


def get_client() -> StarletteOAuth2App | None:
    """返回已注册的 OIDC 客户端；未配置时为 None。"""
    return oauth.create_client(PROVIDER_NAME)


register_provider()
