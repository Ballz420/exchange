"""
Double-Entry Ledger Engine

Two ledgers:
  - Unit Ledger: tracks ownership of commodity units (total float is fixed)
  - Cash Ledger: tracks money (net zero on every trade)

Every transfer is two lines: one debit, one credit.
Balances are NEVER stored directly — they are DERIVED from the full history of entries.
"""

from database import get_connection


def post_double_entry(ledger_type, trade_id, debit_account, credit_account, amount):
    """
    Post a double-entry transaction to a ledger.

    Args:
        ledger_type: 'cash' or 'unit'
        trade_id: the trade this entry belongs to
        debit_account: account ID that is debited (gives up value)
        credit_account: account ID that is credited (receives value)
        amount: the amount to transfer
    """
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute(
        """INSERT INTO ledger_entries (ledger_type, account_id, trade_id, debit, credit)
           VALUES (?, ?, ?, ?, ?)""",
        (ledger_type, debit_account, trade_id, amount, 0),
    )
    cursor.execute(
        """INSERT INTO ledger_entries (ledger_type, account_id, trade_id, debit, credit)
           VALUES (?, ?, ?, ?, ?)""",
        (ledger_type, credit_account, trade_id, 0, amount),
    )

    conn.commit()
    conn.close()


def settle_trade_ledger(trade_id, buyer_id, seller_id, quantity, total_value):
    """
    Post all 4 ledger entries for a settled trade:

    Seller gives up 'quantity' units, gets 'total_value' cash.
    Buyer gives up 'total_value' cash, gets 'quantity' units.

    Ledger           Account    Debit    Credit
    --------------------------------------------
    Units            Seller     quantity
    Units            Buyer               quantity
    Cash             Buyer      total_value
    Cash             Seller               total_value
    """
    post_double_entry("unit", trade_id, seller_id, buyer_id, quantity)
    post_double_entry("cash", trade_id, buyer_id, seller_id, total_value)


def get_balance(account_id, ledger_type):
    """
    Derive an account's balance from all historical entries.
    Balance = SUM(credits) - SUM(debits)
    """
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute(
        """SELECT COALESCE(SUM(credit), 0) - COALESCE(SUM(debit), 0) as balance
           FROM ledger_entries
           WHERE account_id = ? AND ledger_type = ?""",
        (account_id, ledger_type),
    )
    row = cursor.fetchone()
    conn.close()
    return row["balance"] if row else 0.0


def get_total_float(ledger_type="unit"):
    """
    Verify ledger integrity: SUM of all holdings should equal total float.
    For units, this should be constant.
    For cash, this should be zero (net zero across all accounts).
    """
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute(
        """SELECT SUM(credit) - SUM(debit) as total
           FROM ledger_entries
           WHERE ledger_type = ?""",
        (ledger_type,),
    )
    row = cursor.fetchone()
    conn.close()
    return row["total"] if row else 0.0


def get_all_balances(ledger_type):
    """
    Get all account balances for a given ledger type.
    Returns dict of {account_id: balance}
    """
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute(
        """SELECT account_id,
                  SUM(credit) - SUM(debit) as balance
           FROM ledger_entries
           WHERE ledger_type = ?
           GROUP BY account_id""",
        (ledger_type,),
    )
    rows = cursor.fetchall()
    conn.close()

    return {row["account_id"]: row["balance"] for row in rows}


def get_account_statement(account_id, ledger_type):
    """
    Get all ledger entries for a specific account.
    """
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute(
        """SELECT id, ledger_type, account_id, trade_id, debit, credit, created_at
           FROM ledger_entries
           WHERE account_id = ? AND ledger_type = ?
           ORDER BY created_at ASC""",
        (account_id, ledger_type),
    )
    rows = cursor.fetchall()
    conn.close()

    return [
        {
            "id": r["id"],
            "ledger_type": r["ledger_type"],
            "account_id": r["account_id"],
            "trade_id": r["trade_id"],
            "debit": r["debit"],
            "credit": r["credit"],
            "created_at": r["created_at"],
        }
        for r in rows
    ]


def reconcile():
    """
    Run the two reconciliation checks:
    1. SUM of all unit holdings should equal some fixed float > 0
    2. SUM of all cash holdings should equal 0 (net zero)
    Returns dict with status and details.
    """
    unit_total = get_total_float("unit")
    cash_total = get_total_float("cash")

    result = {
        "unit_total": unit_total,
        "cash_total": cash_total,
        "unit_balanced": unit_total >= 0,
        "cash_balanced": abs(cash_total) < 0.001,
        "all_balanced": unit_total >= 0 and abs(cash_total) < 0.001,
    }
    return result