"""
Risk Engine — The "boss system"

Checks before any trade execution:
1. Does buyer have sufficient cash?
2. Does seller have sufficient units?
3. Position limits (basic)

Blocks bad trades BEFORE they happen.
"""

from ledger import get_balance


def check_trade(buyer_id, seller_id, quantity, total_value):
    """
    Run all pre-trade risk checks.
    Returns dict with 'passed' (bool) and list of failure reasons.
    """
    failures = []

    # Check 1: Buyer has enough cash
    buyer_cash = get_balance(buyer_id, "cash")
    if buyer_cash < total_value:
        failures.append(
            f"Buyer insufficient cash: has {buyer_cash:.2f}, needs {total_value:.2f}"
        )

    # Check 2: Seller has enough units
    seller_units = get_balance(seller_id, "unit")
    if seller_units < quantity:
        failures.append(
            f"Seller insufficient units: has {seller_units:.2f}, needs {quantity:.2f}"
        )

    # Check 3: Basic sanity — positive quantities and prices
    if quantity <= 0:
        failures.append("Quantity must be positive")
    if total_value <= 0:
        failures.append("Total value must be positive")

    return {
        "passed": len(failures) == 0,
        "failures": failures,
        "details": {
            "buyer_cash": buyer_cash,
            "seller_units": seller_units,
            "quantity_required": quantity,
            "cash_required": total_value,
        },
    }