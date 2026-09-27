from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.case import CaseState, DisputeType, ResolutionChannel


class CaseCreate(BaseModel):
    case_id: str
    dispute_type: DisputeType
    trip_id: str | None = None
    rider_id: str
    driver_id: str


class CaseRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    case_id: str
    dispute_type: DisputeType
    current_state: CaseState
    current_round: int
    resolution_channel: ResolutionChannel | None
    trip_id: str | None
    rider_id: str
    driver_id: str
    created_at: datetime
    updated_at: datetime
