from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import ensure_case_party, get_current_party_id
from app.db.session import get_db
from app.models.case import Case
from app.schemas.case import CaseCreate, CaseRead

router = APIRouter(prefix="/cases", tags=["cases"])


@router.post("", response_model=CaseRead, status_code=status.HTTP_201_CREATED)
def create_case(payload: CaseCreate, db: Session = Depends(get_db)) -> Case:
    if db.get(Case, payload.case_id) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "case_id already exists")

    case = Case(**payload.model_dump())
    db.add(case)
    db.commit()
    db.refresh(case)
    return case


@router.get("", response_model=list[CaseRead])
def list_my_cases(
    db: Session = Depends(get_db),
    party_id: str = Depends(get_current_party_id),
) -> list[Case]:
    """Private Assistance: returns only cases the caller is a rider or driver on."""
    return (
        db.query(Case)
        .filter((Case.rider_id == party_id) | (Case.driver_id == party_id))
        .order_by(Case.created_at.desc())
        .all()
    )


@router.get("/{case_id}", response_model=CaseRead)
def get_case(
    case_id: str,
    db: Session = Depends(get_db),
    party_id: str = Depends(get_current_party_id),
) -> Case:
    case = db.get(Case, case_id)
    if case is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Case not found")
    ensure_case_party(case, party_id)
    return case
