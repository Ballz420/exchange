"""
Double-Entry Ledger Engine

Two ledgers:
  - cash: tracks money (net zero across all users)
  - ppu:  tracks PPU holdings (total = instrument float)

Every transfer is two entries: DR one account, CR another.
Balances are NEVER stored directly — DERIVED from full history.
"""
from database import get_connection


def post(ledger_type, user_id, trade_id, instrument_id, debit, credit, description):
    """Post a single ledger entry."""
    conn = get_connection()
    conn.execute(
        "INSERT INTO ledger_entries (ledger_type, user_id, trade_id, instrument_id, debit, credit, description) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (ledger_type, user_id, trade_id, instrument_id, round(debit, 2), round(credit, 2), description),
    )
    conn.commit()
    conn.close()


def post_double(ledger_type, dr_user, cr_user, amount, trade_id=None, instrument_id=None, description=""):
    """Post a double entry: DR one user, CR another user."""
    conn = get_connection()
    conn.execute(
        "INSERT INTO ledger_entries (ledger_type, user_id, trade_id, instrument_id, debit, credit, description) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (ledger_type, dr_user, trade_id, instrument_id, round(amount, 2), 0, description),
    )
    conn.execute(
        "INSERT INTO ledger_entries (ledger_type, user_id, trade_id, instrument_id, debit, credit, description) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (ledger_type, cr_user, trade_id, instrument_id, 0, round(amount, 2), description),
    )
    conn.commit()
    conn.close()


def get_balance(user_id, ledger_type, instrument_id=None):
    """Derive balance = SUM(credits) - SUM(debits)."""
    conn = get_connection()
    if instrument_id:
        cur = conn.execute(
            "SELECT COALESCE(SUM(credit), 0) - COALESCE(SUM(debit), 0) as bal FROM ledger_entries WHERE user_id=? AND ledger_type=? AND instrument_id=?",
            (user_id, ledger_type, instrument_id),
        )
    else:
        cur = conn.execute(
            "SELECT COALESCE(SUM(credit), 0) - COALESCE(SUM(debit), 0) as bal FROM ledger_entries WHERE user_id=? AND ledger_type=?",
            (user_id, ledger_type),
        )
    bal = cur.fetchone()["bal"]
    conn.close()
    return bal


def get_all_balances(ledger_type, instrument_id=None):
    """Get all user balances for a ledger type. Returns {user_id: balance}."""
    conn = get_connection()
    if instrument_id:
        cur = conn.execute(
            "SELECT user_id, COALESCE(SUM(credit), 0) - COALESCE(SUM(debit), 0) as bal FROM ledger_entries WHERE ledger_type=? AND instrument_id=? GROUP BY user_id",
            (ledger_type, instrument_id),
        )
    else:
        cur = conn.execute(
            "SELECT user_id, COALESCE(SUM(credit), 0) - COALESCE(SUM(debit), 0) as bal FROM ledger_entries WHERE ledger_type=? GROUP BY user_id",
            (ledger_type,),
        )
    rows = cur.fetchall()
    conn.close()
    return {r["user_id"]: r["bal"] for r in rows}


def reconcile():
    """Verify ledger integrity. cash net = 0. ppu total = float."""
    conn = get_connection()
    cash_net = conn.execute("SELECT COALESCE(SUM(credit), 0) - COALESCE(SUM(debit), 0) as net FROM ledger_entries WHERE ledger_type='cash'").fetchone()["net"]
    ppu_total = conn.execute("SELECT COALESCE(SUM(credit), 0) - COALESCE(SUM(debit), 0) as net FROM ledger_entries WHERE ledger_type='ppu'").fetchone()["net"]
    float_total = conn.execute("SELECT COALESCE(SUM(total_float), 0) as f FROM instruments WHERE status='active'").fetchone()["f"]
    conn.close()
    return {
        "cash_net_zero": abs(cash_net) < 0.001,
        "cash_total": round(cash_net, 2),
        "ppu_matches_float": abs(ppu_total - float_total) < 0.001,
        "ppu_total": round(ppu_total, 2),
        "instrument_float": round(float_total, 2),
        "all_balanced": abs(cash_net) < 0.001 and abs(ppu_total - float_total) < 0.001,
    }


def get_statement(user_id):
    """Get full ledger statement for a user with human-readable format."""
    conn = get_connection()
    rows = conn.execute(
        """SELECT e.*, u.username as uname
           FROM ledger_entries e
           JOIN users u ON e.user_id = u.id
           WHERE e.user_id = ?
           ORDER BY e.created_at ASC""",
        (user_id,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]