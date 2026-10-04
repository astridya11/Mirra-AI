from fastapi import APIRouter, Depends, HTTPException, status
from app.db.auth import user_repo
from app.auth.dependencies import get_current_user
from app.schemas.auth import (
    TokenResponse,
    UserAccount,
    UserLoginRequest,
    UserResponse,
    UserSignUpRequest,
)
from app.auth.security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/api/v1/auth", tags=["Authentication"])


@router.post("/signup", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def signup(req: UserSignUpRequest):
    """Register a new user, store in users.json, and return JWT access token."""
    if user_repo.get_by_email(req.email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User with this email already exists.",
        )

    party_id = user_repo.generate_party_id(req.party.value)
    hashed_pw = hash_password(req.password)

    new_user = UserAccount(
        party=req.party,
        party_id=party_id,
        name=req.name,
        email=req.email,
        password=hashed_pw,
        account_age_days=0,
        total_trips=0,
        avg_rating=5.0,
        risk_score=0.0,
        dispute_history_30d=0,
        dispute_history_90d=0,
        bad_faith_flag=False,
    )

    created_user = user_repo.create_user(new_user)

    # Issue JWT token
    token_claims = {
        "sub": created_user.party_id,
        "email": created_user.email,
        "party": created_user.party.value,
        "bad_faith_flag": created_user.bad_faith_flag,
    }
    access_token = create_access_token(data=token_claims)

    user_resp = UserResponse(**created_user.model_dump())
    return TokenResponse(access_token=access_token, user=user_resp)


@router.post("/login", response_model=TokenResponse)
def login(req: UserLoginRequest):
    """Authenticate existing credentials and return JWT access token."""
    user = user_repo.get_by_email(req.email)
    if not user or not verify_password(req.password, user.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Issue JWT token
    token_claims = {
        "sub": user.party_id,
        "email": user.email,
        "party": user.party.value,
        "bad_faith_flag": user.bad_faith_flag,
    }
    access_token = create_access_token(data=token_claims)

    user_resp = UserResponse(**user.model_dump())
    return TokenResponse(access_token=access_token, user=user_resp)


@router.get("/me", response_model=UserResponse)
def get_me(current_user: UserAccount = Depends(get_current_user)):
    """Fetch current authenticated user profile."""
    return UserResponse(**current_user.model_dump())