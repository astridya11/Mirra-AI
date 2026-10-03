from enum import Enum
from typing import Optional
from pydantic import BaseModel, EmailStr, Field


class PartyRole(str, Enum):
    RIDER = "RIDER"
    DRIVER = "DRIVER"
    SUPPORT = "SUPPORT"


# --- Authentication Payloads ---

class UserSignUpRequest(BaseModel):
    name: str = Field(..., example="Sarah Chen")
    email: EmailStr = Field(..., example="sarahchen@gmail.com")
    password: str = Field(..., min_length=6, example="Secret123!")
    party: PartyRole = Field(..., example="RIDER")


class UserLoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserResponse"


class TokenPayload(BaseModel):
    sub: str          # party_id
    email: EmailStr
    party: PartyRole
    bad_faith_flag: bool = False


# --- User Schemas ---

class UserAccount(BaseModel):
    party: PartyRole
    party_id: str
    name: str
    email: EmailStr
    password: str
    account_age_days: int = 0
    total_trips: int = 0
    avg_rating: float = 5.0
    risk_score: float = 0.0
    dispute_history_30d: int = 0
    dispute_history_90d: int = 0
    bad_faith_flag: bool = False
    bad_faith_reason: Optional[str] = None


class UserResponse(BaseModel):
    party: PartyRole
    party_id: str
    name: str
    email: EmailStr
    account_age_days: int
    total_trips: int
    avg_rating: float
    risk_score: float
    dispute_history_30d: int
    dispute_history_90d: int
    bad_faith_flag: bool


class HistoricalProfile(BaseModel):
    """Sanitized profile safe for agent/LLM context injection."""
    party: PartyRole
    party_id: str
    name: str
    account_age_days: int
    total_trips: int
    avg_rating: float
    risk_score: float
    dispute_history_30d: int
    dispute_history_90d: int
    bad_faith_flag: bool
    bad_faith_reason: Optional[str] = None