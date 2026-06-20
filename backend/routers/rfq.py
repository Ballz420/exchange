from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from database import get_connection
from routers.auth import get_current_user

router = APIRouter(prefix="/api/rfq", tags=["rfq"])


class RfqCreate(BaseModel):
    token: str
    commodity_id: int
    quantity: float


class RfqRespond(BaseModel):
    token: str
    rfq_id: int
    price_per_unit: float
    quantity_available: float


class RfqAccept(BaseModel):
    token: str
    rfq_id: int
    response_id: int


@router.post("/create")
def create_rfq(req: RfqCreate):
    user = get_current_user(req.token)
    if user["role"] != "buyer":
        raise HTTPException(status_code=403, detail="Only buyers can create RFQs")

    conn = get_connection()
    cursor = conn.cursor()

    # Verify commodity exists
    cursor.execute("SELECT id FROM commodities WHERE id = ?", (req.commodity_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Commodity not found")

    cursor.execute(
        "INSERT INTO rfqs (buyer_id, commodity_id, quantity) VALUES (?, ?, ?)",
        (user["user_id"], req.commodity_id, req.quantity),
    )
    rfq_id = cursor.lastrowid
    conn.commit()
    conn.close()

    return {"rfq_id": rfq_id, "status": "open", "message": "RFQ created"}


@router.get("/list")
def list_rfqs(token: str):
    user = get_current_user(token)

    conn = get_connection()
    cursor = conn.cursor()

    if user["role"] == "buyer":
        # Buyers see their own RFQs
        cursor.execute(
            """SELECT r.id, r.buyer_id, u.username as buyer_name, r.commodity_id,
                      c.name as commodity_name, c.unit_of_measure,
                      r.quantity, r.status, r.created_at
               FROM rfqs r
               JOIN users u ON r.buyer_id = u.id
               JOIN commodities c ON r.commodity_id = c.id
               WHERE r.buyer_id = ?
               ORDER BY r.created_at DESC""",
            (user["user_id"],),
        )
    elif user["role"] == "seller":
        # Sellers see all open RFQs (or ones they've responded to)
        cursor.execute(
            """SELECT r.id, r.buyer_id, u.username as buyer_name, r.commodity_id,
                      c.name as commodity_name, c.unit_of_measure,
                      r.quantity, r.status, r.created_at
               FROM rfqs r
               JOIN users u ON r.buyer_id = u.id
               JOIN commodities c ON r.commodity_id = c.id
               WHERE r.status IN ('open', 'responded')
               ORDER BY r.created_at DESC""",
        )
    else:
        # Admins see all RFQs
        cursor.execute(
            """SELECT r.id, r.buyer_id, u.username as buyer_name, r.commodity_id,
                      c.name as commodity_name, c.unit_of_measure,
                      r.quantity, r.status, r.created_at
               FROM rfqs r
               JOIN users u ON r.buyer_id = u.id
               JOIN commodities c ON r.commodity_id = c.id
               ORDER BY r.created_at DESC""",
        )

    rows = cursor.fetchall()
    conn.close()

    return [
        {
            "id": r["id"],
            "buyer_id": r["buyer_id"],
            "buyer_name": r["buyer_name"],
            "commodity_id": r["commodity_id"],
            "commodity_name": r["commodity_name"],
            "unit_of_measure": r["unit_of_measure"],
            "quantity": r["quantity"],
            "status": r["status"],
            "created_at": r["created_at"],
        }
        for r in rows
    ]


@router.get("/responses")
def list_responses(token: str, rfq_id: int):
    user = get_current_user(token)

    conn = get_connection()
    cursor = conn.cursor()

    # Verify RFQ exists and user has access
    cursor.execute(
        "SELECT id, buyer_id, status FROM rfqs WHERE id = ?",
        (rfq_id,),
    )
    rfq = cursor.fetchone()
    if not rfq:
        conn.close()
        raise HTTPException(status_code=404, detail="RFQ not found")

    # Only buyer, responding sellers, and admins can see responses
    if user["role"] not in ("admin",) and user["user_id"] != rfq["buyer_id"]:
        # Seller can see their own responses
        cursor.execute(
            """SELECT r.id, r.rfq_id, r.seller_id, u.username as seller_name,
                      r.price_per_unit, r.quantity_available, r.created_at
               FROM rfq_responses r
               JOIN users u ON r.seller_id = u.id
               WHERE r.rfq_id = ? AND r.seller_id = ?""",
            (rfq_id, user["user_id"]),
        )
    else:
        cursor.execute(
            """SELECT r.id, r.rfq_id, r.seller_id, u.username as seller_name,
                      r.price_per_unit, r.quantity_available, r.created_at
               FROM rfq_responses r
               JOIN users u ON r.seller_id = u.id
               WHERE r.rfq_id = ?
               ORDER BY r.price_per_unit ASC""",
            (rfq_id,),
        )

    rows = cursor.fetchall()
    conn.close()

    return [
        {
            "id": r["id"],
            "rfq_id": r["rfq_id"],
            "seller_id": r["seller_id"],
            "seller_name": r["seller_name"],
            "price_per_unit": r["price_per_unit"],
            "quantity_available": r["quantity_available"],
            "created_at": r["created_at"],
        }
        for r in rows
    ]


@router.post("/respond")
def respond_to_rfq(req: RfqRespond):
    user = get_current_user(req.token)
    if user["role"] not in ("seller", "admin"):
        raise HTTPException(status_code=403, detail="Only sellers can respond to RFQs")

    conn = get_connection()
    cursor = conn.cursor()

    # Verify RFQ exists and is open
    cursor.execute(
        "SELECT id, status FROM rfqs WHERE id = ?",
        (req.rfq_id,),
    )
    rfq = cursor.fetchone()
    if not rfq:
        conn.close()
        raise HTTPException(status_code=404, detail="RFQ not found")
    if rfq["status"] not in ("open", "responded"):
        conn.close()
        raise HTTPException(status_code=400, detail="RFQ is not open for responses")

    # Insert response
    cursor.execute(
        "INSERT INTO rfq_responses (rfq_id, seller_id, price_per_unit, quantity_available) VALUES (?, ?, ?, ?)",
        (req.rfq_id, user["user_id"], req.price_per_unit, req.quantity_available),
    )

    # Update RFQ status to 'responded'
    cursor.execute("UPDATE rfqs SET status = 'responded' WHERE id = ? AND status = 'open'", (req.rfq_id,))

    response_id = cursor.lastrowid
    conn.commit()
    conn.close()

    return {"response_id": response_id, "message": "Quote submitted"}


@router.post("/accept")
def accept_quote(req: RfqAccept):
    user = get_current_user(req.token)
    if user["role"] != "buyer":
        raise HTTPException(status_code=403, detail="Only buyers can accept quotes")

    conn = get_connection()
    cursor = conn.cursor()

    # Get the response
    cursor.execute(
        """SELECT r.id, r.rfq_id, r.seller_id, r.price_per_unit, r.quantity_available,
                  rfq.buyer_id, rfq.quantity, rfq.commodity_id, rfq.status as rfq_status
           FROM rfq_responses r
           JOIN rfqs rfq ON r.rfq_id = rfq.id
           WHERE r.id = ?""",
        (req.response_id,),
    )
    response = cursor.fetchone()
    if not response:
        conn.close()
        raise HTTPException(status_code=404, detail="Response not found")

    if response["buyer_id"] != user["user_id"]:
        conn.close()
        raise HTTPException(status_code=403, detail="This RFQ does not belong to you")

    if response["rfq_status"] != "responded":
        conn.close()
        raise HTTPException(status_code=400, detail="RFQ is not in responded status")

    # Create trade
    quantity = min(response["quantity"], response["quantity_available"])
    total_value = round(quantity * response["price_per_unit"], 2)

    cursor.execute(
        """INSERT INTO trades (rfq_id, buyer_id, seller_id, commodity_id, quantity, price_per_unit, total_value)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (
            response["rfq_id"],
            response["buyer_id"],
            response["seller_id"],
            response["commodity_id"],
            quantity,
            response["price_per_unit"],
            total_value,
        ),
    )
    trade_id = cursor.lastrowid

    # Mark RFQ as accepted
    cursor.execute("UPDATE rfqs SET status = 'accepted' WHERE id = ?", (response["rfq_id"],))

    # Log settlement event
    cursor.execute(
        "INSERT INTO settlement_events (trade_id, event_type, description, created_by) VALUES (?, ?, ?, ?)",
        (trade_id, "trade_created", "Trade agreed and contract signed", user["user_id"]),
    )

    conn.commit()
    conn.close()

    return {
        "trade_id": trade_id,
        "status": "pending",
        "quantity": quantity,
        "price_per_unit": response["price_per_unit"],
        "total_value": total_value,
        "message": "Trade created successfully",
    }