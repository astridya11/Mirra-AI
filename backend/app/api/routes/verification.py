from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import ensure_case_party, get_current_party_id
from app.db.session import get_db
from app.models.case import Case
from app.schemas.verification import ProsecutorReportResponse
from app.services.verification.ingestion import FixtureAccessError, load_case_data, normalize_evidence
from app.services.verification.report import generate_prosecutor_report

router = APIRouter(prefix="/cases", tags=["verification"])


# Note: this endpoint takes no request body. Policy thresholds are never
# accepted from the caller (see app/services/verification/policy.py) — either
# disputing party could otherwise bias the eligibility finding by supplying
# favorable numbers. Any JSON body a client sends is simply ignored by FastAPI
# since no parameter here consumes it.
@router.post("/{case_id}/verify", response_model=ProsecutorReportResponse)
def verify_case(
    case_id: str,
    db: Session = Depends(get_db),
    party_id: str = Depends(get_current_party_id),
) -> dict:
    case = db.get(Case, case_id)
    if case is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Case not found")
    ensure_case_party(case, party_id)

    try:
        raw_data = load_case_data(case_id)
    except FixtureAccessError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No verification fixture available for this case")

    if raw_data.get("case_metadata", {}).get("case_id") != case_id:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Case ID mismatch between request and dataset",
        )

    normalized = normalize_evidence(raw_data)
    report = generate_prosecutor_report(normalized)
    return report