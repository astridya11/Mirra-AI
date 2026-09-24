from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.evidence import EvidenceSourceType


class EvidenceCreate(BaseModel):
    evidence_id: str
    source_type: EvidenceSourceType
    description: str
    payload: dict = {}


class EvidenceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    case_id: str
    evidence_id: str
    source_type: EvidenceSourceType
    description: str
    payload: dict
    created_at: datetime
