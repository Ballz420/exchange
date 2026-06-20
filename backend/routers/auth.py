import hashlib
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from database import get_connection

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Simple in-memory token store for MVP
# In production, use JWT or OAuth2
tokens = {}


class RegisterRequest(BaseModel):
    username: str
    password: str
    role: str = "buyer"  # buyer, seller, or admin


class LoginRequest(BaseModel):
    username: str
    password: str


def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()


def generate_token() -> str:
    return secrets.token_hex(32)


@router.post("/register")
def register(req: RegisterRequest):
    if req.role not in ("buyer", "seller", "admin"):
        raise HTTPException(status_code=400, detail="Role must be buyer, seller, or admin")

    conn = get_connection()
    cursor = conn.cursor()

    try:
        cursor.execute(
            "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
            (req.username, hash_password(req.password), req.role),
        )
        conn.commit()
        user_id = cursor.lastrowid
    except Exception as e:
        conn.close()
        if "UNIQUE" in str(e):
            raise HTTPException(status_code=400, detail="Username already exists")
        raise HTTPException(status_code=500, detail=str(e))

    conn.close()
    return {"id": user_id, "username": req.username, "role": req.role}


@router.post("/login")
def login(req: LoginRequest):
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute(
        "SELECT id, username, role FROM users WHERE username = ? AND password_hash = ?",
        (req.username, hash_password(req.password)),
    )
    user = cursor.fetchone()
    conn.close()

    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = generate_token()
    tokens[token] = {
        "user_id": user["id"],
        "username": user["username"],
        "role": user["role"],
    }

    return {
        "token": token,
        "user_id": user["id"],
        "username": user["username"],
        "role": user["role"],
    }


def get_current_user(token: str):
    """Look up a user from a token. Called from other routers."""
    user = tokens.get(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return user