import urllib.request, json

BASE = "http://localhost:8000"

def req(m, p, d=None):
    url = BASE + p
    body = json.dumps(d).encode() if d else None
    rq = urllib.request.Request(url, data=body, method=m, headers={"Content-Type": "application/json"})
    try:
        resp = urllib.request.urlopen(rq)
        return resp.status, json.loads(resp.read().decode())
    except urllib.request.HTTPError as e:
        return e.code, json.loads(e.read().decode())

print("=== TESTING 6 WISHLIST ENDPOINTS ===\n")

# Setup
req("POST", "/api/auth/register", {"username":"admin","password":"admin","role":"admin"})
s,d = req("POST", "/api/auth/login", {"username":"admin","password":"admin"})
tok = d["token"]

req("POST", "/api/auth/register", {"username":"tr1","password":"pass","role":"trader"})
req("POST", "/api/auth/register", {"username":"tr2","password":"pass","role":"trader"})
s,d = req("POST", "/api/auth/login", {"username":"tr1","password":"pass"})
u1t,u1i = d["token"],d["user_id"]
s,d = req("POST", "/api/auth/login", {"username":"tr2","password":"pass"})
u2t,u2i = d["token"],d["user_id"]

s,d = req("POST", "/api/admin/instruments", {"token":tok,"name":"WishlistPPU","description":"","total_float":10000})
iid = d["instrument_id"]; print(f"Setup: Instrument {iid}")
req("POST", "/api/admin/cash/credit", {"token":tok,"user_id":u1i,"amount":50000})
req("POST", "/api/admin/cash/credit", {"token":tok,"user_id":u2i,"amount":50000})
req("POST", "/api/admin/ppu/credit", {"token":tok,"user_id":u2i,"instrument_id":iid,"units":5000})

# 1. Market Order
print("\n[1] MARKET ORDER")
req("POST", "/api/orders/place", {"token":u2t,"instrument_id":iid,"side":"sell","price":10,"quantity":500})
req("POST", "/api/orders/place", {"token":u2t,"instrument_id":iid,"side":"sell","price":11,"quantity":300})
s,d = req("POST", "/api/orders/market", {"token":u1t,"instrument_id":iid,"side":"buy","quantity":600})
print(f"  filled={d['filled_quantity']} @ ${d['price']} avg, {d['matches']} matches")
assert d["filled_quantity"] == 600; print("  PASS")

# 2. P&L
print("\n[2] P&L ENDPOINT")
s,d = req("GET", f"/api/accounts/{u1i}/pnl?token={u1t}")
print(f"  total_pnl=${d['total_pnl']}, {len(d['positions'])} positions")
assert "total_pnl" in d; print("  PASS")

# 3. Market Summary
print("\n[3] MARKET SUMMARY")
s,d = req("GET", f"/api/instruments/{iid}/summary?token={u1t}")
print(f"  last=${d['last_trade_price']}, vol={d['daily_volume']}")
assert d["last_trade_price"] is not None; print("  PASS")

# 4. Admin Users
print("\n[4] ADMIN USERS")
s,d = req("GET", f"/api/admin/users?token={tok}")
print(f"  {len(d)} users found (incl system)")
assert len(d) >= 3; print("  PASS")

# 5. Admin Orders
print("\n[5] ADMIN ORDERS")
s,d = req("GET", f"/api/admin/orders?token={tok}")
print(f"  {len(d)} orders found (2 resting sell orders)")
assert len(d) >= 2; print("  PASS")

# 6. Admin Holdings
print("\n[6] ADMIN HOLDINGS")
s,d = req("GET", f"/api/admin/holdings?token={tok}")
print(f"  {len(d)} holdings found")
assert len(d) >= 1; print("  PASS")

print("\n=== ALL 6 ENDPOINTS PASSED ===")