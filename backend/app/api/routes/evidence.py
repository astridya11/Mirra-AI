from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import ensure_case_party, get_current_party_id
from app.db.session import get_db
from app.models.case import Case
from app.models.evidence import EvidenceRecord
from app.schemas.evidence import EvidenceCreate, EvidenceRead

router = APIRouter(prefix="/cases/{case_id}/evidence", tags=["evidence"])


def _get_case_for_party(case_id: str, db: Session, party_id: str) -> Case:
    case = db.get(Case, case_id)
    if case is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Case not found")
    ensure_case_party(case, party_id)
    return case


@router.post("", response_model=EvidenceRead, status_code=status.HTTP_201_CREATED)
def add_evidence(
    case_id: str,
    payload: EvidenceCreate,
    db: Session = Depends(get_db),
    party_id: str = Depends(get_current_party_id),
) -> EvidenceRecord:
    _get_case_for_party(case_id, db, party_id)

    record = EvidenceRecord(case_id=case_id, **payload.model_dump())
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


@router.get("", response_model=list[EvidenceRead])
def list_evidence(
    case_id: str,
    db: Session = Depends(get_db),
    party_id: str = Depends(get_current_party_id),
) -> list[EvidenceRecord]:
    _get_case_for_party(case_id, db, party_id)

    return (
        db.query(EvidenceRecord)
        .filter(EvidenceRecord.case_id == case_id)
        .order_by(EvidenceRecord.created_at.asc())
        .all()
    )
