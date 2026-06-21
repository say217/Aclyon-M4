import os
import secrets
import smtplib
from datetime import datetime, timedelta
from email.message import EmailMessage
from pathlib import Path

import bcrypt
import sqlite3
from fastapi import APIRouter, Form, Request, status
from fastapi.responses import RedirectResponse
from fastapi.templating import Jinja2Templates

router = APIRouter()

templates = Jinja2Templates(directory=str(Path(__file__).resolve().parent / "templates"))

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass


def get_env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    return int(value)

SECRET_KEY = os.getenv("SECRET_KEY", "")

# SQLite Database path: defaults to database.db in project root
DB_PATH = os.getenv("SQLITE_DB_PATH", str(Path(__file__).resolve().parents[3] / "database.db"))

SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = get_env_int(name="SMTP_PORT", default=587)
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_SENDER = os.getenv("SMTP_SENDER", "")
SMTP_USE_TLS = os.getenv("SMTP_USE_TLS", "true").lower() == "true"
SMTP_USE_SSL = os.getenv("SMTP_USE_SSL", "false").lower() == "true"
BASE_URL = os.getenv("BASE_URL", "http://127.0.0.1:8000")
VERIFY_TOKEN_TTL_MINUTES = get_env_int(name="VERIFY_CODE_EXP_MINUTES", default=10)


def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def ensure_tables():
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                is_verified INTEGER NOT NULL DEFAULT 0,
                verification_code TEXT,
                code_expires_at TEXT
            )
            """
        )
        conn.commit()
    finally:
        conn.close()

def send_verification_email(recipient_email: str, code: str) -> str | None:
    if not SMTP_USER or not SMTP_PASSWORD:
        return "SMTP credentials are missing. Set SMTP_USER and SMTP_PASSWORD."

    html_body = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#07070A;font-family:'Inter',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#07070A;padding:48px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:420px;">

          <!-- Brand -->
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <span style="font-size:20px;font-weight:600;color:#ffffff;letter-spacing:-0.4px;">
                Aclyon <span style="color:#22D3EE;">M4</span>
              </span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#0C0C10;border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:36px 32px;">

              <p style="margin:0 0 6px;font-size:20px;font-weight:600;color:#ffffff;letter-spacing:-0.4px;">
                Verify your account
              </p>
              <p style="margin:0 0 28px;font-size:13px;color:#6E7380;line-height:1.6;">
                Use the code below to activate your Aclyon M4 account. It expires in 10 minutes.
              </p>

              <!-- Code block -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="background:#111116;border:1px solid rgba(34,211,238,0.15);border-radius:10px;padding:20px;">
                    <span style="font-size:32px;font-weight:600;letter-spacing:10px;color:#22D3EE;">
                      {code}
                    </span>
                  </td>
                </tr>
              </table>

              <p style="margin:24px 0 0;font-size:12px;color:#6E7380;line-height:1.6;">
                If you didn't create an account, you can safely ignore this email.
                This code will expire automatically.
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:24px;">
              <p style="margin:0;font-size:12px;color:#3A3D45;">
                &copy; 2026 Aclyon. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""

    plain_body = (
        f"Aclyon M4 — Verify your account\n\n"
        f"Your verification code: {code}\n\n"
        f"It expires in 10 minutes.\n"
        f"If you didn't sign up, ignore this email."
    )

    message = EmailMessage()
    message["Subject"] = "Your Aclyon M4 verification code"
    message["From"] = SMTP_SENDER or SMTP_USER
    message["To"] = recipient_email
    message.set_content(plain_body)
    message.add_alternative(html_body, subtype="html")

    if SMTP_USE_SSL:
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT) as server:
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.send_message(message)
    else:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            if SMTP_USE_TLS:
                server.starttls()
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.send_message(message)

    return None

@router.get("/")
def home(request: Request):
    return RedirectResponse(url="/app2/login", status_code=status.HTTP_303_SEE_OTHER)


@router.get("/signup")
def signup_form(request: Request):
    return templates.TemplateResponse("signup.html", {"request": request})


@router.post("/signup")
def signup(
    request: Request,
    email: str = Form(...),
    username: str = Form(...),
    password: str = Form(...),
):
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM users WHERE email = ? OR username = ?", (email, username))
        if cursor.fetchone():
            return templates.TemplateResponse(
                "signup.html",
                {"request": request, "error": "Email or username already exists."},
            )

        password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        verification_code = f"{secrets.randbelow(1000000):06d}"
        expires_at = (datetime.utcnow() + timedelta(minutes=VERIFY_TOKEN_TTL_MINUTES)).isoformat()

        cursor.execute(
            """
            INSERT INTO users (email, username, password_hash, is_verified, verification_code, code_expires_at)
            VALUES (?, ?, ?, 0, ?, ?)
            """,
            (email, username, password_hash, verification_code, expires_at),
        )
        conn.commit()
    finally:
        conn.close()

    error = send_verification_email(email, verification_code)
    if error:
        return templates.TemplateResponse(
            "verify.html",
            {"request": request, "error": error, "email": email},
        )

    return templates.TemplateResponse(
        "verify.html",
        {"request": request, "email": email, "message": "Verification code sent."},
    )


@router.get("/verify")
def verify_form(request: Request, email: str | None = None):
    return templates.TemplateResponse(
        "verify.html",
        {"request": request, "email": email},
    )


@router.post("/verify")
def verify_account(request: Request, email: str = Form(...), code: str = Form(...)):
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT id, code_expires_at, is_verified, verification_code
            FROM users
            WHERE email = ?
            """,
            (email,),
        )
        user = cursor.fetchone()

        if not user:
            return templates.TemplateResponse(
                "verify.html",
                {"request": request, "error": "Email not found.", "email": email},
            )

        if user["is_verified"]:
            request.session["user_id"] = user["id"]
            request.session["is_verified"] = True
            return RedirectResponse(url="/app1/", status_code=status.HTTP_303_SEE_OTHER)

        if user["code_expires_at"]:
            expires_dt = datetime.fromisoformat(user["code_expires_at"])
            if expires_dt < datetime.utcnow():
                return templates.TemplateResponse(
                    "verify.html",
                    {"request": request, "error": "Verification code has expired.", "email": email},
                )

        if user["verification_code"] != code:
            return templates.TemplateResponse(
                "verify.html",
                {"request": request, "error": "Invalid verification code.", "email": email},
            )

        cursor.execute(
            """
            UPDATE users
            SET is_verified = 1, verification_code = NULL, code_expires_at = NULL
            WHERE id = ?
            """,
            (user["id"],),
        )
        conn.commit()
    finally:
        conn.close()

    request.session["user_id"] = user["id"]
    request.session["is_verified"] = True
    return RedirectResponse(url="/app1/", status_code=status.HTTP_303_SEE_OTHER)


@router.get("/login")
def login_form(request: Request):
    return templates.TemplateResponse("login.html", {"request": request})


@router.post("/login")
def login(request: Request, email: str = Form(...), password: str = Form(...)):
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, password_hash, is_verified FROM users WHERE email = ?",
            (email,),
        )
        user = cursor.fetchone()
    finally:
        conn.close()

    if not user:
        return templates.TemplateResponse(
            "login.html",
            {"request": request, "error": "Invalid email or password."},
        )

    if not user["is_verified"]:
        return templates.TemplateResponse(
            "login.html",
            {
                "request": request,
                "error": "Please verify your email before logging in.",
                "email": email,
            },
        )

    if not bcrypt.checkpw(password.encode("utf-8"), user["password_hash"].encode("utf-8")):
        return templates.TemplateResponse(
            "login.html",
            {"request": request, "error": "Invalid email or password."},
        )

    request.session["user_id"] = user["id"]
    request.session["is_verified"] = True
    response = RedirectResponse(url="/app1/", status_code=status.HTTP_303_SEE_OTHER)
    return response


@router.get("/logout")
def logout(request: Request):
    request.session.clear()
    return RedirectResponse(url="/app2/login", status_code=status.HTTP_303_SEE_OTHER)


ensure_tables()



