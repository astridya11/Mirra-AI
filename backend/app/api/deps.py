from fastapi import Header, HTTPException, status

from app.models.case import Case


# ponytail: identity comes from a plain header instead of JWT/OAuth. The hackathon's own
# DBS DCTA challenge explicitly allows mock auth/gateway services for the MVP; swap this
# for real session/token verification (e.g. Tencent Cloud login) before production use.
def get_current_party_id(x_party_id: str = Header(..., alias="X-Party-Id")) -> str:
    if not x_party_id.strip():
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "X-Party-Id header is required")
    return x_party_id


def ensure_case_party(case: Case, party_id: str) -> None:
    """Private Assistance guard: a party may only reach case data they're part of."""
    if party_id not in (case.rider_id, case.driver_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a party to this case")
