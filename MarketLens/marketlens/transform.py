"""Turn raw XBRL facts into clean annual financials (PostgreSQL).

Output:
  annual_financials  table: one row per company x fiscal year x metric (with source tag + filing)
  financials         view:  one row per company x fiscal year, plus derived ratios
  data_quality       view:  missing metrics per company-year
"""
from __future__ import annotations

from psycopg import sql

from .config import load_metrics
from .db import copy_df

import pandas as pd

FISCAL_YEAR_SQL = """(extract(year FROM end_date)::int
    - CASE WHEN extract(month FROM end_date) = 1 AND extract(day FROM end_date) <= 7 THEN 1 ELSE 0 END)"""


def load_metric_map(cur, metrics: dict) -> None:
    rows = [
        (name, m["label"], m["period_type"], m["unit"], tag, i)
        for name, m in metrics.items()
        for i, tag in enumerate(m["tags"])
    ]
    df = pd.DataFrame(rows, columns=["metric", "label", "period_type", "unit", "tag", "priority"])
    cur.execute("DELETE FROM metric_map")
    copy_df(cur, "metric_map", df)


def build_annual_financials(cur, forms: list[str], start_fy: int) -> None:
    cur.execute("DROP TABLE IF EXISTS annual_financials CASCADE")  # also drops dependent views
    cur.execute(f"""
    CREATE TABLE annual_financials AS
    WITH annual AS (
        SELECT f.*, m.metric, m.label, m.period_type, m.priority
        FROM facts_raw f
        JOIN metric_map m ON f.tag = m.tag AND f.unit = m.unit
        WHERE f.taxonomy = 'us-gaap'
          AND f.form = ANY(%(forms)s)
          AND f.value IS NOT NULL
          AND (
                (m.period_type = 'duration' AND f.start_date IS NOT NULL
                   AND (f.end_date - f.start_date) BETWEEN 350 AND 380)
             OR (m.period_type = 'instant' AND f.start_date IS NULL)
          )
    ),
    -- Fiscal year ends = end dates of full-year flows. Balance-sheet values are kept only
    -- at these dates (drops e.g. equity-statement balances at odd dates).
    fy_ends AS (
        SELECT DISTINCT cik, end_date FROM annual WHERE period_type = 'duration'
    ),
    kept AS (
        SELECT a.* FROM annual a JOIN fy_ends e USING (cik, end_date)
    ),
    -- The same number appears in up to 3 consecutive 10-Ks; keep the most recent filing
    -- (so restatements win).
    latest_per_tag AS (
        SELECT DISTINCT ON (cik, metric, end_date, tag) *
        FROM kept
        ORDER BY cik, metric, end_date, tag, filed DESC, accession_no DESC
    ),
    -- Several tags can map to one metric; the highest-priority tag with a value wins.
    best AS (
        SELECT DISTINCT ON (cik, metric, end_date) *
        FROM latest_per_tag
        ORDER BY cik, metric, end_date, priority
    ),
    labeled AS (
        SELECT b.*, {FISCAL_YEAR_SQL} AS fiscal_year FROM best b
    )
    -- If a company changed fiscal year end, two periods can map to one fiscal year;
    -- keep the later one so (company, year, metric) stays unique.
    SELECT DISTINCT ON (l.cik, l.fiscal_year, l.metric)
        l.cik,
        c.ticker,
        l.fiscal_year,
        l.end_date        AS period_end,
        l.metric,
        l.label,
        l.value,
        l.tag             AS source_tag,
        l.accession_no    AS source_accession,
        l.filed           AS source_filed
    FROM labeled l
    JOIN companies c USING (cik)
    WHERE l.fiscal_year >= %(start_fy)s
    ORDER BY l.cik, l.fiscal_year, l.metric, l.end_date DESC
    """, {"forms": forms, "start_fy": start_fy})
    cur.execute("ALTER TABLE annual_financials ADD PRIMARY KEY (cik, fiscal_year, metric)")
    cur.execute("CREATE INDEX ON annual_financials (ticker, metric)")


def build_financials_view(cur, metrics: dict) -> None:
    names = list(metrics)
    pivots = sql.SQL(",\n        ").join(
        sql.SQL("max(value) FILTER (WHERE metric = {}) AS {}").format(sql.Literal(m), sql.Identifier(m))
        for m in names
    )
    # Amazon, Alphabet, Meta don't tag GrossProfit; derive it.
    filled_cols = sql.SQL(", ").join(
        sql.SQL("coalesce(gross_profit, revenue - cost_of_revenue) AS gross_profit")
        if m == "gross_profit" else sql.Identifier(m)
        for m in names
    )
    cur.execute(sql.SQL("""
    CREATE OR REPLACE VIEW financials AS
    WITH wide AS (
        SELECT cik, ticker, fiscal_year, max(period_end) AS period_end,
        {pivots}
        FROM annual_financials
        GROUP BY cik, ticker, fiscal_year
    ),
    filled AS (
        SELECT cik, ticker, fiscal_year, period_end, {filled_cols}
        FROM wide
    )
    SELECT
        f.*,
        operating_cash_flow - capex                           AS free_cash_flow,
        gross_profit / nullif(revenue, 0)                     AS gross_margin,
        operating_income / nullif(revenue, 0)                 AS operating_margin,
        net_income / nullif(revenue, 0)                       AS net_margin,
        rnd_expense / nullif(revenue, 0)                      AS rnd_pct_revenue,
        capex / nullif(revenue, 0)                            AS capex_pct_revenue,
        revenue / nullif(lag(revenue) OVER w, 0) - 1          AS revenue_growth,
        net_income / nullif(lag(net_income) OVER w, 0) - 1    AS net_income_growth
    FROM filled f
    WINDOW w AS (PARTITION BY cik ORDER BY fiscal_year)
    ORDER BY ticker, fiscal_year
    """).format(pivots=pivots, filled_cols=filled_cols))


def build_data_quality_view(cur, metrics: dict) -> None:
    values = sql.SQL(", ").join(sql.SQL("({})").format(sql.Literal(m)) for m in metrics)
    cur.execute(sql.SQL("""
    CREATE OR REPLACE VIEW data_quality AS
    WITH expected AS (
        SELECT DISTINCT a.cik, a.ticker, a.fiscal_year, m.metric
        FROM annual_financials a CROSS JOIN (VALUES {values}) AS m(metric)
    )
    SELECT e.ticker, e.fiscal_year, array_agg(e.metric ORDER BY e.metric) AS missing_metrics
    FROM expected e
    LEFT JOIN annual_financials a USING (cik, fiscal_year, metric)
    WHERE a.value IS NULL
    GROUP BY e.ticker, e.fiscal_year
    ORDER BY e.ticker, e.fiscal_year
    """).format(values=values))


def build_all(con, forms: list[str], start_fy: int) -> int:
    metrics = load_metrics()
    with con.transaction(), con.cursor() as cur:
        load_metric_map(cur, metrics)
        build_annual_financials(cur, forms, start_fy)
        build_financials_view(cur, metrics)
        build_data_quality_view(cur, metrics)
        cur.execute("SELECT count(*) FROM annual_financials")
        return cur.fetchone()[0]
