from pydantic import BaseModel, Field
from typing import Literal


class EvidenceReference(BaseModel):
    evidence_id: str
    source_type: Literal[
        "GPS_TELEMETRY",
        "CHAT_LOG",
        "RECEIPT",
        "ROUTE_TRAJECTORY",
        "PAYMENT_RECORD",
        "IMAGE",
        "EXIF_METADATA",
        "HISTORICAL_PROFILE",
        "APP_EVENT",
        "OTHER",
    ]
    description: str


class Fact(BaseModel):
    fact_id: str
    description: str
    supporting_evidence: list[EvidenceReference]
    party_relevance: Literal["RIDER", "DRIVER", "BOTH", "NEUTRAL"] | None = None
    policy_clause_reference: str | None = None
    confidence_level: float | None = Field(None, ge=0.0, le=1.0)


class ProsecutorReportResponse(BaseModel):
    verified_facts: list[Fact]
    disputed_facts: list[Fact]
    missing_facts: list[Fact]
    prosecutor_summary: str | None = None
    report_submitted_at: str