from typing import List
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from app.db.auth import user_repo
from app.schemas.auth import PartyRole, TokenPayload, UserAccount
from app.auth.security import decode_access_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


def get_current_user(token: str = Depends(oauth2_scheme)) -> UserAccount:
    """Validate bearer token and retrieve active UserAccount."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    payload_dict = decode_access_token(token)
    if payload_dict is None:
        raise credentials_exception

    try:
        token_data = TokenPayload(**payload_dict)
    except Exception:
        raise credentials_exception

    user = user_repo.get_by_party_id(token_data.sub)
    if user is None:
        raise credentials_exception

    return user


class RequireRole:
    """Dependency for enforcing Role-Based Access Control (RBAC)."""

    def __init__(self, allowed_roles: List[PartyRole]):
        self.allowed_roles = allowed_roles

    def __call__(self, current_user: UserAccount = Depends(get_current_user)) -> UserAccount:
        if current_user.party not in self.allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Requires one of roles: {[r.value for r in self.allowed_roles]}",
            )
        return current_user