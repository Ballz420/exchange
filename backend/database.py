"""
FASEM-P Exchange Database
Visible, interpretable schema with full referential integrity.

Tables:
  users              — Traders and admins
  instruments        — PPU securities listed on exchange
  ppu_holdings       — User PPU balances
  orders             — Buy/sell limit orders
  trades             — Executed trades
  ledger_entries     — Double-entry accounting (cash + ppu)
  profit_declarations — Company profit events
  profit_distributions — Payouts to PPU holders
"""
import sqlite3
import os

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
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            username    TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role        TEXT NOT NULL DEFAULT 'trader'
                        CHECK(role IN ('trader', 'admin')),
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS instruments (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT UNIQUE NOT NULL,
            description TEXT DEFAULT '',
            total_float REAL NOT NULL DEFAULT 0
                        CHECK(total_float >= 0),
            status      TEXT NOT NULL DEFAULT 'active'
                        CHECK(status IN ('active', 'delisted')),
            created_by  INTEGER NOT NULL REFERENCES users(id),
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS ppu_holdings (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL REFERENCES users(id),
            instrument_id   INTEGER NOT NULL REFERENCES instruments(id),
            units           REAL NOT NULL DEFAULT 0 CHECK(units >= 0),
            UNIQUE(user_id, instrument_id)
        );

        CREATE TABLE IF NOT EXISTS orders (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER NOT NULL REFERENCES users(id),
            instrument_id   INTEGER NOT NULL REFERENCES instruments(id),
            side            TEXT NOT NULL CHECK(side IN ('buy', 'sell')),
            price           REAL NOT NULL CHECK(price > 0),
            quantity        REAL NOT NULL CHECK(quantity > 0),
            filled_quantity REAL NOT NULL DEFAULT 0 CHECK(filled_quantity >= 0),
            status          TEXT NOT NULL DEFAULT 'open'
                            CHECK(status IN ('open', 'filled', 'partially_filled', 'cancelled')),
            created_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS trades (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            buy_order_id    INTEGER NOT NULL REFERENCES orders(id),
            sell_order_id   INTEGER NOT NULL REFERENCES orders(id),
            instrument_id   INTEGER NOT NULL REFERENCES instruments(id),
            buyer_id        INTEGER NOT NULL REFERENCES users(id),
            seller_id       INTEGER NOT NULL REFERENCES users(id),
            quantity        REAL NOT NULL CHECK(quantity > 0),
            price           REAL NOT NULL CHECK(price > 0),
            total_value     REAL NOT NULL CHECK(total_value > 0),
            created_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS ledger_entries (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            ledger_type TEXT NOT NULL CHECK(ledger_type IN ('cash', 'ppu')),
            user_id     INTEGER NOT NULL REFERENCES users(id),
            trade_id    INTEGER REFERENCES trades(id),
            instrument_id INTEGER REFERENCES instruments(id),
            debit       REAL NOT NULL DEFAULT 0 CHECK(debit >= 0),
            credit      REAL NOT NULL DEFAULT 0 CHECK(credit >= 0),
            description TEXT NOT NULL DEFAULT '',
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS profit_declarations (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            instrument_id   INTEGER NOT NULL REFERENCES instruments(id),
            period_label    TEXT NOT NULL,
            total_profit    REAL NOT NULL CHECK(total_profit > 0),
            profit_per_ppu  REAL NOT NULL DEFAULT 0,
            total_ppus      REAL NOT NULL DEFAULT 0,
            status          TEXT NOT NULL DEFAULT 'declared'
                            CHECK(status IN ('declared', 'distributed')),
            declared_at     TEXT NOT NULL DEFAULT (datetime('now')),
            distributed_at  TEXT
        );

        CREATE TABLE IF NOT EXISTS profit_distributions (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            declaration_id  INTEGER NOT NULL REFERENCES profit_declarations(id),
            user_id         INTEGER NOT NULL REFERENCES users(id),
            ppu_holding_id  INTEGER NOT NULL REFERENCES ppu_holdings(id),
            units_held      REAL NOT NULL DEFAULT 0,
            amount_paid     REAL NOT NULL DEFAULT 0,
            paid_at         TEXT NOT NULL DEFAULT (datetime('now'))
        );
    """)

    conn.commit()
    conn.close()