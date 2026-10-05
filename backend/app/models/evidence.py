import enum
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from sqlalchemy import JSON, DateTime, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)

if TYPE_CHECKING:
    from app.models.case import Case  # Only imported during static type checking

# Mirrors shared/schemas.json ($defs.EvidenceReference.source_type).
class EvidenceSourceType(str, enum.Enum):
    GPS_TELEMETRY = "GPS_TELEMETRY"
    CHAT_LOG = "CHAT_LOG"
    RECEIPT = "RECEIPT"
    ROUTE_TRAJECTORY = "ROUTE_TRAJECTORY"
    PAYMENT_RECORD = "PAYMENT_RECORD"
    IMAGE = "IMAGE"
    EXIF_METADATA = "EXIF_METADATA"
    HISTORICAL_PROFILE = "HISTORICAL_PROFILE"
    APP_EVENT = "APP_EVENT"
    OTHER = "OTHER"


class EvidenceRecord(Base):
    """A raw evidence item attached to a case's frozen data_sources.

    This is the basic evidence record for Milestone 1. The Evidence Agent
    (Prosecutor) reads these through the API to build its ProsecutorReport;
    it does not import this ORM layer directly, keeping it framework-agnostic.
    """

    __tablename__ = "evidence_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    case_id: Mapped[str] = mapped_column(ForeignKey("cases.case_id"), index=True)

    evidence_id: Mapped[str] = mapped_column(String(64))
    source_type: Mapped[EvidenceSourceType] = mapped_column(
        Enum(EvidenceSourceType, native_enum=False)
    )
    description: Mapped[str] = mapped_column(Text)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    case: Mapped["Case"] = relationship(back_populates="evidence_records")
