"""
P&L Calculation Engine

Computes:
  - Realized P&L: Sum of (sell_price - cost_basis) for each lot sold (FIFO)
  - Unrealized P&L: Current holdings × (current_mid_price - avg_cost_basis)
  - Average cost basis: Total cost of all buy trades / total units bought

Data sourced from trades and ledger tables.
"""
from database import get_connection


def avg_cost_basis(user_id, instrument_id):
    """Calculate average cost basis per PPU for a user's position."""
    conn = get_connection()
    # Sum of all buys: cash spent / units received
    buys = conn.execute(
        """SELECT COALESCE(SUM(credit), 0) as total_units,
                  COALESCE(SUM(debit), 0) as total_cash
           FROM ledger_entries
           WHERE user_id=? AND instrument_id=? AND ledger_type='ppu' AND credit > 0""",
        (user_id, instrument_id),
    ).fetchone()
    conn.close()
    if not buys or buys["total_units"] <= 0:
        return 0
    # We need the cash spent on buys. Look at cash ledger for this instrument.
    conn = get_connection()
    cash_spent = conn.execute(
        """SELECT COALESCE(SUM(debit), 0) as spent
           FROM ledger_entries
           WHERE user_id=? AND instrument_id=? AND ledger_type='cash' AND debit > 0""",
        (user_id, instrument_id),
    ).fetchone()
    conn.close()
    total_units = buys["total_units"]
    total_cash = cash_spent["spent"] if cash_spent else 0
    return round(total_cash / total_units, 4) if total_units > 0 else 0


def realized_pnl(user_id, instrument_id):
    """Calculate realized P&L from completed sell trades (FIFO method)."""
    conn = get_connection()
    # Get all sells: each sell reduces position
    sells = conn.execute(
        """SELECT t.id, t.quantity, t.price, t.total_value
           FROM trades t
           WHERE t.seller_id=? AND t.instrument_id=?
           ORDER BY t.created_at ASC""",
        (user_id, instrument_id),
    ).fetchall()
    # Get all buys
    buys = conn.execute(
        """SELECT t.id, t.quantity, t.price, t.total_value
           FROM trades t
           WHERE t.buyer_id=? AND t.instrument_id=?
           ORDER BY t.created_at ASC""",
        (user_id, instrument_id),
    ).fetchall()
    conn.close()

    # Simple FIFO: match sells against buys in order
    # For each sell, deduct from earliest buys
    buy_queue = [{"qty": b["quantity"], "price": b["price"]} for b in buys]
    total_realized = 0

    for sell in sells:
        remaining = sell["quantity"]
        while remaining > 0 and buy_queue:
            lot = buy_queue[0]
            match_qty = min(remaining, lot["qty"])
            cost = match_qty * lot["price"]
            revenue = match_qty * sell["price"]
            total_realized += revenue - cost
            remaining -= match_qty
            lot["qty"] -= match_qty
            if lot["qty"] <= 0:
                buy_queue.pop(0)
            if remaining <= 0:
                break

    return round(total_realized, 2)


def user_pnl(user_id, instrument_id=None, mid_price=None):
    """Full P&L report for a user, optionally per instrument."""
    conn = get_connection()

    if instrument_id:
        insts = [{"id": instrument_id}]
    else:
        insts = conn.execute("SELECT id FROM instruments WHERE status='active'").fetchall()

    positions = []
    total_realized = 0
    total_unrealized = 0

    for inst in insts:
        iid = inst["id"]
        # Get current holdings
        hold = conn.execute(
            "SELECT units FROM ppu_holdings WHERE user_id=? AND instrument_id=?",
            (user_id, iid),
        ).fetchone()
        units = hold["units"] if hold else 0

        inst_name = conn.execute("SELECT name FROM instruments WHERE id=?", (iid,)).fetchone()
        iname = inst_name["name"] if inst_name else f"#{iid}"

        # Get current mid price from order book
        if mid_price is None:
            bid = conn.execute(
                "SELECT price FROM orders WHERE instrument_id=? AND side='buy' AND status IN ('open','partially_filled') ORDER BY price DESC LIMIT 1",
                (iid,)).fetchone()
            ask = conn.execute(
                "SELECT price FROM orders WHERE instrument_id=? AND side='sell' AND status IN ('open','partially_filled') ORDER BY price ASC LIMIT 1",
                (iid,)).fetchone()
            mp = round((bid["price"] + ask["price"]) / 2, 2) if (bid and ask) else None
        else:
            mp = mid_price

        cost = avg_cost_basis(user_id, iid)
        rpnl = realized_pnl(user_id, iid)
        upnl = round(units * (mp - cost), 2) if (mp and units > 0) else 0

        total_realized += rpnl
        total_unrealized += upnl

        if units > 0 or rpnl != 0:
            positions.append({
                "instrument_id": iid,
                "instrument_name": iname,
                "units": round(units, 2),
                "avg_cost_basis": cost,
                "current_mid_price": mp,
                "unrealized_pnl": upnl,
                "realized_pnl": rpnl,
            })

    conn.close()
    return {
        "total_realized_pnl": round(total_realized, 2),
        "total_unrealized_pnl": round(total_unrealized, 2),
        "total_pnl": round(total_realized + total_unrealized, 2),
        "positions": positions,
    }