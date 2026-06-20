"""
Settlement System — T+3 Paper Process

The Settlement Flow (Paper T+3):
1. Trade agreed → signed contract → Trade ID → logged
2. Buyer sends funds → into escrow → 'Escrow: Funded'
3. Seller delivers asset/title → inspected → 'Delivery: Confirmed'
4. Registry updated → new owner recorded
5. T+3: All three confirmed? → funds released → 'Settled'
6. If any step fails by T+3 → escrow held → dispute triggered → penalty clause
"""

from database import get_connection
from ledger import settle_trade_ledger


def fund_escrow(trade_id, admin_id):
    """Step 2: Mark trade as escrow funded (buyer sent funds)."""
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("UPDATE trades SET status = 'escrow_funded' WHERE id = ? AND status = 'pending'", (trade_id,))
    if cursor.rowcount == 0:
        conn.close()
        return {"success": False, "error": "Trade not found or already past pending status"}

    cursor.execute(
        "INSERT INTO settlement_events (trade_id, event_type, description, created_by) VALUES (?, ?, ?, ?)",
        (trade_id, "escrow_funded", "Buyer funds received in escrow", admin_id),
    )
    conn.commit()
    conn.close()
    return {"success": True, "message": "Escrow marked as funded"}


def confirm_delivery(trade_id, admin_id):
    """Step 3: Mark trade as delivery confirmed (seller delivered asset/title)."""
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute(
        "UPDATE trades SET status = 'delivery_confirmed' WHERE id = ? AND status = 'escrow_funded'",
        (trade_id,),
    )
    if cursor.rowcount == 0:
        conn.close()
        return {"success": False, "error": "Trade not found or escrow not yet funded"}

    cursor.execute(
        "INSERT INTO settlement_events (trade_id, event_type, description, created_by) VALUES (?, ?, ?, ?)",
        (trade_id, "delivery_confirmed", "Physical delivery confirmed by inspector", admin_id),
    )
    conn.commit()
    conn.close()
    return {"success": True, "message": "Delivery confirmed"}


def complete_settlement(trade_id, admin_id):
    """
    Step 4-5: Complete settlement — release funds from escrow, update registry.
    Posts the double-entry ledger entries.
    """
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute(
        "SELECT id, buyer_id, seller_id, quantity, price_per_unit, total_value, status FROM trades WHERE id = ?",
        (trade_id,),
    )
    trade = cursor.fetchone()
    if not trade:
        conn.close()
        return {"success": False, "error": "Trade not found"}

    if trade["status"] != "delivery_confirmed":
        conn.close()
        return {"success": False, "error": "Delivery must be confirmed before settlement"}

    # Post ledger entries
    settle_trade_ledger(
        trade_id=trade["id"],
        buyer_id=trade["buyer_id"],
        seller_id=trade["seller_id"],
        quantity=trade["quantity"],
        total_value=trade["total_value"],
    )

    # Update trade status
    cursor.execute(
        "UPDATE trades SET status = 'settled', settled_at = datetime('now') WHERE id = ?",
        (trade_id,),
    )
    cursor.execute(
        "INSERT INTO settlement_events (trade_id, event_type, description, created_by) VALUES (?, ?, ?, ?)",
        (trade_id, "settled", "Settlement completed — funds released, registry updated", admin_id),
    )

    conn.commit()
    conn.close()
    return {"success": True, "message": "Trade settled successfully"}


def raise_dispute(trade_id, reason, admin_id):
    """Raise a dispute when settlement fails."""
    conn = get_connection()
    cursor = conn.cursor()

    # Check trade exists
    cursor.execute("SELECT id, status FROM trades WHERE id = ?", (trade_id,))
    trade = cursor.fetchone()
    if not trade:
        conn.close()
        return {"success": False, "error": "Trade not found"}

    # Update trade status
    cursor.execute("UPDATE trades SET status = 'disputed' WHERE id = ?", (trade_id,))

    # Create dispute record
    cursor.execute(
        "INSERT INTO disputes (trade_id, reason) VALUES (?, ?)",
        (trade_id, reason),
    )
    cursor.execute(
        "INSERT INTO settlement_events (trade_id, event_type, description, created_by) VALUES (?, ?, ?, ?)",
        (trade_id, "dispute_raised", f"Dispute raised: {reason}", admin_id),
    )

    conn.commit()
    conn.close()
    return {"success": True, "message": "Dispute raised", "trade_id": trade_id}


def get_trade_settlement_history(trade_id):
    """Get all settlement events for a trade (the audit trail)."""
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute(
        """SELECT id, trade_id, event_type, description, created_by, created_at
           FROM settlement_events
           WHERE trade_id = ?
           ORDER BY created_at ASC""",
        (trade_id,),
    )
    rows = cursor.fetchall()
    conn.close()

    return [
        {
            "id": r["id"],
            "trade_id": r["trade_id"],
            "event_type": r["event_type"],
            "description": r["description"],
            "created_by": r["created_by"],
            "created_at": r["created_at"],
        }
        for r in rows
    ]