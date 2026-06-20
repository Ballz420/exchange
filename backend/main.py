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
import hashlib, secrets, os
from datetime import datetime, timedelta
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, FileResponse
from pydantic import BaseModel, Field
from database import init_db, get_connection, DB_PATH
from ledger import post_double, get_balance, get_statement, reconcile as rec_ledger
from pnl import user_pnl, avg_cost_basis

# === INIT ===
init_db()
app = FastAPI(title="FASEM-P Exchange", version="2.0.0", docs_url="/docs")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

# === SIMPLE AUTH ===
tokens = {}
def hash_pw(pw): return hashlib.sha256(pw.encode()).hexdigest()
def gen_token(): return secrets.token_hex(32)

def get_user(token: str):
    u = tokens.get(token)
    if not u: raise HTTPException(401, "Invalid token")
    return u

def require_admin(token: str):
    u = get_user(token)
    if u["role"] != "admin": raise HTTPException(403, "Admin required")
    return u

# ====================== AUTH ======================

class RegisterReq(BaseModel):
    username: str
    password: str
    role: str = "trader"

class LoginReq(BaseModel):
    username: str
    password: str

@app.post("/api/auth/register")
def register(req: RegisterReq):
    if req.role not in ("trader", "admin"):
        raise HTTPException(400, "Role must be trader or admin")
    conn = get_connection()
    try:
        conn.execute("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
                     (req.username, hash_pw(req.password), req.role))
        conn.commit()
        uid = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    except Exception as e:
        raise HTTPException(400, "Username taken" if "UNIQUE" in str(e) else str(e))
    finally:
        conn.close()
    return {"id": uid, "username": req.username, "role": req.role}

@app.post("/api/auth/login")
def login(req: LoginReq):
    conn = get_connection()
    u = conn.execute("SELECT id, username, role FROM users WHERE username=? AND password_hash=?",
                     (req.username, hash_pw(req.password))).fetchone()
    conn.close()
    if not u: raise HTTPException(401, "Invalid credentials")
    token = gen_token()
    tokens[token] = {"user_id": u["id"], "username": u["username"], "role": u["role"]}
    return {"token": token, "user_id": u["id"], "username": u["username"], "role": u["role"]}

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
def db_table(table: str, human: int = 0, limit: int = 100):
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
    token: str
    name: str
    description: str = ""
    total_float: float = Field(..., gt=0)

@app.post("/api/admin/instruments")
def admin_create_instrument(req: InstrumentCreate):
    require_admin(req.token)
    conn = get_connection()
    try:
        conn.execute("INSERT INTO instruments (name, description, total_float, created_by) VALUES (?, ?, ?, ?)",
                     (req.name, req.description, req.total_float, tokens[req.token]["user_id"]))
        conn.commit()
        iid = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    except Exception as e:
        conn.close()
        raise HTTPException(400, "Name taken" if "UNIQUE" in str(e) else str(e))
    conn.close()
    return {"instrument_id": iid, "name": req.name, "total_float": req.total_float, "message": "PPU instrument listed (IPO)"}

@app.put("/api/admin/instruments/{instrument_id}")
def admin_update_instrument(instrument_id: int, token: str, status: str = Query(None)):
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
    token: str
    user_id: int
    amount: float = Field(..., gt=0)

@app.post("/api/admin/cash/credit")
def admin_cash_credit(req: CashCredit):
    require_admin(req.token)
    post_double("cash", 0, req.user_id, req.amount, description=f"Admin cash credit: ${req.amount}")
    return {"message": f"Credited ${req.amount} to user {req.user_id}", "new_balance": get_balance(req.user_id, "cash")}

class PPUCredit(BaseModel):
    token: str
    user_id: int
    instrument_id: int
    units: float = Field(..., gt=0)

@app.post("/api/admin/ppu/credit")
def admin_ppu_credit(req: PPUCredit):
    require_admin(req.token)
    # Credit PPUs from the system (user 0 = exchange account)
    post_double("ppu", 0, req.user_id, req.units, instrument_id=req.instrument_id, description=f"Admin PPU credit: {req.units} units")
    # Update ppu_holdings
    conn = get_connection()
    conn.execute("INSERT INTO ppu_holdings (user_id, instrument_id, units) VALUES (?, ?, ?) ON CONFLICT(user_id, instrument_id) DO UPDATE SET units = units + ?",
                 (req.user_id, req.instrument_id, req.units, req.units))
    conn.commit()
    conn.close()
    return {"message": f"Credited {req.units} PPUs to user {req.user_id}", "new_balance": get_balance(req.user_id, "ppu", req.instrument_id)}

# ====================== MARKET DATA ======================

@app.get("/api/instruments")
def list_instruments(token: str, status: str = None):
    get_user(token)
    conn = get_connection()
    q = "SELECT * FROM instruments"
    p = []
    if status:
        q += " WHERE status=?"
        p.append(status)
    q += " ORDER BY created_at DESC"
    rows = conn.execute(q, p).fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.get("/api/orderbook/{instrument_id}")
def get_orderbook(instrument_id: int, token: str):
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
    token: str
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
    conn.execute("INSERT INTO orders (user_id, instrument_id, side, price, quantity) VALUES (?, ?, ?, ?, ?)",
                 (user["user_id"], req.instrument_id, req.side, req.price, req.quantity))
    order_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
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
        trade_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]

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
                conn.execute("INSERT INTO ppu_holdings (user_id, instrument_id, units) VALUES (?, ?, ?)",
                             (uid, instrument_id, max(delta, 0)))

        conn.commit()
        trades_made += 1

    conn.close()
    return trades_made


# ====================== CANCEL ORDER ======================

@app.post("/api/orders/cancel/{order_id}")
def cancel_order(order_id: int, token: str):
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
    return {"message": "Order cancelled"}

# ====================== USER ORDERS / TRADES ======================

@app.get("/api/orders/user/{user_id}")
def get_user_orders(user_id: int, token: str):
    get_user(token)
    conn = get_connection()
    rows = conn.execute("SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC", (user_id,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.get("/api/trades")
def list_trades(token: str, instrument_id: int = None, user_id: int = None, limit: int = 50):
    get_user(token)
    conn = get_connection()
    q = "SELECT t.*, bu.username as buyer_name, su.username as seller_name, i.name as instrument_name FROM trades t JOIN users bu ON t.buyer_id=bu.id JOIN users su ON t.seller_id=su.id JOIN instruments i ON t.instrument_id=i.id WHERE 1=1"
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
def get_accounts(user_id: int, token: str):
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
def get_ledger(user_id: int, token: str):
    get_user(token)
    entries = get_statement(user_id)
    return entries

@app.get("/api/reconcile")
def reconcile(token: str):
    get_user(token)
    return rec_ledger()

# ====================== PROFIT ======================

class DeclareProfitReq(BaseModel):
    token: str
    instrument_id: int
    period_label: str
    total_profit: float = Field(..., gt=0)

@app.post("/api/profit/declare")
def declare_profit(req: DeclareProfitReq):
    get_user(req.token)
    conn = get_connection()
    inst = conn.execute("SELECT id, total_float FROM instruments WHERE id=?", (req.instrument_id,)).fetchone()
    if not inst: conn.close(); raise HTTPException(404, "Instrument not found")

    # Check period unique
    existing = conn.execute("SELECT id FROM profit_declarations WHERE instrument_id=? AND period_label=?", (req.instrument_id, req.period_label)).fetchone()
    if existing: conn.close(); raise HTTPException(400, f"Period '{req.period_label}' already declared")

    total_ppus = inst["total_float"]
    profit_per = round(req.total_profit / total_ppus, 4) if total_ppus > 0 else 0

    conn.execute(
        "INSERT INTO profit_declarations (instrument_id, period_label, total_profit, profit_per_ppu, total_ppus) VALUES (?, ?, ?, ?, ?)",
        (req.instrument_id, req.period_label, req.total_profit, profit_per, total_ppus),
    )
    did = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    conn.commit()
    conn.close()
    return {"declaration_id": did, "profit_per_ppu": profit_per, "total_ppus": total_ppus}

@app.post("/api/profit/distribute/{declaration_id}")
def distribute_profit(declaration_id: int, token: str):
    get_user(token)
    conn = get_connection()
    decl = conn.execute("SELECT * FROM profit_declarations WHERE id=?", (declaration_id,)).fetchone()
    if not decl: conn.close(); raise HTTPException(404, "Declaration not found")
    if decl["status"] == "distributed": conn.close(); raise HTTPException(400, "Already distributed")

    # Get all holders
    holders = conn.execute(
        "SELECT p.id as holding_id, p.user_id, p.units FROM ppu_holdings p WHERE p.instrument_id=? AND p.units>0",
        (decl["instrument_id"],)).fetchall()

    count = 0
    for h in holders:
        amount = round(h["units"] * decl["profit_per_ppu"], 2)
        if amount <= 0: continue
        conn.execute(
            "INSERT INTO profit_distributions (declaration_id, user_id, ppu_holding_id, units_held, amount_paid) VALUES (?, ?, ?, ?, ?)",
            (declaration_id, h["user_id"], h["holding_id"], h["units"], amount),
        )
        # Credit cash
        post_double("cash", 0, h["user_id"], amount, description=f"Profit distribution: ${amount} for {h['units']} PPUs ({decl['period_label']})")
        count += 1

    conn.execute("UPDATE profit_declarations SET status='distributed', distributed_at=datetime('now') WHERE id=?", (declaration_id,))
    conn.commit()
    conn.close()
    return {"message": f"Distributed to {count} holders", "profit_per_ppu": decl["profit_per_ppu"]}

@app.get("/api/profit/history/{instrument_id}")
def profit_history(instrument_id: int, token: str):
    get_user(token)
    conn = get_connection()
    rows = conn.execute("SELECT * FROM profit_declarations WHERE instrument_id=? ORDER BY declared_at DESC", (instrument_id,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]

# ====================== HEALTH ======================

@app.get("/api/health")
def health():
    return {"status": "ok", "version": "2.0.0", "db": DB_PATH}

# ====================== ADMIN HTML DASHBOARD ======================

ADMIN_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>FASEM-P Exchange Admin</title>
<style>
  body{background:#0a0e17;color:#e2e8f0;font-family:system-ui;margin:0;padding:20px}
  h1{color:#00d68f;font-family:monospace}
  h2{color:#ffaa00;font-size:14px;text-transform:uppercase;letter-spacing:1px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px;margin:10px 0}
  .card{background:#131a2b;border:1px solid #1e2d45;border-radius:6px;padding:12px}
  .card h3{font-size:12px;color:#94a3b8;margin:0 0 4px;text-transform:uppercase}
  .card .val{font-family:monospace;font-size:18px;color:#e2e8f0}
  .card .val.green{color:#00d68f}
  .card .val.red{color:#ff4d6a}
  .card .val.amber{color:#ffaa00}
  table{width:100%;border-collapse:collapse;font-family:monospace;font-size:11px;margin:6px 0}
  th{background:#1e2d45;color:#94a3b8;padding:4px 6px;text-align:left;text-transform:uppercase;font-size:9px}
  td{padding:3px 6px;border-bottom:1px solid #1e2d45}
  tr:hover{background:#1e293b}
  .badge{display:inline-block;padding:1px 6px;border-radius:3px;font-size:10px}
  .badge.ok{background:#00d68f22;color:#00d68f;border:1px solid #00d68f44}
  .badge.fail{background:#ff4d6a22;color:#ff4d6a;border:1px solid #ff4d6a44}
  .nav{display:flex;gap:6px;margin:10px 0;flex-wrap:wrap}
  .nav button{background:#1e2d45;border:1px solid transparent;color:#94a3b8;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:11px;text-transform:uppercase}
  .nav button.active{background:#00d68f22;border-color:#00d68f44;color:#00d68f}
  .nav button:hover{background:#243044}
  pre{font-family:monospace;font-size:11px;color:#94a3b8;overflow-x:auto}
</style>
</head>
<body>
<h1>FASEM-P EXCHANGE</h1>
<div style="font-size:12px;color:#64748b;margin-bottom:20px">Admin Dashboard — Database Viewer & Reconciliation</div>

<div class="grid" id="recon"></div>

<div class="nav" id="tabs">
  <button class="active" onclick="showTable('users')">Users</button>
  <button onclick="showTable('instruments')">Instruments</button>
  <button onclick="showTable('ppu_holdings')">PPU Holdings</button>
  <button onclick="showTable('orders')">Orders</button>
  <button onclick="showTable('trades')">Trades</button>
  <button onclick="showTable('ledger_entries')">Ledger</button>
  <button onclick="showTable('profit_declarations')">Profits</button>
</div>

<div id="data"></div>

<script>
async function loadTable(name){
  const r=await fetch('/api/db/table/'+name+'?human=1&limit=200');
  const data=await r.json();
  if(!data.length) return '<p style="color:#64748b">No data</p>';
  const cols=Object.keys(data[0]);
  let html='<table><tr>'+cols.map(c=>'<th>'+c+'</th>').join('')+'</tr>';
  data.forEach(row=>{
    html+='<tr>'+cols.map(c=>{
      let v=row[c];
      if(v===null||v===undefined) v='<span style="color:#64748b">--</span>';
      else if(typeof v==='number'){
        const cl=v>0?'green':v<0?'red':'';
        v='<span class="val '+cl+'">'+v.toFixed(2)+'</span>';
      }
      return '<td>'+v+'</td>';
    }).join('')+'</tr>';
  });
  return html+'</table>';
}

async function showTable(name){
  document.querySelectorAll('#tabs button').forEach(b=>b.classList.remove('active'));
  event.target.classList.add('active');
  document.getElementById('data').innerHTML = '<p style="color:#64748b">Loading...</p>';
  document.getElementById('data').innerHTML = await loadTable(name);
}

async function loadRecon(){
  const r=await fetch('/api/reconcile?token=admin');
  const d=await r.json();
  document.getElementById('recon').innerHTML=\`
    <div class="card"><h3>Cash Net Zero</h3><div class="val \${d.cash_net_zero?'green':'red'}">\${d.cash_total}</div></div>
    <div class="card"><h3>PPU Total</h3><div class="val \${d.ppu_matches_float?'green':'red'}">\${d.ppu_total}</div></div>
    <div class="card"><h3>Instrument Float</h3><div class="val green">\${d.instrument_float}</div></div>
    <div class="card"><h3>Status</h3><span class="badge \${d.all_balanced?'ok':'fail'}">\${d.all_balanced?'BALANCED':'UNBALANCED'}</span></div>
  \`;
}

async function loadSchema(){
  const r=await fetch('/api/db/schema');
  const d=await r.json();
  document.getElementById('data').innerHTML = '<pre>'+d.tables.join('\\n\\n')+'</pre>';
}

loadRecon();
showTable('users');
</script>
</body>
</html>"""

# ====================== MARKET ORDER (WISHLIST #1) ======================

class MarketOrderReq(BaseModel):
    token: str
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
        trade_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]

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
                conn.execute("INSERT INTO ppu_holdings (user_id, instrument_id, units) VALUES (?, ?, ?)",
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
def instrument_summary(instrument_id: int, token: str):
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
def get_pnl(user_id: int, token: str):
    """Get mark-to-market P&L for a user."""
    get_user(token)
    return user_pnl(user_id)


# ====================== ADMIN: LIST USERS (WISHLIST #4) ======================

@app.get("/api/admin/users")
def admin_list_users(token: str):
    """List all users with balances and holdings."""
    require_admin(token)
    conn = get_connection()
    users = conn.execute("SELECT id, username, role, created_at FROM users ORDER BY created_at DESC").fetchall()
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
            "cash_balance": round(cash, 2),
            "ppu_holdings": [{"instrument_id": h["id"], "instrument_name": h["name"], "units": round(h["units"], 2)} for h in holdings],
            "created_at": u["created_at"],
        })
    conn.close()
    return result


# ====================== ADMIN: ALL ORDERS (WISHLIST #5) ======================

@app.get("/api/admin/orders")
def admin_list_orders(token: str, status: str = None, instrument_id: int = None, limit: int = 100):
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
def admin_list_holdings(token: str, instrument_id: int = None):
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


# ====================== STATIC FILES ======================

@app.get("/admin", response_class=HTMLResponse)
def admin_panel():
    return ADMIN_HTML

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
