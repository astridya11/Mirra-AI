from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Mirra AI - Dispute Resolution Backend"
    api_v1_prefix: str = "/api/v1"

    # ponytail: sqlite fallback keeps `uvicorn app.main:app` runnable with zero setup;
    # point DATABASE_URL at Postgres for real deployments (see .env.example).
    database_url: str = "sqlite:///./mirra.db"


@lru_cache
def get_settings() -> Settings:
    return Settings()
