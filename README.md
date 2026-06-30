# FASEM-P Exchange

**Profit Participation Unit Exchange** — A capital formation system where SMEs raise growth capital by issuing tradable claims on future profits, without taking on debt or issuing equity.

## Architecture

```
C:\APP\
├── cemos-mvp\backend\        ← FastAPI Python server (1276+ lines)
│   ├── main.py               ← API routes, auth, order matching, admin
│   ├── database.py           ← SQLite schema (8 tables + migrations)
│   ├── ledger.py             ← Double-entry accounting engine
│   ├── pnl.py                ← P&L calculation (FIFO cost basis)
│   ├── backup_db.py          ← Auto-backup script
│   └── cemos.db              ← SQLite database
├── Basic-broker\             ← Trader-facing broker SPA
│   ├── index.html + app.js + style.css
├── admin app\                ← Admin-facing management SPA
│   ├── index.html + admin.js + admin.css
├── docker-compose.yml        ← Production deployment
└── README.md
```

## Quick Start

```bash
cd C:\APP\cemos-mvp\backend
pip install -r requirements.txt uvicorn fastapi pydantic bcrypt
python main.py
```

Open: http://localhost:8000/broker (trader) or http://localhost:8000/admin-panel (admin)

Register an admin:
```bash
curl -X POST http://localhost:8000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"securepass","role":"admin"}'
```

## Core Concepts

### Profit Participation Units (PPUs)
- **Not debt** — no interest, no maturity, no repayment
- **Not equity** — no voting rights, no board seats, no ownership
- PPUs are tradable claims on future distributable profits

### The Math
```
D = f × Π / N

D = Distribution per PPU
f = Float ratio (e.g. 25%)
Π = Distributable profit (revenue − expenses − tax)
N = Outstanding PPUs
```

See **PPU Math** tab in the admin panel for an interactive calculator with dilution simulator, growth scenarios, and valuation model.

### Capital Recycling Doctrine
Money raised from PPU sales must enter productive activity:
- ✅ Equipment, facilities, inventory, expansion, operations
- ❌ Circular market activity, manipulation, self-dealing

## API Endpoints

| Group | Endpoints |
|-------|-----------|
| **System** | `GET /api/health` |
| **Auth** | `POST /api/auth/register`, `POST /api/auth/login` |
| **Market** | `GET /api/instruments`, `GET /api/orderbook/{id}`, `GET /api/instruments/{id}/summary` |
| **Trading** | `POST /api/orders/place`, `POST /api/orders/market`, `POST /api/orders/cancel/{id}` |
| **Accounting** | `GET /api/accounts/{id}`, `GET /api/accounts/{id}/pnl`, `GET /api/ledger/{id}`, `GET /api/reconcile` |
| **Admin — Companies** | `GET/POST /api/admin/companies`, status/kyc updates |
| **Admin — Instruments** | `POST /api/admin/instruments`, lifecycle, attest-capital |
| **Admin — Users** | List, search, credit cash/PPU, suspend, change role |
| **Admin — System** | Dashboard stats, orders, holdings, transactions, capital-report |
| **Profit** | `POST /api/profit/declare`, `POST /api/profit/distribute/{id}`, history |
| **PPU Math** | `POST /api/ppu/calculate` — full step-by-step math breakdown |
| **Database** | `GET /api/db/tables`, `GET /api/db/table/{name}`, schema |

Auth: Send `Authorization: Bearer <token>` header (or `?token=<token>` for backward compat).

## Security

| Measure | Status |
|---------|--------|
| Password hashing | bcrypt (salted, 4 hashes/sec) |
| Session tokens | DB-stored, 24h expiry, auto-extend on use |
| Rate limiting | Login: 10/min/IP, API: 100/min/IP |
| Order validation | Max 10% of float, min $0.01, $100K daily loss |
| KYC enforcement | Series issuance blocked unless company KYC verified |
| Admin audit trail | All state-changing actions logged to audit_log table |
| Error boundaries | Every view wrapped in try/catch with retry UI |
| Security headers | CSP, X-Frame-Options, X-Content-Type-Options, X-XSS-Protection |
| Structured logging | JSON-formatted logs with request tracing |
| CORS | Configurable via CORS_ORIGINS env var |

## Admin Panel

http://localhost:8000/admin-panel — login with admin credentials

| View | What you can do |
|------|-----------------|
| **Dashboard** | System stats, recent trades, company counts |
| **Users** | Manage traders/admins, credit cash/PPU, suspend |
| **Companies** | Register companies, manage KYC + status |
| **Instruments** | Create series under companies, lifecycle controls |
| **Order Book** | Visual bid/ask ladder, spread analysis |
| **Funding** | Credit cash/PPU to users, transaction log |
| **Orders** | All orders, cancel, force-cancel |
| **Trades** | Trade surveillance |
| **Charts** | SVG price action chart with volume bars |
| **PPU Math** | Hard-coded formula calculator, dilution sim, growth model |
| **Profit** | Declare + distribute profit with revenue/expenses |
| **Reconciliation** | Ledger integrity check (cash net zero, PPU matches float) |
| **Audit Log** | All admin actions with timestamps and IPs |
| **DB Explorer** | Raw table viewer |

## Deployment

```bash
# Docker
cd C:\APP
docker-compose up -d

# Or manual
cd C:\APP\cemos-mvp\backend
python -m uvicorn main:app --host 0.0.0.0 --port 8000

# With auto-backup
python backup_db.py --schedule &
```

### Environment Variables
| Variable | Default | Description |
|----------|---------|-------------|
| `DB_PATH` | `./cemos.db` | SQLite database path |
| `CORS_ORIGINS` | `*` | Comma-separated allowed origins |
| `TOKEN_EXPIRY_HOURS` | `24` | Session token lifetime |
| `BACKUP_DIR` | `./backups` | Backup storage directory |
| `BACKUP_KEEP_DAYS` | `7` | Number of daily backups to retain |

## Database Schema

8 tables + 2 system tables:
- `users` — traders and admins (bcrypt hashed passwords)
- `companies` — issuers with KYC/status
- `instruments` — PPU issuance series with lifecycle
- `ppu_holdings` — user PPU balances
- `orders` — buy/sell limit orders
- `trades` — executed trades
- `ledger_entries` — double-entry accounting (cash + ppu)
- `profit_declarations` — profit events with revenue/expenses
- `profit_distributions` — payouts to PPU holders
- `sessions` — auth tokens with expiry
- `audit_log` — admin action trail
- `admin_transactions` — cash/PPU credit history

## License

Proprietary — FASEM Exchange Platform
