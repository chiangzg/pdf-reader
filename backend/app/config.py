"""应用配置：从环境变量读取。

所有密钥通过 .env 注入，代码中不硬编码。
"""
from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ---- 运行环境 ----
    app_env: str = Field(default="development")
    secret_key: str = Field(default="dev-insecure-secret")

    # ---- Cookie / CORS ----
    cookie_domain: str = Field(default="")
    cors_origins: str = Field(default="http://localhost")

    # ---- PostgreSQL ----
    postgres_user: str = "pdfreader"
    postgres_password: str = ""
    postgres_db: str = "pdfreader"
    postgres_host: str = "postgres"
    postgres_port: int = 5432

    # ---- pdf2zh 翻译服务 ----
    pdf2zh_url: str = Field(default="http://pdf2zh:7860/", description="pdf2zh Gradio 服务地址")
    pdf2zh_lang_in: str = Field(default="en")
    pdf2zh_lang_out: str = Field(default="zh")
    # 注意：用 "OpenAI" 而非 "DeepSeek"。pdf2zh 1.9.6 的 DeepSeek 翻译器有 bug
    # （继承 OpenAI 时缺 OPENAI_MODEL envs），故用 OpenAI service + DeepSeek 端点绕过。
    pdf2zh_service: str = Field(default="OpenAI", description="pdf2zh 使用的翻译引擎")

    # ---- DeepSeek（interpreter.py 用于 AI 解读）----
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-v4-flash"

    # ---- 上传 ----
    max_upload_mb: int = 50

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+psycopg2://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
