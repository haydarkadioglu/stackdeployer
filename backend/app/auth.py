from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import os

import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .database import get_db
from .models import User
from .schemas import BootstrapRequest, CurrentUserOut, LoginRequest, TokenResponse

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])
security = HTTPBearer(auto_error=False)


def _hash_password(password: str, salt: str | None = None) -> str:
    resolved_salt = salt or os.urandom(16).hex()
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), resolved_salt.encode("utf-8"), 390000)
    return f"{resolved_salt}${digest.hex()}"


def _verify_password(password: str, password_hash: str) -> bool:
    parts = password_hash.split("$", 1)
    if len(parts) != 2:
        return False
    salt, _stored_digest = parts
    computed = _hash_password(password, salt)
    return hmac.compare_digest(computed, password_hash)


def _create_access_token(user: User) -> str:
    now = datetime.now(timezone.utc)
    expires = now + timedelta(minutes=settings.jwt_access_token_expire_minutes)
    payload = {
        "sub": str(user.id),
        "username": user.username,
        "is_superuser": user.is_superuser,
        "exp": expires,
        "iat": now,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")

    token = credentials.credentials
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        user_id = int(payload.get("sub", 0))
    except (jwt.InvalidTokenError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token") from exc

    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin privileges required")
    return user


@router.post("/bootstrap", response_model=CurrentUserOut, status_code=status.HTTP_201_CREATED)
def bootstrap_admin(payload: BootstrapRequest, db: Session = Depends(get_db)) -> User:
    existing = db.execute(select(User).limit(1)).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Bootstrap already completed")

    user = User(
        username=payload.username,
        password_hash=_hash_password(payload.password),
        is_active=True,
        is_superuser=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    user = db.execute(select(User).where(User.username == payload.username)).scalar_one_or_none()
    if not user or not _verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    token = _create_access_token(user)
    return TokenResponse(access_token=token)


@router.get("/me", response_model=CurrentUserOut)
def me(current_user: User = Depends(get_current_user)) -> User:
    return current_user
