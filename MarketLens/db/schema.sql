-- MarketLens structured database schema
-- Normalized so you can query e.g. "revenue trend for AAPL 2018-2024" in plain SQL,
-- and so it extends cleanly to S&P 500 later without a redesign.

CREATE TABLE IF NOT EXISTS companies (
    ticker      VARCHAR(10) PRIMARY KEY,
    cik         VARCHAR(10) UNIQUE NOT NULL,
    name        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS filings (
    id                  SERIAL PRIMARY KEY,
    ticker              VARCHAR(10) REFERENCES companies(ticker),
    accession_number    VARCHAR(25) UNIQUE NOT NULL,
    form_type           VARCHAR(10) NOT NULL DEFAULT '10-K',
    filing_date         DATE NOT NULL,
    report_date         DATE NOT NULL,          -- fiscal period end
    primary_document    TEXT,                    -- filename of main 10-K doc on EDGAR
    raw_path            TEXT,                    -- local path to downloaded HTML
    ingested_at         TIMESTAMP DEFAULT NOW()
);

-- One row per (company, metric, period) reported financial fact.
-- Sourced from EDGAR's companyfacts (XBRL) API — already normalized by SEC,
-- we just flatten it out of nested JSON into rows.
CREATE TABLE IF NOT EXISTS financial_facts (
    id              SERIAL PRIMARY KEY,
    ticker          VARCHAR(10) REFERENCES companies(ticker),
    taxonomy        VARCHAR(20) NOT NULL,        -- e.g. 'us-gaap'
    tag             VARCHAR(100) NOT NULL,       -- e.g. 'Revenues', 'EarningsPerShareBasic'
    unit            VARCHAR(20) NOT NULL,        -- e.g. 'USD', 'USD-per-shares'
    value           NUMERIC NOT NULL,
    fiscal_year     INT NOT NULL,
    fiscal_period    VARCHAR(4) NOT NULL,        -- 'FY', 'Q1', 'Q2', 'Q3'
    period_start    DATE,
    period_end      DATE NOT NULL,
    accession_number VARCHAR(25),                -- which filing this came from
    form_type       VARCHAR(10),
    UNIQUE (ticker, tag, unit, fiscal_year, fiscal_period, period_end)
);

CREATE INDEX IF NOT EXISTS idx_facts_ticker_tag ON financial_facts (ticker, tag);
CREATE INDEX IF NOT EXISTS idx_facts_fy ON financial_facts (fiscal_year);
CREATE INDEX IF NOT EXISTS idx_filings_ticker ON filings (ticker);
