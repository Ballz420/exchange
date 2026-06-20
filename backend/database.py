import sqlite3
import os

# Use environment variable if set (for Docker/Render), otherwise default to local
DB_PATH = os.environ.get("DB_PATH", os.path.join(os.path.dirname(__file__), "cemos.db"))


def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    conn = get_connection()
    cursor = conn.cursor()

    cursor.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('buyer', 'seller', 'admin')),
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS commodities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            unit_of_measure TEXT NOT NULL,
            description TEXT DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS rfqs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            buyer_id INTEGER NOT NULL REFERENCES users(id),
            commodity_id INTEGER NOT NULL REFERENCES commodities(id),
            quantity REAL NOT NULL CHECK(quantity > 0),
            status TEXT NOT NULL DEFAULT 'open'
                CHECK(status IN ('open', 'responded', 'accepted', 'cancelled')),
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS rfq_responses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            rfq_id INTEGER NOT NULL REFERENCES rfqs(id),
            seller_id INTEGER NOT NULL REFERENCES users(id),
            price_per_unit REAL NOT NULL CHECK(price_per_unit > 0),
            quantity_available REAL NOT NULL CHECK(quantity_available > 0),
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS trades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            rfq_id INTEGER NOT NULL REFERENCES rfqs(id),
            buyer_id INTEGER NOT NULL REFERENCES users(id),
            seller_id INTEGER NOT NULL REFERENCES users(id),
            commodity_id INTEGER NOT NULL REFERENCES commodities(id),
            quantity REAL NOT NULL CHECK(quantity > 0),
            price_per_unit REAL NOT NULL CHECK(price_per_unit > 0),
            total_value REAL NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending'
                CHECK(status IN ('pending', 'escrow_funded', 'delivery_confirmed', 'settled', 'disputed')),
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            settled_at TEXT
        );

        CREATE TABLE IF NOT EXISTS ledger_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ledger_type TEXT NOT NULL CHECK(ledger_type IN ('cash', 'unit')),
            account_id INTEGER NOT NULL,
            trade_id INTEGER NOT NULL REFERENCES trades(id),
            debit REAL NOT NULL DEFAULT 0 CHECK(debit >= 0),
            credit REAL NOT NULL DEFAULT 0 CHECK(credit >= 0),
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS settlement_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trade_id INTEGER NOT NULL REFERENCES trades(id),
            event_type TEXT NOT NULL,
            description TEXT DEFAULT '',
            created_by INTEGER NOT NULL REFERENCES users(id),
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS disputes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trade_id INTEGER NOT NULL REFERENCES trades(id),
            reason TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'resolved', 'rejected')),
            resolution TEXT DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- ==================== FASEM-P TABLES ====================

        CREATE TABLE IF NOT EXISTS fasem_companies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            description TEXT DEFAULT '',
            sector TEXT DEFAULT '',
            founder_user_id INTEGER NOT NULL REFERENCES users(id),
            float_ratio REAL NOT NULL DEFAULT 0.5 CHECK(float_ratio >= 0.0 AND float_ratio <= 1.0),
            total_ppus_issued REAL NOT NULL DEFAULT 0,
            ppu_face_value REAL NOT NULL DEFAULT 1.0,
            total_capital_raised REAL NOT NULL DEFAULT 0.0,
            capital_compliant INTEGER NOT NULL DEFAULT 1,
            status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'suspended', 'delisted')),
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS fasem_ppus (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER NOT NULL REFERENCES fasem_companies(id),
            owner_id INTEGER NOT NULL REFERENCES users(id),
            units REAL NOT NULL DEFAULT 0,
            purchase_price REAL NOT NULL DEFAULT 0.0,
            total_cost REAL NOT NULL DEFAULT 0.0,
            status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'transferred', 'redeemed')),
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS fasem_profit_declarations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER NOT NULL REFERENCES fasem_companies(id),
            period_label TEXT NOT NULL,
            total_profit REAL NOT NULL DEFAULT 0.0,
            retained_profit REAL NOT NULL DEFAULT 0.0,
            distributable_profit REAL NOT NULL DEFAULT 0.0,
            total_ppus_at_declaration REAL NOT NULL DEFAULT 0.0,
            profit_per_ppu REAL NOT NULL DEFAULT 0.0,
            status TEXT NOT NULL DEFAULT 'declared' CHECK(status IN ('declared', 'distributed')),
            declared_at TEXT NOT NULL DEFAULT (datetime('now')),
            distributed_at TEXT
        );

        CREATE TABLE IF NOT EXISTS fasem_profit_distributions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            declaration_id INTEGER NOT NULL REFERENCES fasem_profit_declarations(id),
            owner_id INTEGER NOT NULL REFERENCES users(id),
            ppu_id INTEGER REFERENCES fasem_ppus(id),
            units_held REAL NOT NULL DEFAULT 0.0,
            amount_paid REAL NOT NULL DEFAULT 0.0,
            paid_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS fasem_capital_deployments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER NOT NULL REFERENCES fasem_companies(id),
            amount REAL NOT NULL DEFAULT 0.0,
            category TEXT NOT NULL CHECK(category IN ('expansion','equipment','facilities','inventory','wages','logistics')),
            description TEXT DEFAULT '',
            receipt_reference TEXT DEFAULT '',
            is_permitted INTEGER NOT NULL DEFAULT 1,
            deployed_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
    """)

    conn.commit()
    conn.close()