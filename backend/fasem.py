"""
FASEM-P: Profit Participation Unit Market — Core Engine

PPUs are neither debt nor equity. They represent proportional claims
on distributable profits. No interest, no maturity, no governance rights,
no equity dilution.

Key concepts:
  - Float Ratio: Permanent share of profits distributed to PPU holders
  - Capital Recycling Doctrine: Raised capital must enter the real economy
  - Profit Distribution: Each holder receives (their_units / total_units) * distributable_profit
"""
from database import get_connection

PERMITTED_CATEGORIES = {"expansion", "equipment", "facilities", "inventory", "wages", "logistics"}
PROHIBITED_PATTERNS = ["repurchase", "buyback", "market making", "circular", "self-deal", "artificial demand"]


# ==================== COMPANIES ====================

def register_company(name, description, sector, founder_user_id, float_ratio, ppu_face_value=1.0):
    """Register a new company on FASEM-P."""
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT id FROM fasem_companies WHERE name = ?", (name,))
    if cursor.fetchone():
        conn.close()
        raise ValueError("Company name already registered")

    cursor.execute(
        """INSERT INTO fasem_companies (name, description, sector, founder_user_id, float_ratio, ppu_face_value)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (name, description, sector, founder_user_id, float_ratio, ppu_face_value),
    )
    company_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return company_id


def list_companies():
    """List all FASEM-P companies."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM fasem_companies ORDER BY created_at DESC")
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_company(company_id):
    """Get a single company."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM fasem_companies WHERE id = ?", (company_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None


# ==================== PPU ISSUANCE & TRADING ====================

def issue_ppus(company_id, owner_id, units, price_per_unit):
    """Issue new PPUs to an investor. Company raises capital."""
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT id, status, total_ppus_issued, total_capital_raised FROM fasem_companies WHERE id = ?", (company_id,))
    company = cursor.fetchone()
    if not company:
        conn.close()
        raise ValueError("Company not found")
    if company["status"] != "active":
        conn.close()
        raise ValueError(f"Company is {company['status']}")

    total_cost = round(units * price_per_unit, 2)

    cursor.execute(
        "INSERT INTO fasem_ppus (company_id, owner_id, units, purchase_price, total_cost) VALUES (?, ?, ?, ?, ?)",
        (company_id, owner_id, units, price_per_unit, total_cost),
    )
    ppu_id = cursor.lastrowid

    cursor.execute(
        "UPDATE fasem_companies SET total_ppus_issued = total_ppus_issued + ?, total_capital_raised = total_capital_raised + ? WHERE id = ?",
        (units, total_cost, company_id),
    )

    conn.commit()
    conn.close()
    return ppu_id


def trade_ppus(ppu_id, buyer_id, seller_id, units, price_per_unit):
    """Secondary-market trade of PPUs between investors."""
    conn = get_connection()
    cursor = conn.cursor()

    # Get seller's PPU
    cursor.execute(
        "SELECT id, company_id, owner_id, units FROM fasem_ppus WHERE id = ? AND owner_id = ? AND status = 'active'",
        (ppu_id, seller_id),
    )
    seller_ppu = cursor.fetchone()
    if not seller_ppu:
        conn.close()
        raise ValueError("Seller does not own this PPU holding")
    if seller_ppu["units"] < units:
        conn.close()
        raise ValueError(f"Insufficient PPU units: seller has {seller_ppu['units']}, requested {units}")

    trade_value = round(units * price_per_unit, 2)

    # Reduce seller's holding
    new_units = round(seller_ppu["units"] - units, 2)
    if new_units <= 0:
        cursor.execute("UPDATE fasem_ppus SET units = 0, status = 'transferred' WHERE id = ?", (ppu_id,))
    else:
        cursor.execute("UPDATE fasem_ppus SET units = ? WHERE id = ?", (new_units, ppu_id))

    # Create or update buyer's PPU for this company
    cursor.execute(
        "SELECT id, units, total_cost FROM fasem_ppus WHERE company_id = ? AND owner_id = ? AND status = 'active'",
        (seller_ppu["company_id"], buyer_id),
    )
    buyer_ppu = cursor.fetchone()

    if buyer_ppu:
        new_total_units = round(buyer_ppu["units"] + units, 2)
        new_total_cost = round(buyer_ppu["total_cost"] + trade_value, 2)
        new_avg_price = round(new_total_cost / new_total_units, 4) if new_total_units > 0 else 0
        cursor.execute(
            "UPDATE fasem_ppus SET units = ?, total_cost = ?, purchase_price = ? WHERE id = ?",
            (new_total_units, new_total_cost, new_avg_price, buyer_ppu["id"]),
        )
    else:
        cursor.execute(
            "INSERT INTO fasem_ppus (company_id, owner_id, units, purchase_price, total_cost) VALUES (?, ?, ?, ?, ?)",
            (seller_ppu["company_id"], buyer_id, units, price_per_unit, trade_value),
        )

    conn.commit()
    conn.close()
    return {"units_traded": units, "trade_value": trade_value}


def get_company_ppus(company_id):
    """List all active PPU holdings for a company."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT * FROM fasem_ppus WHERE company_id = ? AND status = 'active' ORDER BY created_at DESC",
        (company_id,),
    )
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_owner_ppus(owner_id):
    """List all PPU holdings for an owner."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT * FROM fasem_ppus WHERE owner_id = ? ORDER BY created_at DESC",
        (owner_id,),
    )
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ==================== PROFIT ENGINE ====================

def declare_profit(company_id, period_label, total_profit):
    """Declare profit for a period. Split per the permanent float ratio."""
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT id, float_ratio, total_ppus_issued, status FROM fasem_companies WHERE id = ?", (company_id,))
    company = cursor.fetchone()
    if not company:
        conn.close()
        raise ValueError("Company not found")
    if company["status"] != "active":
        conn.close()
        raise ValueError(f"Company is {company['status']}")

    # Check for duplicate period
    cursor.execute(
        "SELECT id FROM fasem_profit_declarations WHERE company_id = ? AND period_label = ?",
        (company_id, period_label),
    )
    if cursor.fetchone():
        conn.close()
        raise ValueError(f"Profit already declared for period '{period_label}'")

    distributable = round(total_profit * company["float_ratio"], 2)
    retained = round(total_profit - distributable, 2)
    total_ppus = company["total_ppus_issued"] or 1
    profit_per_ppu = round(distributable / total_ppus, 4)

    cursor.execute(
        """INSERT INTO fasem_profit_declarations
           (company_id, period_label, total_profit, retained_profit, distributable_profit,
            total_ppus_at_declaration, profit_per_ppu)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (company_id, period_label, total_profit, retained, distributable, total_ppus, profit_per_ppu),
    )
    decl_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return decl_id


def distribute_profit(declaration_id):
    """Distribute declared profit to all active PPU holders."""
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM fasem_profit_declarations WHERE id = ?", (declaration_id,))
    decl = cursor.fetchone()
    if not decl:
        conn.close()
        raise ValueError("Declaration not found")
    if decl["status"] == "distributed":
        conn.close()
        raise ValueError("Profit already distributed")

    # Get all active PPUs
    cursor.execute(
        "SELECT p.id, p.owner_id, p.units FROM fasem_ppus p WHERE p.company_id = ? AND p.status = 'active' AND p.units > 0",
        (decl["company_id"],),
    )
    ppus = cursor.fetchall()

    distributions = []
    for ppu in ppus:
        amount = round(ppu["units"] * decl["profit_per_ppu"], 2)
        if amount <= 0:
            continue
        cursor.execute(
            "INSERT INTO fasem_profit_distributions (declaration_id, owner_id, ppu_id, units_held, amount_paid) VALUES (?, ?, ?, ?, ?)",
            (declaration_id, ppu["owner_id"], ppu["id"], ppu["units"], amount),
        )
        distributions.append({"owner_id": ppu["owner_id"], "amount_paid": amount})

    cursor.execute(
        "UPDATE fasem_profit_declarations SET status = 'distributed', distributed_at = datetime('now') WHERE id = ?",
        (declaration_id,),
    )

    conn.commit()
    conn.close()
    return distributions


def get_profit_history(company_id):
    """List all profit declarations for a company."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT * FROM fasem_profit_declarations WHERE company_id = ? ORDER BY declared_at DESC",
        (company_id,),
    )
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_profit_distributions(declaration_id):
    """List all distributions for a declaration."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT * FROM fasem_profit_distributions WHERE declaration_id = ? ORDER BY amount_paid DESC",
        (declaration_id,),
    )
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ==================== CAPITAL COMPLIANCE ====================

def deploy_capital(company_id, amount, category, description="", receipt_reference=""):
    """Record a capital deployment with compliance checking."""
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT id, total_capital_raised FROM fasem_companies WHERE id = ?", (company_id,))
    if not cursor.fetchone():
        conn.close()
        raise ValueError("Company not found")

    # Check compliance
    is_permitted = 1
    if category not in PERMITTED_CATEGORIES:
        is_permitted = 0
    else:
        desc_lower = description.lower()
        for pattern in PROHIBITED_PATTERNS:
            if pattern in desc_lower:
                is_permitted = 0
                break

    cursor.execute(
        "INSERT INTO fasem_capital_deployments (company_id, amount, category, description, receipt_reference, is_permitted) VALUES (?, ?, ?, ?, ?, ?)",
        (company_id, amount, category, description, receipt_reference, is_permitted),
    )
    dep_id = cursor.lastrowid

    if not is_permitted:
        cursor.execute("UPDATE fasem_companies SET capital_compliant = 0 WHERE id = ?", (company_id,))

    conn.commit()
    conn.close()
    return dep_id


def get_compliance_report(company_id):
    """Get compliance status for a company."""
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM fasem_companies WHERE id = ?", (company_id,))
    company = cursor.fetchone()
    if not company:
        conn.close()
        raise ValueError("Company not found")

    cursor.execute(
        "SELECT * FROM fasem_capital_deployments WHERE company_id = ? ORDER BY deployed_at DESC",
        (company_id,),
    )
    deployments = [dict(r) for r in cursor.fetchall()]

    total_deployed = sum(d["amount"] for d in deployments if d["is_permitted"])
    violations = [d for d in deployments if not d["is_permitted"]]

    conn.close()
    return {
        "company_id": company_id,
        "company_name": company["name"],
        "capital_compliant": bool(company["capital_compliant"]),
        "total_capital_raised": company["total_capital_raised"],
        "total_deployed_compliant": round(total_deployed, 2),
        "remaining_to_deploy": round(company["total_capital_raised"] - total_deployed, 2),
        "violation_count": len(violations),
        "violations": [{"id": v["id"], "amount": v["amount"], "category": v["category"], "description": v["description"]} for v in violations],
        "status": "COMPLIANT" if company["capital_compliant"] else "NON-COMPLIANT",
    }


def get_company_deployments(company_id):
    """List all capital deployments for a company."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT * FROM fasem_capital_deployments WHERE company_id = ? ORDER BY deployed_at DESC",
        (company_id,),
    )
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]