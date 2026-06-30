# FASEM-P Exchange API v2.0

**Profit Participation Unit Exchange** — Backend API for Brokers, Integrators, and Frontends

Base URL: `http://localhost:8000` (local) or `https://fasem-exchange.onrender.com` (production)

---

## TABLE OF CONTENTS

1. [SYSTEM](#1-system)
2. [AUTH](#2-auth)
3. [DATABASE VIEWER](#3-database-viewer)
4. [ADMIN](#4-admin)
5. [MARKET DATA](#5-market-data)
6. [ORDER PLACEMENT](#6-order-placement)
7. [ORDER CANCEL](#7-order-cancel)
8. [USER ORDERS](#8-user-orders)
9. [TRADE HISTORY](#9-trade-history)
10. [ACCOUNTING](#10-accounting)
11. [PROFIT DISTRIBUTION](#11-profit-distribution)
12. [FULL LIFECYCLE DEMO](#12-full-lifecycle-demo)

---

## 1. SYSTEM

### GET /api/health
**Response:**
```json
{"status": "ok", "version": "2.0.0", "db": "/path/to/cemos.db"}
```

---

## 2. AUTH

### POST /api/auth/register
Create a new user (trader or admin).

**Body:**
```json
{
  "username": "broker1",
  "password": "securepass",
  "role": "trader"    // "trader" or "admin"
}
```
**Response:** `201`
```json
{"id": 1, "username": "broker1", "role": "trader"}
```

### POST /api/auth/login
Get an API token. All subsequent requests use this token.

**Body:**
```json
{
  "username": "broker1",
  "password": "securepass"
}
```
**Response:** `200`
```json
{
  "token": "a1b2c3d4e5f6...",
  "user_id": 1,
  "username": "broker1",
  "role": "trader"
}
```

---

## 3. DATABASE VIEWER

All database tables are visible and queryable through the API.

### GET /api/db/schema
Returns full SQL DDL for all 8 tables.
> Use this to understand the complete database structure.

### GET /api/db/tables
Lists all tables with row counts.

**Response:**
```json
[
  {"name": "users",              "rows": 5},
  {"name": "instruments",        "rows": 2},
  {"name": "ledger_entries",     "rows": 24},
  {"name": "orders",             "rows": 8},
  {"name": "ppu_holdings",       "rows": 4},
  {"name": "profit_declarations","rows": 1},
  {"name": "profit_distributions","rows": 2},
  {"name": "trades",             "rows": 3}
]
```

### GET /api/db/table/{table_name}?human=1&limit=100
View table contents. Add `?human=1` to see user/instrument names instead of IDs.

**Example:** `/api/db/table/ledger_entries?human=1`
```json
[
  {
    "id": 1,
    "ledger_type": "cash",
    "user_id": 2,
    "user_id_name": "buyer",
    "trade_id": 1,
    "instrument_id": 1,
    "instrument_id_name": "SomaliAgri PPU",
    "debit": 7500.00,
    "credit": 0.00,
    "description": "Trade #1: 500 PPUs @ $15.00",
    "created_at": "2026-06-20 16:30:00"
  }
]
```

---

## 4. ADMIN

All admin endpoints require a token with role="admin".

### POST /api/admin/instruments
**IPO:** List a new PPU instrument on the exchange.

**Body:**
```json
{
  "token": "ADMIN_TOKEN",
  "name": "SomaliAgri PPU",
  "description": "Agricultural profit participation fund",
  "total_float": 10000
}
```
**Response:** `200`
```json
{"instrument_id": 1, "name": "SomaliAgri PPU", "total_float": 10000, "message": "PPU instrument listed (IPO)"}
```

### PUT /api/admin/instruments/{id}?status=delisted&token=ADMIN_TOKEN
Update instrument status (active/delisted).

### POST /api/admin/cash/credit
Credit cash to a user (from system account).

**Body:**
```json
{"token": "ADMIN_TOKEN", "user_id": 2, "amount": 50000}
```
**Response:**
```json
{"message": "Credited $50000 to user 2", "new_balance": 50000.0}
```

### POST /api/admin/ppu/credit
Credit PPU holdings to a user.

**Body:**
```json
{"token": "ADMIN_TOKEN", "user_id": 3, "instrument_id": 1, "units": 5000}
```
**Response:**
```json
{"message": "Credited 5000 PPUs to user 3", "new_balance": 5000.0}
```

> **Note:** The system account (user_id=0) acts as the exchange. Cash and PPUs are credited from this account. Total float is always conserved.

---

## 5. MARKET DATA

### GET /api/instruments?token=TOKEN&status=active
List all PPU instruments.

### GET /api/orderbook/{instrument_id}?token=TOKEN
View the current bid/ask ladder.

**Response:**
```json
{
  "instrument_id": 1,
  "bids": [
    {"id": 3, "user_id": 2, "price": 15.00, "quantity": 500, "filled_quantity": 500, "remaining": 0},
    {"id": 4, "user_id": 2, "price": 14.50, "quantity": 200, "filled_quantity": 0, "remaining": 200}
  ],
  "asks": [
    {"id": 2, "user_id": 3, "price": 15.00, "quantity": 1000, "filled_quantity": 500, "remaining": 500}
  ],
  "best_bid": 15.00,
  "best_ask": 15.00,
  "spread": 0.00,
  "mid_price": 15.00
}
```

---

## 6. ORDER PLACEMENT

### POST /api/orders/place
Place a limit order (buy or sell). Orders are automatically matched.

**Body:**
```json
{
  "token": "USER_TOKEN",
  "instrument_id": 1,
  "side": "buy",
  "price": 15.00,
  "quantity": 500
}
```
**Response:**
```json
{
  "order_id": 3,
  "side": "buy",
  "price": 15.0,
  "quantity": 500.0,
  "matches": 1
}
```

> `matches` = number of trades executed immediately. If a matching order exists at the same or better price, they execute automatically (price-time priority).

---

## 7. ORDER CANCEL

### POST /api/orders/cancel/{order_id}?token=TOKEN
Cancel an open or partially-filled order.

---

## 8. USER ORDERS

### GET /api/orders/user/{user_id}?token=TOKEN
List all orders for a user.

---

## 9. TRADE HISTORY

### GET /api/trades?token=TOKEN&instrument_id=1&user_id=2&limit=50
List trades with optional filters.

**Response:**
```json
[
  {
    "id": 1,
    "buy_order_id": 3,
    "sell_order_id": 2,
    "instrument_id": 1,
    "buyer_id": 2,
    "seller_id": 3,
    "buyer_name": "buyer",
    "seller_name": "seller",
    "instrument_name": "SomaliAgri PPU",
    "quantity": 500.0,
    "price": 15.0,
    "total_value": 7500.0,
    "created_at": "2026-06-20 16:30:00"
  }
]
```

---

## 10. ACCOUNTING

### GET /api/accounts/{user_id}?token=TOKEN
Get user's cash balance and PPU holdings.

**Response:**
```json
{
  "user_id": 2,
  "cash_balance": 42500.0,
  "ppu_holdings": [
    {"holding_id": 1, "name": "SomaliAgri PPU", "units": 500.0}
  ]
}
```

### GET /api/ledger/{user_id}?token=TOKEN
Full double-entry statement for a user.

### GET /api/reconcile?token=TOKEN
Ledger integrity check:
```json
{
  "cash_net_zero": true,
  "cash_total": 0.0,
  "ppu_matches_float": true,
  "ppu_total": 10000.0,
  "instrument_float": 10000.0,
  "all_balanced": true
}
```
> **If all_balanced = true:** Every dollar is accounted for, every PPU is tracked. The system is in perfect equilibrium.

---

## 11. PROFIT DISTRIBUTION

### POST /api/profit/declare
Declare profit for a PPU instrument.

**Body:**
```json
{
  "token": "ADMIN_TOKEN",
  "instrument_id": 1,
  "period_label": "Q1-2026",
  "total_profit": 50000
}
```
**Response:**
```json
{"declaration_id": 1, "profit_per_ppu": 5.0, "total_ppus": 10000.0}
```
> **profit_per_ppu = total_profit / total_float** — Paid to every PPU holder proportionally.

### POST /api/profit/distribute/{declaration_id}?token=TOKEN
Distribute the declared profit to all PPU holders. Cash is automatically credited.

**Response:**
```json
{"message": "Distributed to 2 holders", "profit_per_ppu": 5.0}
```

### GET /api/profit/history/{instrument_id}?token=TOKEN
View profit declaration history for an instrument.

---

## 12. FULL LIFECYCLE DEMO

Copy/paste this entire script to see the exchange in action:

```bash
# 0. Set base URL
BASE="http://localhost:8000"

# 1. Register admin
curl -s -X POST "$BASE/api/auth/register" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin","role":"admin"}'

ADMIN_TOKEN=$(curl -s -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}' | python -c "import sys,json;print(json.load(sys.stdin)['token'])")

echo "Admin token: ${ADMIN_TOKEN:0:12}..."

# 2. Register two traders
curl -s -X POST "$BASE/api/auth/register" \
  -H "Content-Type: application/json" \
  -d '{"username":"trader1","password":"pass","role":"trader"}'


