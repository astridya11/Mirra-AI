import enum
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)

if TYPE_CHECKING:
    from app.models.evidence import EvidenceRecord  # Only imported during static type checking


# Mirrors shared/schemas.json ($defs.CaseMetadata) so case records stay compatible
# with the mock datasets and the Evidence/Judge agent contracts P1/P2 build against.
class DisputeType(str, enum.Enum):
    LOST_ITEM = "LOST_ITEM",
    REFUND_REQUEST = "REFUND_REQUEST",
    DRIVER_RATING = "DRIVER_RATING",
    PAYMENT_FAILED = "PAYMENT_FAILED",
    CANCELLED_BOOKING = "CANCELLED_BOOKING",
    NO_SHOW_CHARGE = "NO_SHOW_CHARGE",
    CLEANING_FEE = "CLEANING_FEE",
    TOLL_REIMBURSEMENT = "TOLL_REIMBURSEMENT",
    PASSENGER_CONDUCT = "PASSENGER_CONDUCT",
    UNSAFE_DRIVING = "UNSAFE_DRIVING",
    SAFETY_ALERT = "SAFETY_ALERT",
    HARASSMENT = "HARASSMENT",
    VEHICLE_ACCIDENT = "VEHICLE_ACCIDENT",
    ROUTE_DEVIATION = "ROUTE_DEVIATION",
    SURGE_PRICING = "SURGE_PRICING",
    FARE_DISPUTE = "FARE_DISPUTE",
    PAYOUT_DELAY = "PAYOUT_DELAY",
    BONUS_INCENTIVE = "BONUS_INCENTIVE",
    SUBSCRIPTION_BILLING = "SUBSCRIPTION_BILLING",
    CASHBACK_PROMO = "CASHBACK_PROMO",
    ACCOUNT_PRIVACY = "ACCOUNT_PRIVACY",
    VEHICLE_DOCUMENTATION = "VEHICLE_DOCUMENTATION",
    DISPUTE_ESCALATION = "DISPUTE_ESCALATION"


class CaseState(str, enum.Enum):
    INIT_CLAIM = "INIT_CLAIM"
    ROUND_1_PLEADINGS = "ROUND_1_PLEADINGS"
    ROUND_2_PROSECUTOR_AUDIT = "ROUND_2_PROSECUTOR_AUDIT"
    JUDGE_DELIBERATION = "JUDGE_DELIBERATION"
    EXECUTION_ROUTER = "EXECUTION_ROUTER"


class ResolutionChannel(str, enum.Enum):
    FULLY_AUTOMATED = "FULLY_AUTOMATED"
    ESCALATED_HUMAN_REVIEW = "ESCALATED_HUMAN_REVIEW"


class Case(Base):
    __tablename__ = "cases"

    case_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    dispute_type: Mapped[DisputeType] = mapped_column(Enum(DisputeType, native_enum=False))
    dispute_claim_description: Mapped[str] = mapped_column(Text, nullable=False)
    current_state: Mapped[CaseState] = mapped_column(
        Enum(CaseState, native_enum=False), default=CaseState.INIT_CLAIM
    )
    current_round: Mapped[int] = mapped_column(Integer, default=1)
    resolution_channel: Mapped[ResolutionChannel | None] = mapped_column(
        Enum(ResolutionChannel, native_enum=False), nullable=True
    )

    trip_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    rider_id: Mapped[str] = mapped_column(String(64), index=True)
    driver_id: Mapped[str] = mapped_column(String(64), index=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )

    evidence_records: Mapped[list["EvidenceRecord"]] = relationship(
        back_populates="case", cascade="all, delete-orphan"
    )
