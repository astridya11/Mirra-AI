from fastapi import FastAPI

from app.api.routes import cases, evidence
from app.core.config import get_settings

settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    description=(
        "Case, Private Assistance and evidence-record backend for the Ryde dispute "
        "resolution system. LLM-agnostic: Evidence/Judge agents integrate through "
        "this HTTP API, not by importing this codebase."
    ),
    version="0.1.0",
)

app.include_router(cases.router, prefix=settings.api_v1_prefix)
app.include_router(evidence.router, prefix=settings.api_v1_prefix)


@app.get("/health", tags=["health"])
def health() -> dict:
    return {"status": "ok"}
