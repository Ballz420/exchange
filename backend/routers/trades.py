from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from database import get_connection
from routers.auth import get_current_user

router = APIRouter(prefix="/api/trades", tags=["trades"])


class TokenOnly(BaseModel):
    token: str


@router.get("/list")
def list_trades(token: str):
    user = get_current_user(token)

    conn = get_connection()
    cursor = conn.cursor()

    if user["role"] == "admin":
        cursor.execute(
            """SELECT t.id, t.rfq_id, t.buyer_id, bu.username as buyer_name,
                      t.seller_id, su.username as seller_name,
                      t.commodity_id, c.name as commodity_name,
                      t.quantity, t.price_per_unit, t.total_value,
                      t.status, t.created_at, t.settled_at
               FROM trades t
               JOIN users bu ON t.buyer_id = bu.id
               JOIN users su ON t.seller_id = su.id
               JOIN commodities c ON t.commodity_id = c.id
               ORDER BY t.created_at DESC"""
        )
    elif user["role"] == "buyer":
        cursor.execute(
            """SELECT t.id, t.rfq_id, t.buyer_id, bu.username as buyer_name,
                      t.seller_id, su.username as seller_name,
                      t.commodity_id, c.name as commodity_name,
                      t.quantity, t.price_per_unit, t.total_value,
                      t.status, t.created_at, t.settled_at
               FROM trades t
               JOIN users bu ON t.buyer_id = bu.id
               JOIN users su ON t.seller_id = su.id
               JOIN commodities c ON t.commodity_id = c.id
               WHERE t.buyer_id = ?
               ORDER BY t.created_at DESC""",
            (user["user_id"],),
        )
    else:
        cursor.execute(
            """SELECT t.id, t.rfq_id, t.buyer_id, bu.username as buyer_name,
                      t.seller_id, su.username as seller_name,
                      t.commodity_id, c.name as commodity_name,
                      t.quantity, t.price_per_unit, t.total_value,
                      t.status, t.created_at, t.settled_at
               FROM trades t
               JOIN users bu ON t.buyer_id = bu.id
               JOIN users su ON t.seller_id = su.id
               JOIN commodities c ON t.commodity_id = c.id
               WHERE t.seller_id = ?
               ORDER BY t.created_at DESC""",
            (user["user_id"],),
        )

    rows = cursor.fetchall()
    conn.close()

    return [
        {
            "id": r["id"],
            "rfq_id": r["rfq_id"],
            "buyer_id": r["buyer_id"],
            "buyer_name": r["buyer_name"],
            "seller_id": r["seller_id"],
            "seller_name": r["seller_name"],
            "commodity_id": r["commodity_id"],
            "commodity_name": r["commodity_name"],
            "quantity": r["quantity"],
            "price_per_unit": r["price_per_unit"],
            "total_value": r["total_value"],
            "status": r["status"],
            "created_at": r["created_at"],
            "settled_at": r["settled_at"],
        }
        for r in rows
    ]


@router.get("/detail")
def trade_detail(token: str, trade_id: int):
    user = get_current_user(token)

    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute(
        """SELECT t.*, bu.username as buyer_name, su.username as seller_name,
                  c.name as commodity_name, c.unit_of_measure
           FROM trades t
           JOIN users bu ON t.buyer_id = bu.id
           JOIN users su ON t.seller_id = su.id
           JOIN commodities c ON t.commodity_id = c.id
           WHERE t.id = ?""",
        (trade_id,),
    )
    trade = cursor.fetchone()
    conn.close()

    if not trade:
        raise HTTPException(status_code=404, detail="Trade not found")

    return {
        "id": trade["id"],
        "rfq_id": trade["rfq_id"],
        "buyer_id": trade["buyer_id"],
        "buyer_name": trade["buyer_name"],
        "seller_id": trade["seller_id"],
        "seller_name": trade["seller_name"],
        "commodity_id": trade["commodity_id"],
        "commodity_name": trade["commodity_name"],
        "unit_of_measure": trade["unit_of_measure"],
        "quantity": trade["quantity"],
        "price_per_unit": trade["price_per_unit"],
        "total_value": trade["total_value"],
        "status": trade["status"],
        "created_at": trade["created_at"],
        "settled_at": trade["settled_at"],
    }