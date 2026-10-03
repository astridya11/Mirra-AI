import os
from pathlib import Path
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

# Location of config.py -> backend/core/
CORE_DIR = Path(__file__).resolve().parent

# Location of backend root directory -> backend/
BACKEND_DIR = CORE_DIR.parent.parent
class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Mirra AI - Dispute Resolution Backend"
    api_v1_prefix: str = "/api/v1"

    # ponytail: sqlite fallback keeps `uvicorn app.main:app` runnable with zero setup;
    # point DATABASE_URL at Postgres for real deployments (see .env.example).
    database_url: str = "sqlite:///./mirra.db"
    USERS_FILE_PATH: str = str(BACKEND_DIR / "data" / "users.json")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24 Hours


@lru_cache
def get_settings() -> Settings:
    return Settings()
