"""
FASEM-P End-to-End Test for CEMOS MVP
"""
import urllib.request, json

BASE = "http://localhost:8000"

def req(method, path, data=None):
    url = BASE + path
    body = json.dumps(data).encode() if data else None
    r = urllib.request.Request(url, data=body, method=method,
        headers={"Content-Type": "application/json"})
    try:
        resp = urllib.request.urlopen(r)
        return resp.status, json.loads(resp.read().decode())
    except urllib.request.HTTPError as e:
        return e.code, json.loads(e.read().decode())

def test():
    print("=" * 50)
    print("FASEM-P End-to-End Test")
    print("=" * 50)

    s, d = req("GET", "/api/health")
    print(f"Health: {s}")
    assert s == 200

    s, d = req("POST", "/api/auth/register", {"username":"fasem_test","password":"pass","role":"buyer"})
    print(f"Register: {s} id={d.get('id')}")
    assert s == 200

    s, d = req("POST", "/api/auth/login", {"username":"fasem_test","password":"pass"})
    token = d["token"]
    print(f"Login: OK")

    s, d = req("POST", "/api/fasem/companies/register", {
        "token": token, "name": "FASEM Co", "sector": "energy",
        "float_ratio": 0.4, "ppu_face_value": 1.0
    })
    print(f"Company: {s} cid={d.get('company_id')}")
    assert s == 200

    s, d = req("GET", f"/api/fasem/companies?token={token}")
    print(f"Companies: {s} count={len(d)}")
    assert s == 200 and len(d) >= 1

    s, d = req("POST", "/api/fasem/ppus/issue", {
        "token": token, "company_id": 1, "owner_id": 1,
        "units": 1000, "price_per_unit": 1.50
    })
    print(f"PPU Issue: {s} ppu_id={d.get('ppu_id')}")
    assert s == 200

    s, d = req("POST", "/api/fasem/profit/declare", {
        "token": token, "company_id": 1,
        "period_label": "Q1-2026", "total_profit": 50000
    })
    print(f"Profit Declare: {s} decl_id={d.get('declaration_id')}")
    assert s == 200

    s, d = req("POST", f"/api/fasem/profit/distribute/1?token={token}")
    print(f"Profit Distribute: {s} count={d.get('count')}")
    assert s == 200 and d.get("count", 0) >= 1

    s, d = req("POST", "/api/fasem/capital/deploy", {
        "token": token, "company_id": 1, "amount": 500,
        "category": "equipment", "description": "Buy equipment"
    })
    print(f"Capital Deploy: {s} dep_id={d.get('deployment_id')}")
    assert s == 200

    s, d = req("GET", f"/api/fasem/capital/compliance/1?token={token}")
    print(f"Compliance: {s} status={d.get('status')}")
    assert s == 200

    s, d = req("GET", f"/api/fasem/ppus/owner/1?token={token}")
    print(f"Owner PPUs: {s} count={len(d)}")
    assert s == 200

    print("\n" + "=" * 50)
    print("ALL 10 TESTS PASSED")
    print("=" * 50)

if __name__ == "__main__":
    test()