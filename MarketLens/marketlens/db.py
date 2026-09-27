"""PostgreSQL storage.

Connection string comes from DATABASE_URL in .env, e.g.
    postgresql://postgres:<password>@localhost:5432/marketlens
The database is created automatically if it doesn't exist.
"""
from __future__ import annotations

import pandas as pd
import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo

from .config import database_url

SCHEMA = """
CREATE TABLE IF NOT EXISTS companies (
    cik         BIGINT PRIMARY KEY,
    ticker      TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    sec_name    TEXT,
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- One row per filing (10-K, 10-K/A for now; 10-Q/8-K later).
CREATE TABLE IF NOT EXISTS filings (
    accession_no     TEXT PRIMARY KEY,
    cik              BIGINT NOT NULL REFERENCES companies(cik) ON DELETE CASCADE,
    form             TEXT NOT NULL,
    filing_date      DATE,
    report_date      DATE,          -- period end the filing covers
    fiscal_year      INTEGER,
    primary_document TEXT,
    url              TEXT
);
CREATE INDEX IF NOT EXISTS filings_cik_fy ON filings (cik, fiscal_year);

-- Every XBRL fact exactly as the SEC returns it (all forms, all years).
-- Kept raw so metrics can be re-derived without re-downloading.
CREATE TABLE IF NOT EXISTS facts_raw (
    cik          BIGINT NOT NULL REFERENCES companies(cik) ON DELETE CASCADE,
    taxonomy     TEXT NOT NULL,      -- us-gaap, dei, ...
    tag          TEXT NOT NULL,
    unit         TEXT NOT NULL,
    start_date   DATE,               -- NULL for instant (balance sheet) facts
    end_date     DATE NOT NULL,
    value        DOUBLE PRECISION,
    accession_no TEXT,
    fy           INTEGER,            -- fiscal year of the FILING, not of the period
    fp           TEXT,
    form         TEXT,
    filed        DATE,
    frame        TEXT
);
CREATE INDEX IF NOT EXISTS facts_raw_cik_tag ON facts_raw (cik, tag);

-- Curated metric -> tag mapping, loaded from config/metrics.yaml.
CREATE TABLE IF NOT EXISTS metric_map (
    metric      TEXT NOT NULL,
    label       TEXT NOT NULL,
    period_type TEXT NOT NULL,
    unit        TEXT NOT NULL,
    tag         TEXT NOT NULL,
    priority    INTEGER NOT NULL,
    PRIMARY KEY (metric, tag)
);
"""


def ensure_database(url: str) -> None:
    """Create the target database if it doesn't exist yet."""
    params = conninfo_to_dict(url)
    dbname = params.get("dbname") or "marketlens"
    admin = make_conninfo(url, dbname="postgres")
    with psycopg.connect(admin, autocommit=True) as con:
        exists = con.execute("SELECT 1 FROM pg_database WHERE datname = %s", [dbname]).fetchone()
        if not exists:
            con.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(dbname)))


def connect(url: str | None = None) -> psycopg.Connection:
    url = url or database_url()
    try:
        ensure_database(url)
        con = psycopg.connect(url, autocommit=True)
    except psycopg.OperationalError as e:
        raise SystemExit(
            f"Could not connect to PostgreSQL: {e}\n"
            "Check that the PostgreSQL service is running and DATABASE_URL in .env "
            "has the right password."
        ) from e
    con.execute(SCHEMA)
    return con


def query_df(con: psycopg.Connection, query: str, params=None) -> pd.DataFrame:
    with con.cursor() as cur:
        cur.execute(query, params)
        cols = [d.name for d in cur.description]
        return pd.DataFrame(cur.fetchall(), columns=cols)


def copy_df(cur: psycopg.Cursor, table: str, df: pd.DataFrame) -> None:
    """Fast bulk insert with COPY."""
    clean = df.astype(object).where(df.notna(), None)
    cols = sql.SQL(", ").join(sql.Identifier(c) for c in df.columns)
    with cur.copy(sql.SQL("COPY {} ({}) FROM STDIN").format(sql.Identifier(table), cols)) as cp:
        for row in clean.itertuples(index=False, name=None):
            cp.write_row(row)
