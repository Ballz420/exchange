in to a# CEMOS MVP + FASEM-P

**Commodity Exchange Market of Somalia** + **Formal and Standard Emerging Market - Profit Participation Units**

A dual-market platform combining commodity exchange (CEMOS) with innovative profit-participation capital markets (FASEM-P).

## Architecture

```
cemos-mvp/
├── backend/
│   ├── main.py            # FastAPI server entry point
│   ├── database.py        # SQLite database with all tables
│   ├── ledger.py          # Double-entry ledger engine
│   ├── risk.py            # Pre-trade risk checks
│   ├── settlement.py      # T+3 settlement system
│   ├── fasem.py           # FASEM-P core engine
│   ├── routers/
│   │   ├── auth.py        # Authentication (register/login)
│   │   ├── rfq.py         # RFQ system (create/respond/accept)
│   │   ├── trades.py      # Trade listing and detail
│   │   ├── ledger_api.py  # Balance queries and reconciliation
│   │   └── fasem.py       # FASEM-P API endpoints
│   └── test_fasem.py      # End-to-end tests
├── frontend/              # (placeholder)
├── Dockerfile             # Container build
├── render.yaml            # Render.com deployment config
├── requirements.txt       # Python dependencies
└── .gitignore
```

## Quick Start (Local)

```bash
cd backend
pip install -r ../requirements.txt
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

## API Documentation

Once running, visit: http://localhost:8000/docs

## Deploy to Render

1. Push this repo to GitHub
2. Go to https://render.com → New Web Service
3. Connect your GitHub repo
4. Render auto-detects `render.yaml` and deploys

## FASEM-P Key Concepts

- **PPUs**: Profit Participation Units — neither debt nor equity, proportional claims on distributable profits
- **Float Ratio**: Permanent percentage of profit distributed to PPU holders (set at registration)
- **Capital Recycling Doctrine**: Raised capital must enter the real economy (expansion, equipment, facilities, inventory, wages, logistics)

## CEMOS Settlement Flow

1. Trade agreed → Trade created (pending)
2. Buyer funds escrow → escrow_funded
3. Seller delivers → delivery_confirmed
4. Registry updated → settled (T+3)