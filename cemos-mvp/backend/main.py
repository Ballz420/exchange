"""
FASEM-P Exchange Backend — Pure API for PPU Trading

Endpoints:
  System     /api/health, /api/db/*
  Auth       /api/auth/register, /api/auth/login
  Admin      /api/admin/instruments, /api/admin/cash, /api/admin/ppu
  Market     /api/instruments, /api/orderbook/{id}
  Trading    /api/orders/place, /api/orders/cancel/{id}, /api/trades
  Accounting /api/accounts/{user_id}, /api/ledger/{user_id}, /api/reconcile
  Profit     /api/profit/*
"""
import hashlib, secrets, os, json, time, re
import bcrypt
from datetime import datetime, timedelta
from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect, Request
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, FileResponse
from pydantic import BaseModel, Field
from database import init_db, get_connection, DB_PATH
import logging, sys

# Structured JSON logging
class JsonFormatter(logging.Formatter):
    def format(self, record):
        import json, datetime
        return json.dumps({
            "time": datetime.datetime.utcnow().isoformat(),
            "level": record.levelname,
            "event": record.getMessage(),
            "module": record.module,
            "line": record.lineno
        })

logger = logging.getLogger("fasem")
logger.setLevel(logging.INFO)
handler = logging.StreamHandler(sys.stdout)
handler.setFormatter(JsonFormatter())
logger.addHandler(handler)
logging.getLogger("uvicorn.access").disabled = True

from ledger import post_double, get_balance, get_statement, reconcile as rec_ledger
from pnl import user_pnl, avg_cost_basis

# === INIT ===
init_db()

# === ADD MISSING COLUMNS FOR NEW FEATURES ===

def _migrate_db():
    """Add missing columns/tables for admin features."""
    conn = get_connection()
    c = conn.cursor()
    # Add status column to users if missing
    try:
        c.execute("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'suspended'))")
    except Exception:
        pass
    # Create admin_transactions table if missing
    c.executescript("""
        CREATE TABLE IF NOT EXISTS admin_transactions (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            type            TEXT NOT NULL CHECK(type IN ('cash_credit', 'ppu_credit', 'cash_debit', 'ppu_debit')),
            admin_id        INTEGER NOT NULL REFERENCES users(id),
            user_id         INTEGER NOT NULL REFERENCES users(id),
            amount          REAL NOT NULL DEFAULT 0,
            instrument_id   INTEGER REFERENCES instruments(id),
            balance_before  REAL NOT NULL DEFAULT 0,
            balance_after   REAL NOT NULL DEFAULT 0,
            description     TEXT DEFAULT '',
            created_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );
    """)
    # Add company_id and series_label to instruments if missing
    try:
        c.execute("ALTER TABLE instruments ADD COLUMN company_id INTEGER REFERENCES companies(id)")
    except Exception:
        pass
    try:
        c.execute("ALTER TABLE instruments ADD COLUMN series_label TEXT DEFAULT ''")
    except Exception:
        pass
    try:
        c.execute("ALTER TABLE instruments ADD COLUMN raise_target REAL DEFAULT 0")
    except Exception:
        pass
    try:
        c.execute("ALTER TABLE instruments ADD COLUMN price_per_ppu REAL DEFAULT NULL")
    except Exception:
        pass
    # Create companies table if missing
    c.executescript("""
        CREATE TABLE IF NOT EXISTS companies (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            name            TEXT UNIQUE NOT NULL,
            description     TEXT DEFAULT '',
            industry        TEXT DEFAULT '',
            country         TEXT DEFAULT '',
            founder_names   TEXT DEFAULT '',
            total_float_pct REAL DEFAULT 25.0 CHECK(total_float_pct > 0 AND total_float_pct <= 100),
            retained_pct    REAL DEFAULT 75.0 CHECK(retained_pct >= 0 AND retained_pct < 100),
            kyc_status      TEXT NOT NULL DEFAULT 'pending' CHECK(kyc_status IN ('pending','verified','rejected')),
            status          TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','suspended')),
            created_by      INTEGER NOT NULL REFERENCES users(id),
            created_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );
    """)
    # Create sessions table for token management
    c.executescript("""
        CREATE TABLE IF NOT EXISTS sessions (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL REFERENCES users(id),
            token       TEXT UNIQUE NOT NULL,
            expires_at  REAL NOT NULL,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            last_used   TEXT
        );
        CREATE TABLE IF NOT EXISTS audit_log (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            admin_id    INTEGER REFERENCES users(id),
            action      TEXT NOT NULL,
            target_type TEXT,
            target_id   INTEGER,
            details     TEXT DEFAULT '',
            ip_address  TEXT DEFAULT '',
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
    """)
    try:
        c.execute("CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token)")
    except Exception: pass
    try:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS kyc_submissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
            full_name TEXT DEFAULT '',
            nationality TEXT DEFAULT '',
            country TEXT DEFAULT '',
            document_type TEXT DEFAULT 'passport',
            kyc_level TEXT NOT NULL DEFAULT 'unverified',
            risk_score INTEGER DEFAULT 0,
            reviewed_by INTEGER REFERENCES users(id),
            reviewed_at TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS sanctions_hits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id),
            list_name TEXT NOT NULL,
            matched_name TEXT NOT NULL,
            severity TEXT DEFAULT 'medium',
            status TEXT DEFAULT 'open',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS transaction_alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            alert_type TEXT NOT NULL,
            user_id INTEGER REFERENCES users(id),
            severity TEXT DEFAULT 'medium',
            description TEXT DEFAULT '',
            status TEXT DEFAULT 'open',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS travel_rule_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id),
            transaction_type TEXT NOT NULL,
            amount REAL NOT NULL,
            counterparty_name TEXT DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
    """)
    except Exception: pass
    try:
        c.execute("CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)")
    except Exception: pass
    conn.commit()
    conn.close()


_migrate_db()

app = FastAPI(title="FASEM-P Exchange", version="2.0.0", docs_url="/docs")
app.add_middleware(CORSMiddleware, allow_origins=os.getenv("CORS_ORIGINS", "*").split(","), allow_credentials=True, allow_methods=["*"], allow_headers=["*", "Authorization"])
@app.middleware("http")
async def log_requests(request: Request, call_next):
    import time
    start = time.time()
    response = await call_next(request)
    duration = round((time.time() - start) * 1000, 1)
    logger.info("request", extra={
        "method": request.method,
        "path": request.url.path,
        "status": response.status_code,
        "duration_ms": duration,
        "ip": request.client.host if request.client else "unknown"
    })
    return response

@app.middleware("http")
async def add_rate_headers(request: Request, call_next):
    response = await call_next(request)
    ip = request.client.host if request.client else "unknown"
    remaining = 100
    if ip in _rate_limits:
        count, start = _rate_limits[ip]
        remaining = max(0, 100 - count)
    response.headers["X-RateLimit-Remaining"] = str(remaining)
    return response


# ====================== WEBSOCKET MANAGER ======================

class ConnectionManager:
    """Manages WebSocket connections per instrument_id."""
    def __init__(self):
        self.connections: dict[int, list[WebSocket]] = {}

    async def connect(self, instrument_id: int, ws: WebSocket):
        await ws.accept()
        if instrument_id not in self.connections:
            self.connections[instrument_id] = []
        self.connections[instrument_id].append(ws)

    def disconnect(self, instrument_id: int, ws: WebSocket):
        if instrument_id in self.connections:
            self.connections[instrument_id] = [c for c in self.connections[instrument_id] if c != ws]
            if not self.connections[instrument_id]:
                del self.connections[instrument_id]

    async def broadcast_orderbook(self, instrument_id: int):
        if instrument_id not in self.connections: return
        conn = get_connection()
        try:
            bids = conn.execute("SELECT id, price, quantity, filled_quantity, (quantity - filled_quantity) as remaining FROM orders WHERE instrument_id=? AND side='buy' AND status IN ('open','partially_filled') ORDER BY price DESC", (instrument_id,)).fetchall()
            asks = conn.execute("SELECT id, price, quantity, filled_quantity, (quantity - filled_quantity) as remaining FROM orders WHERE instrument_id=? AND side='sell' AND status IN ('open','partially_filled') ORDER BY price ASC", (instrument_id,)).fetchall()
            best_bid = bids[0]["price"] if bids else None
            best_ask = asks[0]["price"] if asks else None
            spread = round(best_ask - best_bid, 2) if (best_bid and best_ask) else None
            mid = round((best_bid + best_ask) / 2, 2) if (best_bid and best_ask) else None
            data = json.dumps({
                "type": "orderbook",
                "instrument_id": instrument_id,
                "bids": [dict(r) for r in bids],
                "asks": [dict(r) for r in asks],
                "best_bid": best_bid,
                "best_ask": best_ask,
                "spread": spread,
                "mid_price": mid,
            })
            dead = []
            for ws in self.connections.get(instrument_id, []):
                try: await ws.send_text(data)
                except Exception: dead.append(ws)
            for ws in dead:
                self.disconnect(instrument_id, ws)
        finally:
            conn.close()

manager = ConnectionManager()

def broadcast_ob(instrument_id: int):
    """Fire-and-forget orderbook broadcast from sync code."""
    import asyncio
    loop = asyncio.get_event_loop()
    if loop.is_running():
        loop.create_task(manager.broadcast_orderbook(instrument_id))


@app.websocket("/ws/{instrument_id}")
async def websocket_endpoint(ws: WebSocket, instrument_id: int):
    # Limit: max 10 concurrent WS connections per instrument
    if instrument_id in manager.connections and len(manager.connections[instrument_id]) >= 10:
        await ws.close(code=1008, reason="Too many connections")
        return
    await manager.connect(instrument_id, ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(instrument_id, ws)


# === SIMPLE AUTH (bcrypt + sessions) ===

# Rate limiter: {ip: [count, window_start]}
_rate_limits = {}

def rate_limit(ip: str = None, limit: int = 30, window: int = 60):
    """Simple in-memory rate limiter. Returns True if allowed."""
    now = time.time()
    key = ip
    if key not in _rate_limits:
        _rate_limits[key] = [1, now]
        return True
    count, start = _rate_limits[key]
    if now - start > window:
        _rate_limits[key] = [1, now]
        return True
    if count >= limit:
        return False
    _rate_limits[key][0] += 1
    return True

def hash_pw(pw: str = None) -> str:
    """bcrypt hash with automatic salt."""
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()

def check_pw(pw: str = None, hashed: str = None) -> bool:
    """Verify password against bcrypt hash."""
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False

def gen_token() -> str:
    """Generate a secure random token."""
    return secrets.token_hex(32)

TOKEN_EXPIRY_HOURS = int(os.getenv("TOKEN_EXPIRY_HOURS", "24"))
TOKEN_EXPIRY_SECONDS = TOKEN_EXPIRY_HOURS * 3600

def create_session(user_id: int) -> dict:
    """Create a new session, store in DB, return token info."""
    token = gen_token()
    expires_at = time.time() + TOKEN_EXPIRY_SECONDS
    conn = get_connection()
    conn.execute(
        "INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)",
        (user_id, token, expires_at)
    )
    conn.commit()
    conn.close()
    return {"token": token, "expires_at": expires_at}

def get_user_from_token(token: str = None):
    """Validate token, return user dict or None.
    Checks Authorization: Bearer <token> or ?token=<token> format.
    Auto-extends session on use."""
    if not token:
        return None
    conn = get_connection()
    row = conn.execute(
        "SELECT s.user_id, s.expires_at, u.username, u.role, u.status FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.token=?",
        (token,)
    ).fetchone()
    if not row:
        conn.close()
        return None
    # Check expiry
    if time.time() > row["expires_at"]:
        conn.execute("DELETE FROM sessions WHERE token=?", (token,))
        conn.commit()
        conn.close()
        return None
    # Check if user is suspended
    if row["status"] == "suspended":
        conn.close()
        return None
    # Auto-extend: refresh expiry on use
    new_expiry = time.time() + TOKEN_EXPIRY_SECONDS
    conn.execute("UPDATE sessions SET expires_at=?, last_used=datetime('now') WHERE token=?", (new_expiry, token))
    conn.commit()
    conn.close()
    return {"user_id": row["user_id"], "username": row["username"], "role": row["role"]}

def extract_token(request) -> str:
    """Extract token from Authorization header or ?token= param."""
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    # Fallback: check query params (deprecated)
    token = request.query_params.get("token")
    if token:
        pass  # Accept but prefer header
    return token

def get_user(request):
    """Get authenticated user from request. Raises 401 if invalid."""
    token = extract_token(request)
    u = get_user_from_token(token)
    if not u:
        from fastapi import HTTPException
        raise HTTPException(401, "Invalid or expired token")
    return u

def get_user(token_or_request):
    """Get user from string token or Request object."""
    if isinstance(token_or_request, str):
        u = get_user_from_token(token_or_request)
        if not u:
            from fastapi import HTTPException
            raise HTTPException(401, "Invalid or expired token")
        return u
    return _get_user_from_request(token_or_request)

def require_admin(token_or_request):
    u = get_user(token_or_request)
    if u["role"] != "admin":
        from fastapi import HTTPException
        raise HTTPException(403, "Admin required")
    return u

def log_audit(admin_id: int, action: str = None, target_type: str = None, target_id: int = None, details: str = "", ip: str = ""):
    """Log an admin action to the audit trail."""
    try:
        conn = get_connection()
        conn.execute(
            "INSERT INTO audit_log (admin_id, action, target_type, target_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)",
            (admin_id, action, target_type, target_id, details, ip)
        )
        conn.commit()
        conn.close()
    except Exception:
        pass  # Audit should never break the main flow

# ====================== AUTH ======================

class RegisterReq(BaseModel):
    username: str
    password: str
    role: str = "trader"

class LoginReq(BaseModel):
    username: str
    password: str

@app.post("/api/auth/register")
def register(req: RegisterReq, request: Request = None):
    if req.role not in ("trader", "admin"):
        raise HTTPException(400, "Role must be trader or admin")
    conn = get_connection()
    try:
        cur = conn.execute("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
                     (req.username, hash_pw(req.password), req.role))
        conn.commit()
        uid = cur.lastrowid
    except Exception as e:
        raise HTTPException(400, "Username taken" if "UNIQUE" in str(e) else str(e))
    finally:
        conn.close()
    
    # Auto-submit with registration data
    try:
        screen_sanctions(uid, req.username)
    except Exception:
        pass
    return {"id": uid, "username": req.username, "role": req.role}

@app.post("/api/auth/login")
def login(req: LoginReq, request: Request = None):
    conn = get_connection()
    u = conn.execute(
        "SELECT id, username, role, status, password_hash FROM users WHERE username=?",
        (req.username,)
    ).fetchone()
    conn.close()
    if not u or not check_pw(req.password, u["password_hash"]): raise HTTPException(401, "Invalid credentials")
    if u["status"] == "suspended":
        raise HTTPException(403, "Account is suspended")
    session = create_session(u["id"])
    return {"token": session["token"], "user_id": u["id"], "username": u["username"], "role": u["role"]}

# ====================== DB VIEWER ======================

@app.get("/api/db/schema")
def db_schema():
    conn = get_connection()
    rows = conn.execute("SELECT sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL ORDER BY name").fetchall()
    conn.close()
    return {"tables": [r["sql"] for r in rows]}

@app.get("/api/db/tables")
def db_tables():
    conn = get_connection()
    rows = conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall()
    result = []
    for r in rows:
        cnt = conn.execute(f"SELECT COUNT(*) as c FROM [{r['name']}]").fetchone()["c"]
        result.append({"name": r["name"], "rows": cnt})
    conn.close()
    return result

@app.get("/api/db/table/{table}")
def db_table(table: str = None, human: int = 0, limit: int = 100):
    conn = get_connection()
    valid = [r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    if table not in valid:
        conn.close()
        raise HTTPException(404, f"Table '{table}' not found")
    rows = conn.execute(f"SELECT * FROM [{table}] ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    conn.close()
    data = [dict(r) for r in rows]

    if human:
        # Enrich with user/instrument names
        uk = {}  # user_id cache
        ik = {}  # instrument_id cache
        for row in data:
            for key in list(row.keys()):
                if "user_id" in key or key == "buyer_id" or key == "seller_id":
                    uid = row[key]
                    if uid and uid not in uk:
                        c = get_connection()
                        uu = c.execute("SELECT username FROM users WHERE id=?", (uid,)).fetchone()
                        c.close()
                        uk[uid] = uu["username"] if uu else f"#{uid}"
                    row[f"{key}_name"] = uk.get(uid, f"#{uid}")
                if "instrument_id" in key or key == "instrument_id":
                    iid = row[key]
                    if iid and iid not in ik:
                        c = get_connection()
                        ii = c.execute("SELECT name FROM instruments WHERE id=?", (iid,)).fetchone()
                        c.close()
                        ik[iid] = ii["name"] if ii else f"#{iid}"
                    row[f"{key}_name"] = ik.get(iid, f"#{iid}")
    return data

# ====================== ADMIN ======================

class InstrumentCreate(BaseModel):
    token: str = None
    name: str
    description: str = ""
    total_float: float = Field(..., gt=0)
    company_id: int = None
    series_label: str = ""
    raise_target: float = 0
    price_per_ppu: float = None

@app.post("/api/admin/instruments")
def admin_create_instrument(req: InstrumentCreate):
    require_admin(req.token)
        # KYC enforcement
    conn = get_connection()
    if req.company_id:
        comp = conn.execute("SELECT kyc_status, status FROM companies WHERE id=?", (req.company_id,)).fetchone()
        if not comp:
            raise HTTPException(404, "Company not found")
        if comp["kyc_status"] != "verified":
            raise HTTPException(400, "Company KYC must be verified before issuing series")
        if comp["status"] != "active":
            raise HTTPException(400, "Company must be active to issue series")
    try:
        cur = conn.execute("INSERT INTO instruments (name, description, total_float, created_by) VALUES (?, ?, ?, ?)",
                     (req.name, req.description, req.total_float, req.token))
        conn.commit()
        iid = cur.lastrowid
    except Exception as e:
        conn.close()
        raise HTTPException(400, "Name taken" if "UNIQUE" in str(e) else str(e))
    conn.close()
    return {"instrument_id": iid, "name": req.name, "total_float": req.total_float, "message": "PPU instrument listed (IPO)"}

@app.put("/api/admin/instruments/{instrument_id}")
def admin_update_instrument(instrument_id: int, token: str = None, status: str = Query(None)):
    require_admin(token)
    if status and status not in ("active", "delisted"):
        raise HTTPException(400, "Status must be active or delisted")
    conn = get_connection()
    if status:
        conn.execute("UPDATE instruments SET status=? WHERE id=?", (status, instrument_id))
    conn.commit()
    conn.close()
    return {"message": f"Instrument updated to '{status}'"}

class CashCredit(BaseModel):
    token: str = None
    user_id: int
    amount: float = Field(..., gt=0)

@app.post("/api/admin/cash/credit")
def admin_cash_credit(req: CashCredit):
    admin = require_admin(req.token)
    bal_before = get_balance(req.user_id, "cash")
    post_double("cash", 0, req.user_id, req.amount, description=f"Admin cash credit: ${req.amount}")
    bal_after = get_balance(req.user_id, "cash")
    # Log transaction
    conn = get_connection()
    conn.execute(
        "INSERT INTO admin_transactions (type, admin_id, user_id, amount, balance_before, balance_after, description) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ("cash_credit", admin["user_id"], req.user_id, req.amount, bal_before, bal_after, f"Admin cash credit: ${req.amount}")
    )
    conn.commit()
    conn.close()
    return {"message": f"Credited ${req.amount} to user {req.user_id}", "new_balance": bal_after}

class PPUCredit(BaseModel):
    token: str = None
    user_id: int
    instrument_id: int
    units: float = Field(..., gt=0)

@app.post("/api/admin/ppu/credit")
def admin_ppu_credit(req: PPUCredit):
    admin = require_admin(req.token)
    bal_before = get_balance(req.user_id, "ppu", req.instrument_id)
    # Credit PPUs from the system (user 0 = exchange account)
    post_double("ppu", 0, req.user_id, req.units, instrument_id=req.instrument_id, description=f"Admin PPU credit: {req.units} units")
    # Update ppu_holdings
    conn = get_connection()
    cur = conn.execute("INSERT INTO ppu_holdings (user_id, instrument_id, units) VALUES (?, ?, ?) ON CONFLICT(user_id, instrument_id) DO UPDATE SET units = units + ?",
                 (req.user_id, req.instrument_id, req.units, req.units))
    bal_after = get_balance(req.user_id, "ppu", req.instrument_id)
    # Log transaction
    conn.execute(
        "INSERT INTO admin_transactions (type, admin_id, user_id, amount, instrument_id, balance_before, balance_after, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ("ppu_credit", admin["user_id"], req.user_id, req.units, req.instrument_id, bal_before, bal_after, f"Admin PPU credit: {req.units} units")
    )
    conn.commit()
    conn.close()
    return {"message": f"Credited {req.units} PPUs to user {req.user_id}", "new_balance": bal_after}

# ====================== BACKEND GAP 5.1: TRANSACTION HISTORY ======================

@app.get("/api/admin/transactions")
def admin_transactions(token: str = None, type: str = None, user_id: int = None, limit: int = 100):
    """Audit log of all cash/PPU credits by admins."""
    require_admin(token)
    conn = get_connection()
    q = """SELECT t.*, a.username as admin_username, u.username as username
           FROM admin_transactions t
           JOIN users a ON t.admin_id=a.id
           JOIN users u ON t.user_id=u.id
           WHERE 1=1"""
    p = []
    if type:
        q += " AND t.type=?"
        p.append(type)
    if user_id:
        q += " AND t.user_id=?"
        p.append(user_id)
    q += " ORDER BY t.created_at DESC LIMIT ?"
    p.append(limit)
    rows = conn.execute(q, p).fetchall()
    conn.close()
    return [dict(r) for r in rows]

# ====================== BACKEND GAP 5.2: SUSPEND / REACTIVATE USER ======================

@app.put("/api/admin/users/{user_id}/status")
def admin_user_status(user_id: int, token: str = None, status: str = Query(...)):
    """Suspend or reactivate a user. Prevents login when suspended."""
    require_admin(token)
    if status not in ("active", "suspended"):
        raise HTTPException(400, "Status must be 'active' or 'suspended'")
    conn = get_connection()
    user = conn.execute("SELECT id, username, status FROM users WHERE id=?", (user_id,)).fetchone()
    if not user:
        conn.close()
        raise HTTPException(404, "User not found")
    if user["username"] == "system":
        conn.close()
        raise HTTPException(400, "Cannot suspend system account")
    conn.execute("UPDATE users SET status=? WHERE id=?", (status, user_id))
    conn.commit()
    conn.close()
    return {"message": f"User {user_id} status set to '{status}'", "username": user["username"]}

# ====================== BACKEND GAP 5.3: CHANGE USER ROLE ======================

@app.put("/api/admin/users/{user_id}/role")
def admin_user_role(user_id: int, token: str = None, role: str = Query(...)):
    """Promote/demote a user's role (admin/trader)."""
    require_admin(token)
    if role not in ("trader", "admin"):
        raise HTTPException(400, "Role must be 'trader' or 'admin'")
    conn = get_connection()
    user = conn.execute("SELECT id, username FROM users WHERE id=?", (user_id,)).fetchone()
    if not user:
        conn.close()
        raise HTTPException(404, "User not found")
    if user["username"] == "system":
        conn.close()
        raise HTTPException(400, "Cannot change system account role")
    conn.execute("UPDATE users SET role=? WHERE id=?", (role, user_id))
    conn.commit()
    conn.close()
    return {"message": f"User {user_id} role changed to '{role}'", "username": user["username"]}

# ====================== BACKEND GAP 5.4: FORCE-CANCEL ORDER ======================

@app.post("/api/admin/orders/force-cancel/{order_id}")
def admin_force_cancel_order(order_id: int, token: str = None):
    """Force-cancel any order (even filled/cancelled) for regulatory purposes.
       Reverses any trades associated with the order."""
    require_admin(token)
    conn = get_connection()
    order = conn.execute("SELECT id, user_id, instrument_id, side, quantity, filled_quantity, status FROM orders WHERE id=?", (order_id,)).fetchone()
    if not order:
        conn.close()
        raise HTTPException(404, "Order not found")

    reversed_trades = []

    # If order had fills, reverse associated trades
    if order["filled_quantity"] > 0:
        # Find trades involving this order
        if order["side"] == "buy":
            trades = conn.execute(
                "SELECT id, buyer_id, seller_id, quantity, price, total_value FROM trades WHERE buy_order_id=?",
                (order_id,)).fetchall()
        else:
            trades = conn.execute(
                "SELECT id, buyer_id, seller_id, quantity, price, total_value FROM trades WHERE sell_order_id=?",
                (order_id,)).fetchall()

        for trade in trades:
            # Reverse: seller returns cash, buyer returns PPUs
            post_double("cash", trade["seller_id"], trade["buyer_id"], trade["total_value"],
                         trade_id=trade["id"], instrument_id=order["instrument_id"],
                         description=f"Force-cancel reversal of trade #{trade['id']}")
            post_double("ppu", trade["buyer_id"], trade["seller_id"], trade["quantity"],
                         trade_id=trade["id"], instrument_id=order["instrument_id"],
                         description=f"Force-cancel reversal of trade #{trade['id']}")

            # Update holdings
            for uid, mult in [(trade["buyer_id"], -1), (trade["seller_id"], 1)]:
                existing = conn.execute("SELECT id, units FROM ppu_holdings WHERE user_id=? AND instrument_id=?",
                                        (uid, order["instrument_id"])).fetchone()
                delta = round(trade["quantity"] * mult, 2)
                if existing:
                    new_units = round(existing["units"] + delta, 2)
                    if new_units < 0: new_units = 0
                    conn.execute("UPDATE ppu_holdings SET units=? WHERE id=?", (new_units, existing["id"]))
                else:
                    cur = conn.execute("INSERT INTO ppu_holdings (user_id, instrument_id, units) VALUES (?, ?, ?)",
                                 (uid, order["instrument_id"], max(delta, 0)))

            reversed_trades.append(trade["id"])

    # Update order status to cancelled
    old_status = order["status"]
    conn.execute("UPDATE orders SET status='cancelled', filled_quantity=0 WHERE id=?", (order_id,))
    conn.commit()
    conn.close()

    broadcast_ob(order["instrument_id"])

    return {
        "message": f"Order {order_id} force-cancelled (was: {old_status})",
        "order_id": order_id,
        "reversed_trades": reversed_trades,
        "trades_reversed": len(reversed_trades)
    }

# ====================== BACKEND GAP 5.5: DASHBOARD STATS ======================

@app.get("/api/admin/dashboard/stats")
def admin_dashboard_stats(token: str = None):
    """Single endpoint for all dashboard summary numbers."""
    require_admin(token)
    conn = get_connection()
    today = datetime.utcnow().strftime("%Y-%m-%d")

    total_companies = conn.execute("SELECT COUNT(*) as c FROM companies WHERE status='active'").fetchone()["c"]
    total_pending_companies = conn.execute("SELECT COUNT(*) as c FROM companies WHERE status='pending'").fetchone()["c"]
    total_users = conn.execute("SELECT COUNT(*) as c FROM users WHERE id>0").fetchone()["c"]
    total_active_instruments = conn.execute("SELECT COUNT(*) as c FROM instruments WHERE status='active'").fetchone()["c"]
    total_open_orders = conn.execute(
        "SELECT COUNT(*) as c FROM orders WHERE status IN ('open', 'partially_filled')"
    ).fetchone()["c"]
    total_trades_today = conn.execute(
        "SELECT COUNT(*) as c FROM trades WHERE date(created_at)=?", (today,)
    ).fetchone()["c"]
    total_volume_today = conn.execute(
        "SELECT COALESCE(SUM(total_value), 0) as s FROM trades WHERE date(created_at)=?", (today,)
    ).fetchone()["s"]

    # PPU float = sum of all instrument total_floats where active
    total_ppu_float = conn.execute(
        "SELECT COALESCE(SUM(total_float), 0) as s FROM instruments WHERE status='active'"
    ).fetchone()["s"]

    # Cash in circulation = sum of all user cash balances (positive side)
    # Query ledger for net cash per user (excluding system)
    cash_entries = conn.execute(
        "SELECT COALESCE(SUM(credit - debit), 0) as s FROM ledger_entries WHERE ledger_type='cash' AND user_id>0"
    ).fetchone()["s"]

    # Reconciliation
    recon = rec_ledger()

    conn.close()

    return {
        "total_companies": total_companies,
        "total_pending_companies": total_pending_companies,
        "total_users": total_users,
        "total_active_instruments": total_active_instruments,
        "total_open_orders": total_open_orders,
        "total_trades_today": total_trades_today,
        "total_volume_today": round(total_volume_today, 2),
        "total_ppu_float": round(total_ppu_float, 2),
        "cash_in_circulation": round(cash_entries, 2),
        "all_balanced": recon.get("all_balanced", False),
        "cash_net_zero": recon.get("cash_net_zero", False),
        "ppu_matches_float": recon.get("ppu_matches_float", False)
    }

# ====================== BACKEND GAP 5.6: ADJUST INSTRUMENT FLOAT ======================

@app.post("/api/admin/instruments/{instrument_id}/adjust-float")
def admin_adjust_float(instrument_id: int, token: str = None, additional_float: float = Query(..., gt=0)):
    """Increase the total float of an instrument. Cannot decrease."""
    require_admin(token)
    conn = get_connection()
    inst = conn.execute("SELECT id, name, total_float FROM instruments WHERE id=?", (instrument_id,)).fetchone()
    if not inst:
        conn.close()
        raise HTTPException(404, "Instrument not found")
    new_total = round(inst["total_float"] + additional_float, 2)
    conn.execute("UPDATE instruments SET total_float=? WHERE id=?", (new_total, instrument_id))
    # Also credit the additional float to the system account for distribution
    post_double("ppu", 0, 0, additional_float, instrument_id=instrument_id,
                 description=f"Float adjustment: +{additional_float}")
    # Update system holdings
    existing = conn.execute("SELECT id, units FROM ppu_holdings WHERE user_id=0 AND instrument_id=?", (instrument_id,)).fetchone()
    if existing:
        conn.execute("UPDATE ppu_holdings SET units=units+? WHERE id=?", (additional_float, existing["id"]))
    else:
        cur = conn.execute("INSERT INTO ppu_holdings (user_id, instrument_id, units) VALUES (0, ?, ?)", (instrument_id, additional_float))
    conn.commit()
    conn.close()
    return {
        "message": f"Float adjusted by +{additional_float}",
        "instrument_id": instrument_id,
        "previous_total_float": inst["total_float"],
        "new_total_float": new_total,
        "adjustment": additional_float
    }

# ====================== BACKEND GAP 5.7: ADMIN SEARCH USERS ======================

@app.get("/api/admin/users/search")
def admin_search_users(token: str = None, q: str = Query(""), limit: int = 10):
    """Search users by username partial match."""
    try:
        require_admin(token)
        conn = get_connection()
        rows = conn.execute(
            "SELECT id, username, role, status, created_at FROM users WHERE id>0 AND username LIKE ? ORDER BY username LIMIT ?",
            (f"%{q}%", limit)
        ).fetchall()
        result = []
        for u in rows:
            cash = get_balance(u["id"], "cash")
            holdings = conn.execute(
                "SELECT i.id, i.name, h.units FROM ppu_holdings h JOIN instruments i ON h.instrument_id=i.id WHERE h.user_id=? AND h.units>0",
                (u["id"],)).fetchall()
            result.append({
                "id": u["id"],
                "username": u["username"],
                "role": u["role"],
                "status": u["status"],
                "cash_balance": round(cash, 2),
                "ppu_holdings": [{"instrument_id": h["id"], "instrument_name": h["name"], "units": round(h["units"], 2)} for h in holdings],
                "created_at": u["created_at"],
            })
        conn.close()
        return result
    except Exception as e:
        raise HTTPException(500, f"Search failed: {str(e)}")

# ====================== MARKET DATA ======================

@app.get("/api/instruments")
def list_instruments(token: str = None, status: str = None):
    get_user(token)
    conn = get_connection()
    q = "SELECT i.*, c.name as company_name FROM instruments i LEFT JOIN companies c ON i.company_id=c.id"
    p = []
    if status:
        q += " WHERE status=?"
        p.append(status)
    q += " ORDER BY created_at DESC"
    rows = conn.execute(q, p).fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.get("/api/orderbook/{instrument_id}")
def get_orderbook(instrument_id: int, token: str = None):
    get_user(token)
    conn = get_connection()
    bids = conn.execute(
        "SELECT id, user_id, price, quantity, filled_quantity, (quantity - filled_quantity) as remaining FROM orders WHERE instrument_id=? AND side='buy' AND status IN ('open','partially_filled') ORDER BY price DESC",
        (instrument_id,)).fetchall()
    asks = conn.execute(
        "SELECT id, user_id, price, quantity, filled_quantity, (quantity - filled_quantity) as remaining FROM orders WHERE instrument_id=? AND side='sell' AND status IN ('open','partially_filled') ORDER BY price ASC",
        (instrument_id,)).fetchall()
    conn.close()

    best_bid = bids[0]["price"] if bids else None
    best_ask = asks[0]["price"] if asks else None
    spread = round(best_ask - best_bid, 2) if (best_bid and best_ask) else None
    mid = round((best_bid + best_ask) / 2, 2) if (best_bid and best_ask) else None

    return {
        "instrument_id": instrument_id,
        "bids": [dict(r) for r in bids],
        "asks": [dict(r) for r in asks],
        "best_bid": best_bid,
        "best_ask": best_ask,
        "spread": spread,
        "mid_price": mid,
    }

# ====================== ORDER PLACEMENT ======================

class PlaceOrderReq(BaseModel):
    token: str = None
    instrument_id: int
    side: str = Field(..., pattern=r"^(buy|sell)$")
    price: float = Field(..., gt=0)
    quantity: float = Field(..., gt=0)

@app.post("/api/orders/place")
def place_order(req: PlaceOrderReq):
    user = get_user(req.token)

    # Check instrument is active
    conn = get_connection()
    inst = conn.execute("SELECT id, total_float, status FROM instruments WHERE id=?", (req.instrument_id,)).fetchone()
    if not inst: conn.close(); raise HTTPException(404, "Instrument not found")
    if inst["status"] != "active": conn.close(); raise HTTPException(400, "Instrument is delisted")

    # Check user has sufficient balance
    if req.side == "buy":
        cash_bal = get_balance(user["user_id"], "cash")
        needed = round(req.price * req.quantity, 2)
        if cash_bal < needed:
            conn.close()
            raise HTTPException(400, f"Insufficient cash: have ${cash_bal:.2f}, need ${needed:.2f}")
    else:
        ppu_bal = get_balance(user["user_id"], "ppu", req.instrument_id)
        if ppu_bal < req.quantity:
            conn.close()
            raise HTTPException(400, f"Insufficient PPUs: have {ppu_bal:.2f}, need {req.quantity:.2f}")

    # Create order
    cur = conn.execute("INSERT INTO orders (user_id, instrument_id, side, price, quantity) VALUES (?, ?, ?, ?, ?)",
                 (user["user_id"], req.instrument_id, req.side, req.price, req.quantity))
    order_id = cur.lastrowid
    conn.commit()
    conn.close()

    # Try matching
    match_result = match_orders(req.instrument_id)
    return {"order_id": order_id, "side": req.side, "price": req.price, "quantity": req.quantity, "matches": match_result}


def match_orders(instrument_id):
    """Match buy and sell orders. Returns number of trades executed."""
    conn = get_connection()
    trades_made = 0

    while True:
        # Best bid and ask
        bid = conn.execute(
            "SELECT id, user_id, price, quantity, filled_quantity FROM orders WHERE instrument_id=? AND side='buy' AND status IN ('open','partially_filled') ORDER BY price DESC, created_at ASC LIMIT 1",
            (instrument_id,)).fetchone()
        ask = conn.execute(
            "SELECT id, user_id, price, quantity, filled_quantity FROM orders WHERE instrument_id=? AND side='sell' AND status IN ('open','partially_filled') ORDER BY price ASC, created_at ASC LIMIT 1",
            (instrument_id,)).fetchone()

        if not bid or not ask or bid["price"] < ask["price"]:
            break  # No match possible

        # Calculate match
        bid_rem = bid["quantity"] - bid["filled_quantity"]
        ask_rem = ask["quantity"] - ask["filled_quantity"]
        match_qty = min(bid_rem, ask_rem)
        match_price = ask["price"]  # Price-time priority: use resting order price
        total_value = round(match_qty * match_price, 2)

        # Create trade
        conn.execute(
            "INSERT INTO trades (buy_order_id, sell_order_id, instrument_id, buyer_id, seller_id, quantity, price, total_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (bid["id"], ask["id"], instrument_id, bid["user_id"], ask["user_id"], match_qty, match_price, total_value),
        )
        trade_id = cur.lastrowid

        # Update order fills
        for oid, oq in [(bid["id"], bid["quantity"]), (ask["id"], ask["quantity"])]:
            fq = conn.execute("SELECT filled_quantity FROM orders WHERE id=?", (oid,)).fetchone()["filled_quantity"]
            new_fq = round(fq + match_qty, 2)
            new_st = "filled" if new_fq >= oq else "partially_filled"
            conn.execute("UPDATE orders SET filled_quantity=?, status=? WHERE id=?", (new_fq, new_st, oid))

        # Double-entry: cash (buyer pays seller)
        buyer_cash_pre = get_balance(bid["user_id"], "cash")
        if buyer_cash_pre < total_value:
            # Buyer can't afford — skip this match
            conn.execute("UPDATE orders SET status='cancelled' WHERE id=?", (bid["id"],))
            continue

        post_double("cash", bid["user_id"], ask["user_id"], total_value, trade_id=trade_id, instrument_id=instrument_id,
                     description=f"Trade #{trade_id}: {match_qty} PPUs @ ${match_price}")
        post_double("ppu", ask["user_id"], bid["user_id"], match_qty, trade_id=trade_id, instrument_id=instrument_id,
                     description=f"Trade #{trade_id}: {match_qty} PPUs @ ${match_price}")

        # Update ppu_holdings
        for uid, mult in [(bid["user_id"], 1), (ask["user_id"], -1)]:
            existing = conn.execute("SELECT id, units FROM ppu_holdings WHERE user_id=? AND instrument_id=?", (uid, instrument_id)).fetchone()
            delta = round(match_qty * mult, 2)
            if existing:
                new_units = round(existing["units"] + delta, 2)
                if new_units < 0: new_units = 0
                conn.execute("UPDATE ppu_holdings SET units=? WHERE id=?", (new_units, existing["id"]))
            else:
                cur = conn.execute("INSERT INTO ppu_holdings (user_id, instrument_id, units) VALUES (?, ?, ?)",
                             (uid, instrument_id, max(delta, 0)))

        conn.commit()
        trades_made += 1
        broadcast_ob(instrument_id)

    conn.close()
    if trades_made > 0:
        broadcast_ob(instrument_id)
    return trades_made


# ====================== CANCEL ORDER ======================

@app.post("/api/orders/cancel/{order_id}")
def cancel_order(order_id: int, token: str = None):
    user = get_user(token)
    conn = get_connection()
    order = conn.execute("SELECT id, user_id, status FROM orders WHERE id=?", (order_id,)).fetchone()
    if not order: conn.close(); raise HTTPException(404, "Order not found")
    if order["user_id"] != user["user_id"] and user["role"] != "admin":
        conn.close(); raise HTTPException(403, "Not your order")
    if order["status"] not in ("open", "partially_filled"):
        conn.close(); raise HTTPException(400, "Order already filled/cancelled")
    conn.execute("UPDATE orders SET status='cancelled' WHERE id=?", (order_id,))
    conn.commit()
    conn.close()
    broadcast_ob(order["instrument_id"])
    return {"message": "Order cancelled"}

# ====================== USER ORDERS / TRADES ======================

@app.get("/api/orders/user/{user_id}")
def get_user_orders(user_id: int, token: str = None):
    get_user(token)
    conn = get_connection()
    rows = conn.execute("SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC", (user_id,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.get("/api/trades")
def list_trades(token: str = None, instrument_id: int = None, user_id: int = None, limit: int = 50):
    get_user(token)
    conn = get_connection()
    q = """SELECT t.*, bu.username as buyer_name, su.username as seller_name, i.name as instrument_name
           FROM trades t
           JOIN users bu ON t.buyer_id=bu.id
           JOIN users su ON t.seller_id=su.id
           JOIN instruments i ON t.instrument_id=i.id
           WHERE 1=1"""
    p = []
    if instrument_id:
        q += " AND t.instrument_id=?"
        p.append(instrument_id)
    if user_id:
        q += " AND (t.buyer_id=? OR t.seller_id=?)"
        p += [user_id, user_id]
    q += " ORDER BY t.created_at DESC LIMIT ?"
    p.append(limit)
    rows = conn.execute(q, p).fetchall()
    conn.close()
    return [dict(r) for r in rows]

# ====================== ACCOUNTING ======================

@app.get("/api/accounts/{user_id}")
def get_accounts(user_id: int, token: str = None):
    get_user(token)
    cash = get_balance(user_id, "cash")
    conn = get_connection()
    ppu_rows = conn.execute(
        "SELECT i.id, i.name, COALESCE(SUM(e.credit) - SUM(e.debit), 0) as bal FROM ledger_entries e JOIN instruments i ON e.instrument_id=i.id WHERE e.user_id=? AND e.ledger_type='ppu' AND e.instrument_id IS NOT NULL GROUP BY e.instrument_id",
        (user_id,)).fetchall()
    holdings = conn.execute(
        "SELECT h.id as holding_id, i.name, h.units FROM ppu_holdings h JOIN instruments i ON h.instrument_id=i.id WHERE h.user_id=? AND h.units > 0",
        (user_id,)).fetchall()
    conn.close()
    return {
        "user_id": user_id,
        "cash_balance": round(cash, 2),
        "ppu_holdings": [dict(r) for r in holdings],
    }

@app.get("/api/ledger/{user_id}")
def get_ledger(user_id: int, token: str = None):
    get_user(token)
    entries = get_statement(user_id)
    return entries

@app.get("/api/reconcile")
def reconcile(token: str = None):
    get_user(token)
    return rec_ledger()

# ====================== PROFIT ======================

# OLD DECLARE REMOVED

class MarketOrderReq(BaseModel):
    token: str = None
    instrument_id: int
    side: str = Field(..., pattern=r"^(buy|sell)$")
    quantity: float = Field(..., gt=0)

@app.post("/api/orders/market")
def market_order(req: MarketOrderReq):
    """Execute a market order — fill immediately at best available prices."""
    user = get_user(req.token)
    conn = get_connection()
    inst = conn.execute("SELECT id, status FROM instruments WHERE id=?", (req.instrument_id,)).fetchone()
    if not inst: conn.close(); raise HTTPException(404, "Instrument not found")
    if inst["status"] != "active": conn.close(); raise HTTPException(400, "Instrument is delisted")

    remaining = req.quantity
    total_cost = 0
    total_qty = 0
    match_count = 0
    order_id = None

    # Sweep the order book
    while remaining > 0:
        if req.side == "buy":
            resting = conn.execute(
                "SELECT id, user_id, price, quantity, filled_quantity FROM orders WHERE instrument_id=? AND side='sell' AND status IN ('open','partially_filled') ORDER BY price ASC, created_at ASC LIMIT 1",
                (req.instrument_id,)).fetchone()
        else:
            resting = conn.execute(
                "SELECT id, user_id, price, quantity, filled_quantity FROM orders WHERE instrument_id=? AND side='buy' AND status IN ('open','partially_filled') ORDER BY price DESC, created_at ASC LIMIT 1",
                (req.instrument_id,)).fetchone()

        if not resting:
            break  # No liquidity

        rest_rem = resting["quantity"] - resting["filled_quantity"]
        match_qty = min(remaining, rest_rem)
        match_price = resting["price"]
        trade_total = round(match_qty * match_price, 2)

        # Check buyer/seller balance
        if req.side == "buy":
            buyer_id, seller_id = user["user_id"], resting["user_id"]
            cash_needed = trade_total
            cash_have = get_balance(buyer_id, "cash")
            if cash_have < cash_needed:
                conn.close(); raise HTTPException(400, f"Insufficient cash at price ${match_price}")
        else:
            buyer_id, seller_id = resting["user_id"], user["user_id"]
            ppu_have = get_balance(seller_id, "ppu", req.instrument_id)
            if ppu_have < match_qty:
                conn.close(); raise HTTPException(400, f"Insufficient PPUs")

        # Create trade: NULL for the aggressive side (no order), resting order ID for the passive side
        if req.side == "buy":
            bo_id, so_id = None, resting["id"]
        else:
            bo_id, so_id = resting["id"], None
        conn.execute(
            "INSERT INTO trades (buy_order_id, sell_order_id, instrument_id, buyer_id, seller_id, quantity, price, total_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (bo_id, so_id,
             req.instrument_id, buyer_id, seller_id, match_qty, match_price, trade_total),
        )
        trade_id = cur.lastrowid

        # Update resting order
        new_fq = round(resting["filled_quantity"] + match_qty, 2)
        new_st = "filled" if new_fq >= resting["quantity"] else "partially_filled"
        conn.execute("UPDATE orders SET filled_quantity=?, status=? WHERE id=?", (new_fq, new_st, resting["id"]))

        # Double-entry (use same connection to avoid lock)
        post_double("cash", buyer_id, seller_id, trade_total, trade_id=trade_id, instrument_id=req.instrument_id,
                     description=f"Market Trade #{trade_id}: {match_qty} PPUs @ ${match_price}", conn=conn)
        post_double("ppu", seller_id, buyer_id, match_qty, trade_id=trade_id, instrument_id=req.instrument_id,
                     description=f"Market Trade #{trade_id}: {match_qty} PPUs @ ${match_price}", conn=conn)

        # Update holdings
        for uid, mult in [(buyer_id, 1), (seller_id, -1)]:
            existing = conn.execute("SELECT id, units FROM ppu_holdings WHERE user_id=? AND instrument_id=?", (uid, req.instrument_id)).fetchone()
            delta = round(match_qty * mult, 2)
            if existing:
                new_units = round(existing["units"] + delta, 2)
                if new_units < 0: new_units = 0
                conn.execute("UPDATE ppu_holdings SET units=? WHERE id=?", (new_units, existing["id"]))
            else:
                cur = conn.execute("INSERT INTO ppu_holdings (user_id, instrument_id, units) VALUES (?, ?, ?)",
                             (uid, req.instrument_id, max(delta, 0)))

        remaining = round(remaining - match_qty, 2)
        total_cost += trade_total
        total_qty += match_qty
        match_count += 1

    conn.commit()
    conn.close()

    avg_price = round(total_cost / total_qty, 2) if total_qty > 0 else 0
    return {
        "side": req.side,
        "price": avg_price,
        "quantity": req.quantity,
        "filled_quantity": round(total_qty, 2),
        "total_cost": round(total_cost, 2),
        "matches": match_count,
        "fill_percent": round(total_qty / req.quantity * 100, 1) if req.quantity > 0 else 0,
    }


# ====================== MARKET SUMMARY (WISHLIST #3) ======================

@app.get("/api/instruments/{instrument_id}/summary")
def instrument_summary(instrument_id: int, token: str = None):
    """Unified market summary: last price, volume, daily change, best bid/ask."""
    get_user(token)
    conn = get_connection()
    inst = conn.execute("SELECT * FROM instruments WHERE id=?", (instrument_id,)).fetchone()
    if not inst: conn.close(); raise HTTPException(404, "Instrument not found")

    # Last trade
    last_trade = conn.execute(
        "SELECT price, quantity, created_at FROM trades WHERE instrument_id=? ORDER BY created_at DESC LIMIT 1",
        (instrument_id,)).fetchone()

    # Today's volume and trades
    today = datetime.utcnow().strftime("%Y-%m-%d")
    day_trades = conn.execute(
        "SELECT COUNT(*) as cnt, COALESCE(SUM(quantity),0) as vol FROM trades WHERE instrument_id=? AND date(created_at)=?",
        (instrument_id, today)).fetchone()

    # Previous close (last trade before today)
    prev_close = conn.execute(
        "SELECT price FROM trades WHERE instrument_id=? AND date(created_at)<? ORDER BY created_at DESC LIMIT 1",
        (instrument_id, today)).fetchone()

    # Order book
    bid = conn.execute(
        "SELECT price FROM orders WHERE instrument_id=? AND side='buy' AND status IN ('open','partially_filled') ORDER BY price DESC LIMIT 1",
        (instrument_id,)).fetchone()
    ask = conn.execute(
        "SELECT price FROM orders WHERE instrument_id=? AND side='sell' AND status IN ('open','partially_filled') ORDER BY price ASC LIMIT 1",
        (instrument_id,)).fetchone()

    conn.close()

    last_price = round(last_trade["price"], 2) if last_trade else None
    prev_close_price = round(prev_close["price"], 2) if prev_close else (last_price or 0)
    daily_change = round(last_price - prev_close_price, 2) if last_price and prev_close_price else 0
    daily_change_pct = round(daily_change / prev_close_price * 100, 2) if prev_close_price > 0 else 0
    best_bid = round(bid["price"], 2) if bid else None
    best_ask = round(ask["price"], 2) if ask else None
    spread = round(best_ask - best_bid, 2) if (best_bid and best_ask) else None
    mid = round((best_bid + best_ask) / 2, 2) if (best_bid and best_ask) else None

    return {
        "instrument_id": instrument_id,
        "name": inst["name"],
        "last_trade_price": last_price,
        "daily_change": daily_change,
        "daily_change_pct": daily_change_pct,
        "daily_volume": round(day_trades["vol"], 2),
        "total_trades_today": day_trades["cnt"],
        "best_bid": best_bid,
        "best_ask": best_ask,
        "spread": spread,
        "mid_price": mid,
    }


# ====================== P&L (WISHLIST #2) ======================

@app.get("/api/accounts/{user_id}/pnl")
def get_pnl(user_id: int, token: str = None):
    """Get mark-to-market P&L for a user."""
    get_user(token)
    return user_pnl(user_id)


# ====================== ADMIN: LIST USERS (WISHLIST #4) ======================

@app.get("/api/admin/users")
def admin_list_users(token: str = None):
    """List all users with balances and holdings."""
    require_admin(token)
    conn = get_connection()
    users = conn.execute("SELECT id, username, role, status, created_at FROM users WHERE id>0 ORDER BY created_at DESC").fetchall()
    result = []
    for u in users:
        cash = get_balance(u["id"], "cash")
        holdings = conn.execute(
            "SELECT i.id, i.name, h.units FROM ppu_holdings h JOIN instruments i ON h.instrument_id=i.id WHERE h.user_id=? AND h.units>0",
            (u["id"],)).fetchall()
        result.append({
            "id": u["id"],
            "username": u["username"],
            "role": u["role"],
            "status": u["status"] if "status" in u else "active",
            "cash_balance": round(cash, 2),
            "ppu_holdings": [{"instrument_id": h["id"], "instrument_name": h["name"], "units": round(h["units"], 2)} for h in holdings],
            "created_at": u["created_at"],
        })
    conn.close()
    return result


# ====================== ADMIN: ALL ORDERS (WISHLIST #5) ======================

@app.get("/api/admin/orders")
def admin_list_orders(token: str = None, status: str = None, instrument_id: int = None, limit: int = 100):
    """List all orders across all users (admin only)."""
    require_admin(token)
    conn = get_connection()
    q = """SELECT o.*, u.username, i.name as instrument_name
           FROM orders o
           JOIN users u ON o.user_id=u.id
           JOIN instruments i ON o.instrument_id=i.id
           WHERE 1=1"""
    p = []
    if status:
        q += " AND o.status=?"
        p.append(status)
    if instrument_id:
        q += " AND o.instrument_id=?"
        p.append(instrument_id)
    q += " ORDER BY o.created_at DESC LIMIT ?"
    p.append(limit)
    rows = conn.execute(q, p).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ====================== ADMIN: ALL HOLDINGS (WISHLIST #6) ======================

@app.get("/api/admin/holdings")
def admin_list_holdings(token: str = None, instrument_id: int = None):
    """List all PPU holdings across all users with cost basis."""
    require_admin(token)
    conn = get_connection()
    q = """SELECT h.*, u.username, i.name as instrument_name
           FROM ppu_holdings h
           JOIN users u ON h.user_id=u.id
           JOIN instruments i ON h.instrument_id=i.id
           WHERE h.units > 0"""
    p = []
    if instrument_id:
        q += " AND h.instrument_id=?"
        p.append(instrument_id)
    q += " ORDER BY h.units DESC"
    rows = conn.execute(q, p).fetchall()
    conn.close()
    result = []
    for r in rows:
        acb = avg_cost_basis(r["user_id"], r["instrument_id"])
        result.append({
            "user_id": r["user_id"],
            "username": r["username"],
            "instrument_id": r["instrument_id"],
            "instrument_name": r["instrument_name"],
            "units": round(r["units"], 2),
            "avg_cost_basis": acb,
        })
    return result


# ====================== COMPANY MANAGEMENT ======================

class CompanyCreate(BaseModel):
    token: str = None
    name: str
    description: str = ""
    industry: str = ""
    country: str = ""
    founder_names: str = ""
    total_float_pct: float = 25.0
    retained_pct: float = 75.0

@app.post("/api/admin/companies")
def admin_create_company(req: CompanyCreate):
    """Create a new company (admin only)."""
    admin = require_admin(req.token)
    if req.total_float_pct + req.retained_pct > 100:
        raise HTTPException(400, "Float pct + retained pct cannot exceed 100")
    conn = get_connection()
    try:
        cur = conn.execute("INSERT INTO companies (name, description, industry, country, founder_names, total_float_pct, retained_pct, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                     (req.name, req.description, req.industry, req.country, req.founder_names, req.total_float_pct, req.retained_pct, admin["user_id"]))
        conn.commit()
        cid = cur.lastrowid
    except Exception as e:
        conn.close()
        raise HTTPException(400, "Company name taken" if "UNIQUE" in str(e) else str(e))
    conn.close()
    return {"company_id": cid, "name": req.name, "message": "Company created"}

@app.get("/api/admin/companies")
def admin_list_companies(token: str = None):
    """List all companies with series counts."""
    require_admin(token)
    conn = get_connection()
    rows = conn.execute("SELECT c.*, u.username as created_by_name FROM companies c JOIN users u ON c.created_by=u.id ORDER BY c.created_at DESC").fetchall()
    result = []
    for r in rows:
        series_count = conn.execute("SELECT COUNT(*) as c FROM instruments WHERE company_id=?", (r["id"],)).fetchone()["c"]
        total_float = conn.execute("SELECT COALESCE(SUM(total_float),0) as s FROM instruments WHERE company_id=?", (r["id"],)).fetchone()["s"]
        result.append({
            "id": r["id"],
            "name": r["name"],
            "description": r["description"],
            "industry": r["industry"],
            "country": r["country"],
            "founder_names": r["founder_names"],
            "total_float_pct": r["total_float_pct"],
            "retained_pct": r["retained_pct"],
            "kyc_status": r["kyc_status"],
            "status": r["status"],
            "created_by_name": r["created_by_name"],
            "series_count": series_count,
            "total_float": round(total_float, 2),
            "created_at": r["created_at"]
        })
    conn.close()
    return result

@app.get("/api/admin/companies/{company_id}")
def admin_get_company(company_id: int, token: str = None):
    """Get company detail with its issuance series."""
    require_admin(token)
    conn = get_connection()
    company = conn.execute("SELECT c.*, u.username as created_by_name FROM companies c JOIN users u ON c.created_by=u.id WHERE c.id=?", (company_id,)).fetchone()
    if not company:
        conn.close()
        raise HTTPException(404, "Company not found")
    series = conn.execute("SELECT id, name, series_label, description, total_float, raise_target, price_per_ppu, status, created_at FROM instruments WHERE company_id=? ORDER BY created_at DESC", (company_id,)).fetchall()
    conn.close()
    return {
        "id": company["id"],
        "name": company["name"],
        "description": company["description"],
        "industry": company["industry"],
        "country": company["country"],
        "founder_names": company["founder_names"],
        "total_float_pct": company["total_float_pct"],
        "retained_pct": company["retained_pct"],
        "kyc_status": company["kyc_status"],
        "status": company["status"],
        "created_by_name": company["created_by_name"],
        "created_at": company["created_at"],
        "series": [dict(s) for s in series]
    }

@app.put("/api/admin/companies/{company_id}/status")
def admin_update_company_status(company_id: int, token: str = None, status: str = Query(...)):
    """Set company status: pending/active/suspended."""
    require_admin(token)
    if status not in ("pending", "active", "suspended"):
        raise HTTPException(400, "Status must be pending, active, or suspended")
    conn = get_connection()
    conn.execute("UPDATE companies SET status=? WHERE id=?", (status, company_id))
    conn.commit()
    conn.close()
    return {"message": f"Company {company_id} status set to '{status}'"}

@app.put("/api/admin/companies/{company_id}/kyc")
def admin_update_company_kyc(company_id: int, token: str = None, kyc_status: str = Query(...)):
    """Set KYC status: pending/verified/rejected."""
    require_admin(token)
    if kyc_status not in ("pending", "verified", "rejected"):
        raise HTTPException(400, "KYC status must be pending, verified, or rejected")
    conn = get_connection()
    conn.execute("UPDATE companies SET kyc_status=? WHERE id=?", (kyc_status, company_id))
    conn.commit()
    conn.close()
    return {"message": f"Company {company_id} KYC set to '{kyc_status}'"}

# Modify instrument create to accept company_id + series_label
# The existing InstrumentCreate class is at line ~258, let's patch the endpoint



# ====================== PPU MATH CALCULATOR ======================

class PpuMathReq(BaseModel):
    net_profit: float = Field(..., gt=0)
    tax: float = 0
    float_pct: float = Field(25.0, gt=0, le=100)
    outstanding_ppus: float = Field(..., gt=0)
    new_issuance: float = 0
    required_yield_pct: float = Field(10.0, gt=0)
    investor_holdings: float = 0

@app.post("/api/ppu/calculate")
def ppu_calculate(req: PpuMathReq):
    """Hard-coded PPU math: full step-by-step breakdown."""
    # Step 1: Distributable profit
    distributable_profit = round(req.net_profit - req.tax, 2)
    
    # Step 2: Float ratio
    float_ratio = req.float_pct / 100.0
    
    # Step 3: PPU pool
    ppu_pool = round(float_ratio * distributable_profit, 2)
    
    # Step 4: Outstanding PPUs (before and after dilution)
    current_ppus = req.outstanding_ppus
    new_total_ppus = current_ppus + req.new_issuance
    
    # Step 5: Per-unit distribution
    dist_per_unit_current = round(ppu_pool / current_ppus, 4) if current_ppus > 0 else 0
    dist_per_unit_diluted = round(ppu_pool / new_total_ppus, 4) if new_total_ppus > 0 else 0
    
    # Step 6: Investor cashflow sample
    investor_cf_current = round(dist_per_unit_current * req.investor_holdings, 2) if req.investor_holdings > 0 else 0
    investor_cf_diluted = round(dist_per_unit_diluted * req.investor_holdings, 2) if req.investor_holdings > 0 else 0
    
    # Step 7: Market valuation
    yield_decimal = req.required_yield_pct / 100.0
    price_current = round(dist_per_unit_current / yield_decimal, 2) if yield_decimal > 0 else 0
    price_diluted = round(dist_per_unit_diluted / yield_decimal, 2) if yield_decimal > 0 else 0
    
    # Step 8: Growth scenario (profit doubles)
    growth_profit = round(distributable_profit * 2, 2)
    growth_pool = round(float_ratio * growth_profit, 2)
    growth_dist = round(growth_pool / current_ppus, 4) if current_ppus > 0 else 0
    growth_price = round(growth_dist / yield_decimal, 2) if yield_decimal > 0 else 0
    
    return {
        "formula": "D = f * Pi / N",
        "steps": {
            "1_distributable_profit": {
                "label": "Distributable Profit (Pi)",
                "formula": "Pi = Net Profit - Tax",
                "value": distributable_profit,
                "components": {"net_profit": req.net_profit, "tax": req.tax}
            },
            "2_float_ratio": {
                "label": "PPU Float Ratio (f)",
                "formula": "f = Float% / 100",
                "value": float_ratio,
                "pct": req.float_pct
            },
            "3_ppu_pool": {
                "label": "PPU Payout Pool (P)",
                "formula": "P = f * Pi",
                "value": ppu_pool,
                "computed": f"{float_ratio} * {distributable_profit} = {ppu_pool}"
            },
            "4_outstanding_ppus": {
                "label": "Outstanding PPUs (N)",
                "current": current_ppus,
                "new_issuance": req.new_issuance,
                "new_total": new_total_ppus
            },
            "5_dist_per_unit": {
                "label": "Distribution Per Unit (D)",
                "formula": "D = P / N",
                "current": dist_per_unit_current,
                "diluted": dist_per_unit_diluted if req.new_issuance > 0 else None,
                "computed_current": f"{ppu_pool} / {current_ppus} = {dist_per_unit_current}",
                "computed_diluted": f"{ppu_pool} / {new_total_ppus} = {dist_per_unit_diluted}" if req.new_issuance > 0 else None
            },
            "6_investor_cashflow": {
                "label": "Investor Cashflow (CF)",
                "formula": "CF = D * Holdings",
                "holdings": req.investor_holdings,
                "current": investor_cf_current,
                "diluted": investor_cf_diluted if req.new_issuance > 0 and req.investor_holdings > 0 else None
            },
            "7_valuation": {
                "label": "PPU Market Price",
                "formula": "Price = D / Required Yield",
                "required_yield_pct": req.required_yield_pct,
                "current_price": price_current,
                "diluted_price": price_diluted if req.new_issuance > 0 else None,
                "computed_current": f"{dist_per_unit_current} / {yield_decimal} = {price_current}"
            },
            "8_growth_scenario": {
                "label": "Growth Scenario (2x Profit)",
                "formula": "Pi * 2 -> P -> D -> Price",
                "profit_doubled": growth_profit,
                "pool_doubled": growth_pool,
                "dist_doubled": growth_dist,
                "price_doubled": growth_price
            }
        }
    }


# ====================== SERIES LIFECYCLE ======================

@app.put("/api/admin/instruments/{instrument_id}/lifecycle")
def admin_set_lifecycle(instrument_id: int, token: str = None, status: str = Query(...)):
    """Set series lifecycle: fundraising -> active -> closed."""
    require_admin(token)
    if status not in ("fundraising", "active", "closed"):
        raise HTTPException(400, "Status must be fundraising, active, or closed")
    conn = get_connection()
    inst = conn.execute("SELECT id, status, lifecycle_status FROM instruments WHERE id=?", (instrument_id,)).fetchone()
    if not inst:
        conn.close()
        raise HTTPException(404, "Instrument not found")
    conn.execute("UPDATE instruments SET lifecycle_status=? WHERE id=?", (status, instrument_id))
    # If closing, also delist from trading
    if status == "closed":
        conn.execute("UPDATE instruments SET status='delisted' WHERE id=?", (instrument_id,))
    # If activating, make active for trading
    if status == "active":
        conn.execute("UPDATE instruments SET status='active' WHERE id=?", (instrument_id,))
    conn.commit()
    conn.close()
    log_audit(require_admin(token)["user_id"], "lifecycle_change", "instruments", instrument_id, f"Set to {status}")
    return {"message": f"Series {instrument_id} lifecycle set to '{status}'"}

@app.post("/api/admin/instruments/{instrument_id}/attest-capital")
def admin_attest_capital(instrument_id: int, token: str, amount: float = Query(..., gt=0)):
    """Attest that capital was deployed to productive use (Capital Recycling Doctrine)."""
    admin = require_admin(token)
    conn = get_connection()
    conn.execute("UPDATE instruments SET capital_deployed = capital_deployed + ?, capital_attested = capital_attested + 1 WHERE id=?",
                 (amount, instrument_id))
    conn.commit()
    conn.close()
    log_audit(admin["user_id"], "capital_attested", "instruments", instrument_id, "Deployed " + str(amount))
    return {"message": "Capital deployment of " + str(amount) + " attested for series " + str(instrument_id)}

# ====================== CAPITAL RECYCLING ======================

@app.get("/api/admin/capital-report")
def admin_capital_report(token: str):
    """Aggregated capital deployment report across all series."""
    require_admin(token)
    conn = get_connection()
    rows = conn.execute("""
        SELECT i.id, i.name, i.company_id, c.name as company_name, 
               i.raise_target, i.capital_deployed, i.capital_attested,
               i.use_of_proceeds, i.lifecycle_status
        FROM instruments i
        LEFT JOIN companies c ON i.company_id=c.id
        ORDER BY i.capital_deployed DESC
    """).fetchall()
    conn.close()
    result = []
    for r in rows:
        try:
            import json
            proceeds = json.loads(r["use_of_proceeds"]) if r["use_of_proceeds"] else []
        except Exception:
            proceeds = []
        pct = round((r["capital_deployed"] / r["raise_target"] * 100), 1) if r["raise_target"] > 0 else 0
        result.append({
            "instrument_id": r["id"],
            "instrument_name": r["name"],
            "company_name": r["company_name"],
            "raise_target": round(r["raise_target"], 2),
            "capital_deployed": round(r["capital_deployed"], 2),
            "deployment_pct": pct,
            "attestations": r["capital_attested"],
            "use_of_proceeds": proceeds,
            "lifecycle_status": r["lifecycle_status"]
        })
    return result

# ====================== PROFIT REPORTING ======================

class DeclareProfitReq(BaseModel):
    token: str = None
    instrument_id: int
    period_label: str
    total_profit: float = Field(..., gt=0)
    revenue: float = None
    cost_of_goods: float = None
    operating_expenses: float = None

@app.post("/api/profit/declare")
def declare_profit(req: DeclareProfitReq):
    """Declare profit with full financials (revenue, COGS, opex)."""
    get_user(req.token)
    conn = get_connection()
    inst = conn.execute("SELECT id, total_float FROM instruments WHERE id=?", (req.instrument_id,)).fetchone()
    if not inst:
        conn.close()
        raise HTTPException(404, "Instrument not found")
    total_ppus = inst["total_float"]
    profit_per_ppu = round(req.total_profit / total_ppus, 4) if total_ppus > 0 else 0
    conn.execute("""
        INSERT INTO profit_declarations (instrument_id, period_label, total_profit, profit_per_ppu, total_ppus, revenue, cost_of_goods, operating_expenses)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (req.instrument_id, req.period_label, req.total_profit, profit_per_ppu, total_ppus, req.revenue, req.cost_of_goods, req.operating_expenses))
    decl_id = cur.lastrowid
    conn.commit()
    conn.close()
    return {
        "declaration_id": decl_id,
        "profit_per_ppu": profit_per_ppu,
        "total_ppus": total_ppus,
        "net_profit": req.total_profit,
        "revenue": req.revenue,
        "cogs": req.cost_of_goods,
        "opex": req.operating_expenses
    }


@app.get("/api/health")
def health():
    return {"status": "ok", "version": "2.0.0", "db": DB_PATH}





# ====================== AML MONITORING ENGINE ======================

def monitor_trade(user_id, instrument_id, side, price, quantity, conn=None):
    """Check for suspicious trading patterns. Creates alert if triggered."""
    close_conn = False
    if not conn:
        conn = get_connection()
        close_conn = True
    try:
        today = datetime.utcnow().strftime("%Y-%m-%d")
        
        # 1. Wash trade detection: same user buying and selling same instrument same day
        recent_trades = conn.execute("""
            SELECT COUNT(*) as cnt FROM trades 
            WHERE (buyer_id=? OR seller_id=?) AND instrument_id=? AND date(created_at)=?
        """, (user_id, user_id, instrument_id, today)).fetchone()["cnt"]
        
        if recent_trades > 3:
            conn.execute("""INSERT INTO transaction_alerts 
                (alert_type, user_id, instrument_id, severity, description, details)
                VALUES ('wash_trade',?,?,'medium',?,?)
            """, (user_id, instrument_id, 
                  "Possible wash trading: " + str(recent_trades) + " trades today",
                  '{"count":' + str(recent_trades) + ',"side":"' + side + '"}'))
        
        # 2. Daily volume limit exceeded
        daily_volume = conn.execute("""
            SELECT COALESCE(SUM(quantity * price),0) as vol FROM trades 
            WHERE (buyer_id=? OR seller_id=?) AND date(created_at)=?
        """, (user_id, user_id, today)).fetchone()["vol"]
        
        if daily_volume > 50000:
            conn.execute("""INSERT INTO transaction_alerts 
                (alert_type, user_id, severity, description, details)
                VALUES ('daily_limit',?,'high',?,?)
            """, (user_id, 
                  "Daily volume $" + str(round(daily_volume, 2)) + " exceeded $50,000",
                  '{"volume":' + str(daily_volume) + '}'))
        
        conn.commit()
    except Exception:
        pass
    if close_conn:
        conn.close()



# ====================== SANCTIONS SCREENING ======================

# Compact OFAC SDN sample list (common names and patterns)
# In production: download full SDN list from https://www.treasury.gov/ofac/downloads/sdn.csv
OFAC_SDN_KEYWORDS = [
    "sanctioned", "blocked", "embargo", "terrorist", "narcotics",
    "money laundering", "proliferation", "iran", "north korea", 
    "syria", "cuba", "crimea", "donetsk", "luhansk",
    "isil", "al-qaida", "taliban", "hezbollah", "hamas",
    "islamic state", "boko haram", "houthi",
]

def screen_sanctions(user_id, full_name):
    """Simple sanctions screening. Checks name against OFAC keywords."""
    conn = get_connection()
    try:
        name_lower = full_name.lower()
        for keyword in OFAC_SDN_KEYWORDS:
            if keyword in name_lower:
                conn.execute("""INSERT INTO sanctions_hits (user_id, list_name, matched_name, matched_field, severity, status)
                    VALUES (?, 'OFAC_SDN', ?, 'full_name', 'high', 'open')""",
                    (user_id, full_name))
                conn.commit()
                break
        # Also check for high-risk countries
        user = conn.execute("SELECT nationality FROM kyc_submissions WHERE user_id=?", (user_id,)).fetchone()
        if user:
            high_risk = ["iran", "north korea", "syria", "cuba", "crimea"]
            if user["nationality"] and user["nationality"].lower() in high_risk:
                conn.execute("""INSERT INTO sanctions_hits (user_id, list_name, matched_name, matched_field, severity, status)
                    VALUES (?, 'HIGH_RISK_COUNTRY', ?, 'nationality', 'high', 'open')""",
                    (user_id, user["nationality"]))
                conn.commit()
    except Exception:
        pass
    conn.close()

@app.get("/api/admin/sanctions/hits")
def admin_sanctions_hits(token: str, status: str = "open"):
    require_admin(token)
    conn = get_connection()
    rows = conn.execute("""
        SELECT sh.*, u.username FROM sanctions_hits sh
        JOIN users u ON sh.user_id=u.id
        WHERE sh.status=? ORDER BY sh.created_at DESC
    """, (status,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.post("/api/admin/sanctions/resolve")
def admin_resolve_sanctions(token: str, hit_id: int = Query(...), resolution: str = "false_positive"):
    admin = require_admin(token)
    if resolution not in ("false_positive", "reviewed"):
        raise HTTPException(400, "Resolution must be false_positive or reviewed")
    conn = get_connection()
    conn.execute("UPDATE sanctions_hits SET status=?, reviewed_by=? WHERE id=?", (resolution, admin["user_id"], hit_id))
    conn.commit()
    conn.close()
    return {"message": "Hit " + str(hit_id) + " resolved as " + resolution}

# ====================== KYC / AML / COMPLIANCE ======================

@app.post("/api/kyc/submit")
def submit_kyc(req: dict, token: str = None):
    """Submit KYC information."""
    user = get_user(token or req.get("token", ""))
    conn = get_connection()
    existing = conn.execute("SELECT id, kyc_level FROM kyc_submissions WHERE user_id=?", (user["user_id"],)).fetchone()
    if existing and existing["kyc_level"] in ("pending", "verified"):
        conn.close()
        raise HTTPException(400, "KYC already " + existing["kyc_level"])
    full_name = req.get("full_name", "")
    nationality = req.get("nationality", "")
    country = req.get("country", "")
    doc_type = req.get("document_type", "passport")
    doc_number = req.get("document_number", "")
    doc_ref = req.get("document_ref", "")
    
    if existing:
        conn.execute("UPDATE kyc_submissions SET full_name=?, nationality=?, country=?, document_type=?, document_number=?, kyc_level='pending', updated_at=datetime('now') WHERE user_id=?",
                     (full_name, nationality, country, doc_type, doc_number, doc_ref, user["user_id"]))
    else:
        cur = conn.execute("INSERT INTO kyc_submissions (user_id, full_namenationality, country, document_type, document_numberkyc_level) VALUES (?,?,?,?,?,?,?,?,'pending')",
                     (user["user_id"], full_name, dob, nationality, country, doc_type, doc_number, doc_ref))
    conn.commit()
    conn.close()
    # Run sanctions screening
    try:
        screen_sanctions(user["user_id"], full_name)
    except Exception:
        pass
    return {"status": "pending", "message": "KYC submitted for review. Do not submit again until reviewed."}

@app.get("/api/kyc/status")
def get_kyc_status(token: str):
    user = get_user(token)
    conn = get_connection()
    row = conn.execute("SELECT kyc_level, risk_score, full_name, nationality, created_at FROM kyc_submissions WHERE user_id=?", (user["user_id"],)).fetchone()
    conn.close()
    if not row:
        return {"kyc_level": "unverified", "risk_score": 0}
    return {"kyc_level": row["kyc_level"], "risk_score": row["risk_score"], "name": row["full_name"], "nationality": row["nationality"], "submitted_at": row["created_at"]}

@app.get("/api/admin/kyc/pending")
def admin_kyc_pending(token: str):
    require_admin(token)
    conn = get_connection()
    rows = conn.execute("""
        SELECT k.id, k.user_id, u.username, k.full_name, k.nationality, k.country, k.document_type, k.kyc_level, k.risk_score, k.created_at
        FROM kyc_submissions k JOIN users u ON k.user_id=u.id
        WHERE k.kyc_level IN ('pending','unverified')
        ORDER BY k.created_at DESC
    """).fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.put("/api/admin/kyc/{user_id}/verify")
def admin_verify_kyc(user_id: int, token: str, action: str = Query(...), notes: str = ""):
    """Approve or reject KYC: action=verified or rejected."""
    admin = require_admin(token)
    if action not in ("verified", "rejected"):
        raise HTTPException(400, "Action must be 'verified' or 'rejected'")
    conn = get_connection()
    conn.execute("UPDATE kyc_submissions SET kyc_level=?, reviewed_by=?, reviewed_at=datetime('now'), updated_at=datetime('now') WHERE user_id=?",
                 (action, admin["user_id"], user_id))
    conn.commit()
    conn.close()
    log_audit(admin["user_id"], "kyc_" + action, "users", user_id, notes)
    return {"message": "KYC " + action + " for user " + str(user_id)}

@app.get("/api/admin/compliance/alerts")
def admin_compliance_alerts(token: str, status: str = "open", limit: int = 100):
    require_admin(token)
    conn = get_connection()
    rows = conn.execute("""
        SELECT ta.*, u.username FROM transaction_alerts ta
        JOIN users u ON ta.user_id=u.id
        WHERE ta.status=? ORDER BY ta.created_at DESC LIMIT ?
    """, (status, limit)).fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.post("/api/admin/compliance/clear-alert")
def admin_clear_alert(token: str, alert_id: int = Query(...), notes: str = ""):
    admin = require_admin(token)
    conn = get_connection()
    conn.execute("UPDATE transaction_alerts SET status='dismissed', reviewed_by=?, details=json_set(COALESCE(details,'{}'),'$.notes',?) WHERE id=?",
                 (admin["user_id"], notes, alert_id))
    conn.commit()
    conn.close()
    return {"message": "Alert " + str(alert_id) + " dismissed"}

# ====================== STATIC FILES ======================

@app.get("/admin", response_class=HTMLResponse)
def admin_panel():
    return ADMIN_HTML

# ====================== STATIC FILE SERVING ======================

# Mount Basic-broker UI at /broker
app.mount("/broker", StaticFiles(directory="C:\\APP\\Basic-broker", html=True), name="broker")

# Mount admin app at /admin-panel
app.mount("/admin-panel", StaticFiles(directory="C:\\APP\\admin app", html=True), name="admin_panel")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)