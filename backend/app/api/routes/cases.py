from typing import Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import ensure_case_party, get_current_party_id
from app.db.session import get_db
from app.models.case import Case
from app.schemas.case import CaseCreate, CaseRead
from app.db.auth import user_repo
from app.auth.dependencies import RequireRole, get_current_user
from app.schemas.auth import PartyRole, UserAccount

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
    current_user: UserAccount = Depends(get_current_user),
) -> Case:
    case = db.get(Case, case_id)
    if case is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Case not found")

    # SUPPORT team can view any case
    if current_user.party == PartyRole.SUPPORT:
        return case

    # RIDER and DRIVER can only view cases they are associated with
    ensure_case_party(case, current_user.party_id)
    return case

@router.post("/{case_id}/escalate")
def escalate_case(
    case_id: str,
    support_user: UserAccount = Depends(get_current_user)
):
    return {
        "case_id": case_id,
        "status": "ESCALATED_HUMAN_REVIEW",
        "escalated_by": support_user.party_id,
    }


@router.get("/{case_id}/user-context")
def get_user_context(
    case_id: str,
):
    """Prepares sanitized historical profiles (no passwords) for agent deliberation context."""
    rider = user_repo.get_by_party_id("R-1092")
    driver = user_repo.get_by_party_id("D-5541")

    context = {
        "case_id": case_id,
        "historical_profiles": [
            user_repo.to_historical_profile(rider).model_dump() if rider else None,
            user_repo.to_historical_profile(driver).model_dump() if driver else None,
        ],
    }
    return context