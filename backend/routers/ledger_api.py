from fastapi import APIRouter, HTTPException
from database import get_connection
from routers.auth import get_current_user
from ledger import get_balance, get_all_balances, reconcile, get_account_statement

router = APIRouter(prefix="/api/ledger", tags=["ledger"])


@router.get("/balance")
def balance(token: str, ledger_type: str = "cash"):
    user = get_current_user(token)

    if ledger_type not in ("cash", "unit"):
        raise HTTPException(status_code=400, detail="ledger_type must be 'cash' or 'unit'")

    balance = get_balance(user["user_id"], ledger_type)
    return {"user_id": user["user_id"], "username": user["username"], "ledger_type": ledger_type, "balance": balance}


@router.get("/all-balances")
def all_balances(token: str, ledger_type: str = "cash"):
    user = get_current_user(token)
    if user["role"] != "admin":
        # Non-admins can only see their own balance via /balance
        raise HTTPException(status_code=403, detail="Admin access required")

    if ledger_type not in ("cash", "unit"):
        raise HTTPException(status_code=400, detail="ledger_type must be 'cash' or 'unit'")

    balances = get_all_balances(ledger_type)

    # Enrich with usernames
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, username FROM users")
    users = {u["id"]: u["username"] for u in cursor.fetchall()}
    conn.close()

    result = []
    for account_id, bal in sorted(balances.items()):
        result.append({
            "user_id": account_id,
            "username": users.get(account_id, "Unknown"),
            "balance": bal,
        })

    return result


@router.get("/reconcile")
def get_reconciliation(token: str):
    user = get_current_user(token)
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    return reconcile()


@router.get("/statement")
def statement(token: str, ledger_type: str = "cash"):
    user = get_current_user(token)

    if ledger_type not in ("cash", "unit"):
        raise HTTPException(status_code=400, detail="ledger_type must be 'cash' or 'unit'")

    entries = get_account_statement(user["user_id"], ledger_type)
    return {
        "user_id": user["user_id"],
        "username": user["username"],
        "ledger_type": ledger_type,
        "entries": entries,
    }


@router.get("/commodities")
def list_commodities(token: str):
    """List all available commodities."""
    get_current_user(token)  # Just authenticate

    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, unit_of_measure, description FROM commodities ORDER BY name")
    rows = cursor.fetchall()
    conn.close()

    return [
        {
            "id": r["id"],
            "name": r["name"],
            "unit_of_measure": r["unit_of_measure"],
            "description": r["description"],
        }
        for r in rows
    ]