"""
FASEM-P Exchange Database — Dual SQLite/PostgreSQL Support
Set DB_TYPE=postgres and DATABASE_URL to use PostgreSQL (Supabase).
Defaults to SQLite for local development.
"""
import os, re

DB_TYPE = os.environ.get("DB_TYPE", "sqlite")
DB_PATH = os.environ.get("DB_PATH", os.path.join(os.path.dirname(__file__), "cemos.db"))
DATABASE_URL = os.environ.get("DATABASE_URL", "")

def _placeholder(sql):
    """Convert ? placeholders to %s for PostgreSQL compatibility."""
    if DB_TYPE == "postgres":
        return sql.replace("?", "%s")
    return sql

def _lastrowid(cursor):
    """Get last inserted row ID (works for both SQLite and PostgreSQL)."""
    if DB_TYPE == "postgres":
        return cursor.fetchone()[0]
    return cursor.lastrowid

class Row:
    """Unified row wrapper for both SQLite Row and psycopg2 RealDictRow."""
    def __init__(self, data):
        self._data = data
    def __getitem__(self, key):
        return self._data[key] if isinstance(self._data, dict) else self._data[key]
    def __getattr__(self, key):
        try:
            return self._data[key]
        except (KeyError, TypeError):
            raise AttributeError(key)

class PGCursor:
    """Cursor wrapper that returns dicts and supports .lastrowid."""
    def __init__(self, cur, conn):
        self._cur = cur
        self._conn = conn
    def execute(self, sql, params=None):
        pg_sql = sql.replace("?", "%s")
        if params is None:
            self._cur.execute(pg_sql)
        else:
            self._cur.execute(pg_sql, params)
        return self
    def executemany(self, sql, params_list):
        pg_sql = sql.replace("?", "%s")
        self._cur.executemany(pg_sql, params_list)
        return self
    def fetchone(self):
        return self._cur.fetchone()
    def fetchall(self):
        return self._cur.fetchall()
    @property
    def lastrowid(self):
        self._cur.execute("SELECT lastval()")
        return self._cur.fetchone()[0]
    def __getitem__(self, key):
        return self._cur.fetchone()[key]
    def close(self):
        self._cur.close()

class PGWrapper:
    """Wraps a psycopg2 connection to be compatible with sqlite3-style conn.execute().
    Auto-converts ? to %s, returns dict-like rows, supports .lastrowid."""
    def __init__(self, conn):
        self._conn = conn
    def execute(self, sql, params=None):
        import psycopg2.extras
        cur = self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        pg_sql = sql.replace("?", "%s")
        if params is None:
            cur.execute(pg_sql)
        else:
            cur.execute(pg_sql, params)
        return PGCursor(cur, self._conn)
    def commit(self):
        self._conn.commit()
    def close(self):
        self._conn.close()
    def cursor(self):
        import psycopg2.extras
        return self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

def get_connection():
    """Get a database connection — SQLite or PostgreSQL based on DB_TYPE."""
    if DB_TYPE == "postgres":
        import psycopg2
        conn = psycopg2.connect(DATABASE_URL)
        conn.autocommit = False
        return PGWrapper(conn)
    else:
        import sqlite3
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

def execute(conn, sql, params=None):
    """Execute SQL with proper placeholder conversion. Returns cursor."""
    cursor = conn.cursor()
    cursor.execute(_placeholder(sql), params or ())
    return cursor

def executemany(conn, sql, params_list):
    """Execute many with placeholder conversion."""
    cursor = conn.cursor()
    cursor.executemany(_placeholder(sql), params_list)
    return cursor

def fetchone(cursor):
    """Fetch one row, wrapped in unified Row access."""
    row = cursor.fetchone()
    if row is None:
        return None
    if DB_TYPE == "postgres":
        # psycopg2 RealDictRow is already dict-like
        return row
    return row  # sqlite3.Row is already dict-like

def fetchall(cursor):
    """Fetch all rows."""
    rows = cursor.fetchall()
    return rows

def insert(conn, sql, params=None):
    """Execute INSERT and return the new row ID."""
    if DB_TYPE == "postgres":
        sql += " RETURNING id"
        cur = execute(conn, sql, params)
        return cur.fetchone()[0]
    else:
        cur = execute(conn, sql, params)
        return cur.lastrowid

def now():
    """SQL-compatible current timestamp."""
    return "NOW()" if DB_TYPE == "postgres" else "datetime('now')"

def init_db():
    """Initialize database schema — creates all tables if not present."""
    if DB_TYPE == "postgres":
        _init_postgres()
    else:
        _init_sqlite()

def _init_sqlite():
    conn = get_connection()
    c = conn.cursor()
    c.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            username    TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role        TEXT NOT NULL DEFAULT 'trader' CHECK(role IN ('trader', 'admin')),
            status      TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'suspended')),
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS sessions (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL REFERENCES users(id),
            token       TEXT UNIQUE NOT NULL,
            expires_at  REAL NOT NULL,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            last_used   TEXT
        );
        CREATE TABLE IF NOT EXISTS audit_log (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            admin_id    INTEGER REFERENCES users(id),
            action      TEXT NOT NULL,
            target_type TEXT, target_id INTEGER, details TEXT DEFAULT '',
            ip_address  TEXT DEFAULT '',
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS companies (
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL,
            description TEXT DEFAULT '', industry TEXT DEFAULT '', country TEXT DEFAULT '',
            founder_names TEXT DEFAULT '', total_float_pct REAL DEFAULT 25.0,
            retained_pct REAL DEFAULT 75.0, kyc_status TEXT DEFAULT 'pending',
            status TEXT DEFAULT 'pending', created_by INTEGER NOT NULL REFERENCES users(id),
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS instruments (
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL,
            description TEXT DEFAULT '', total_float REAL NOT NULL DEFAULT 0,
            status TEXT DEFAULT 'active', company_id INTEGER REFERENCES companies(id),
            series_label TEXT DEFAULT '', raise_target REAL DEFAULT 0,
            price_per_ppu REAL DEFAULT NULL, capital_deployed REAL DEFAULT 0,
            capital_attested INTEGER DEFAULT 0, lifecycle_status TEXT DEFAULT 'active',
            use_of_proceeds TEXT DEFAULT '[]', created_by INTEGER NOT NULL REFERENCES users(id),
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS ppu_holdings (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id),
            instrument_id INTEGER NOT NULL REFERENCES instruments(id),
            units REAL NOT NULL DEFAULT 0, UNIQUE(user_id, instrument_id)
        );
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id),
            instrument_id INTEGER NOT NULL REFERENCES instruments(id),
            side TEXT NOT NULL, price REAL NOT NULL, quantity REAL NOT NULL,
            filled_quantity REAL DEFAULT 0, status TEXT DEFAULT 'open',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS trades (
            id INTEGER PRIMARY KEY AUTOINCREMENT, buy_order_id INTEGER, sell_order_id INTEGER,
            instrument_id INTEGER NOT NULL, buyer_id INTEGER NOT NULL, seller_id INTEGER NOT NULL,
            quantity REAL NOT NULL, price REAL NOT NULL, total_value REAL NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS ledger_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_type TEXT NOT NULL,
            user_id INTEGER NOT NULL, trade_id INTEGER, instrument_id INTEGER,
            debit REAL DEFAULT 0, credit REAL DEFAULT 0, description TEXT DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS admin_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL,
            admin_id INTEGER NOT NULL, user_id INTEGER NOT NULL, amount REAL DEFAULT 0,
            instrument_id INTEGER, balance_before REAL DEFAULT 0, balance_after REAL DEFAULT 0,
            description TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS kyc_submissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
            full_name TEXT DEFAULT '', nationality TEXT DEFAULT '', country TEXT DEFAULT '',
            document_type TEXT DEFAULT 'passport', kyc_level TEXT DEFAULT 'unverified',
            risk_score INTEGER DEFAULT 0, reviewed_by INTEGER, reviewed_at TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT
        );
        CREATE TABLE IF NOT EXISTS sanctions_hits (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
            list_name TEXT NOT NULL, matched_name TEXT NOT NULL,
            severity TEXT DEFAULT 'medium', status TEXT DEFAULT 'open',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS transaction_alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT, alert_type TEXT NOT NULL,
            user_id INTEGER, instrument_id INTEGER, severity TEXT DEFAULT 'medium',
            description TEXT DEFAULT '', status TEXT DEFAULT 'open',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS travel_rule_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
            transaction_type TEXT NOT NULL, amount REAL NOT NULL,
            counterparty_name TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
    """)
    c.execute("INSERT OR IGNORE INTO users (id, username, password_hash, role) VALUES (0, 'system', '', 'admin')")
    conn.commit()
    conn.close()

def _init_postgres():
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL, role TEXT DEFAULT 'trader', status TEXT DEFAULT 'active',
            created_at TIMESTAMP DEFAULT NOW()
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id),
            token TEXT UNIQUE NOT NULL, expires_at DOUBLE PRECISION NOT NULL,
            created_at TIMESTAMP DEFAULT NOW(), last_used TIMESTAMP
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS companies (
            id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL,
            description TEXT DEFAULT '', industry TEXT DEFAULT '', country TEXT DEFAULT '',
            founder_names TEXT DEFAULT '', total_float_pct NUMERIC DEFAULT 25.0,
            retained_pct NUMERIC DEFAULT 75.0, kyc_status TEXT DEFAULT 'pending',
            status TEXT DEFAULT 'pending', created_by INTEGER NOT NULL REFERENCES users(id),
            created_at TIMESTAMP DEFAULT NOW()
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS instruments (
            id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL,
            description TEXT DEFAULT '', total_float NUMERIC NOT NULL DEFAULT 0,
            status TEXT DEFAULT 'active', company_id INTEGER REFERENCES companies(id),
            series_label TEXT DEFAULT '', raise_target NUMERIC DEFAULT 0,
            price_per_ppu NUMERIC, lifecycle_status TEXT DEFAULT 'active',
            created_by INTEGER NOT NULL REFERENCES users(id),
            created_at TIMESTAMP DEFAULT NOW()
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS ppu_holdings (
            id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
            instrument_id INTEGER NOT NULL REFERENCES instruments(id),
            units NUMERIC NOT NULL DEFAULT 0, UNIQUE(user_id, instrument_id)
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS orders (
            id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, instrument_id INTEGER NOT NULL,
            side TEXT NOT NULL, price NUMERIC NOT NULL, quantity NUMERIC NOT NULL,
            filled_quantity NUMERIC DEFAULT 0, status TEXT DEFAULT 'open',
            created_at TIMESTAMP DEFAULT NOW()
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS trades (
            id SERIAL PRIMARY KEY, buy_order_id INTEGER, sell_order_id INTEGER,
            instrument_id INTEGER NOT NULL, buyer_id INTEGER NOT NULL, seller_id INTEGER NOT NULL,
            quantity NUMERIC NOT NULL, price NUMERIC NOT NULL, total_value NUMERIC NOT NULL,
            created_at TIMESTAMP DEFAULT NOW()
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS ledger_entries (
            id SERIAL PRIMARY KEY, ledger_type TEXT NOT NULL,
            user_id INTEGER NOT NULL, trade_id INTEGER, instrument_id INTEGER,
            debit NUMERIC DEFAULT 0, credit NUMERIC DEFAULT 0, description TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT NOW()
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS audit_log (
            id SERIAL PRIMARY KEY, admin_id INTEGER, action TEXT NOT NULL,
            target_type TEXT, target_id INTEGER, details TEXT DEFAULT '',
            ip_address TEXT DEFAULT '', created_at TIMESTAMP DEFAULT NOW()
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS admin_transactions (
            id SERIAL PRIMARY KEY, type TEXT NOT NULL,
            admin_id INTEGER NOT NULL, user_id INTEGER NOT NULL, amount NUMERIC DEFAULT 0,
            instrument_id INTEGER, created_at TIMESTAMP DEFAULT NOW()
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS kyc_submissions (
            id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
            full_name TEXT DEFAULT '', nationality TEXT DEFAULT '', country TEXT DEFAULT '',
            document_type TEXT DEFAULT 'passport', kyc_level TEXT DEFAULT 'unverified',
            risk_score INTEGER DEFAULT 0, reviewed_by INTEGER, reviewed_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS sanctions_hits (
            id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL,
            list_name TEXT NOT NULL, matched_name TEXT NOT NULL,
            severity TEXT DEFAULT 'medium', status TEXT DEFAULT 'open',
            created_at TIMESTAMP DEFAULT NOW()
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS transaction_alerts (
            id SERIAL PRIMARY KEY, alert_type TEXT NOT NULL,
            user_id INTEGER, instrument_id INTEGER, severity TEXT DEFAULT 'medium',
            description TEXT DEFAULT '', status TEXT DEFAULT 'open',
            created_at TIMESTAMP DEFAULT NOW()
        )
    """)
    cur.execute("INSERT INTO users (id, username, password_hash, role) VALUES (0, 'system', '', 'admin') ON CONFLICT DO NOTHING")
    conn.commit()
    conn.close()
