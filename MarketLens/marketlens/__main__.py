"""MarketLens command line.

    python -m marketlens ingest            # download (cached) + load + build tables
    python -m marketlens ingest --refresh  # force re-download from SEC
    python -m marketlens build             # rebuild tables from raw (after editing metrics.yaml)
    python -m marketlens summary           # revenue by company and year
    python -m marketlens summary --metric operating_margin
    python -m marketlens quality           # which metrics are missing where
"""
from __future__ import annotations

import argparse
import sys

import pandas as pd

from . import db, transform
from .config import load_companies
from .db import query_df


def cmd_ingest(args) -> None:
    from .ingest import ingest_company
    from .sec_client import SecClient

    companies, start_fy, forms = load_companies()
    if args.tickers:
        wanted = {t.upper() for t in args.tickers}
        companies = [c for c in companies if c.ticker in wanted]
    client = SecClient(refresh=args.refresh)
    con = db.connect()
    for c in companies:
        try:
            r = ingest_company(con, client, c, forms, start_fy)
            print(f"  {r['ticker']:<6} {r['facts']:>8,} facts  {r['filings']:>3} filings")
        except Exception as e:  # keep going; report at the end
            print(f"  {c.ticker:<6} FAILED: {e}", file=sys.stderr)
    n = transform.build_all(con, forms, start_fy)
    print(f"\nBuilt annual_financials: {n:,} rows")
    _print_summary(con, "revenue")


def cmd_build(args) -> None:
    _, start_fy, forms = load_companies()
    con = db.connect()
    n = transform.build_all(con, forms, start_fy)
    print(f"Built annual_financials: {n:,} rows")


def _print_summary(con, metric: str) -> None:
    if con.execute("SELECT to_regclass('financials')").fetchone()[0] is None:
        print("No data yet. Run: python -m marketlens ingest")
        return
    cols = list(query_df(con, "SELECT * FROM financials LIMIT 0").columns)
    if metric not in cols:
        raise SystemExit(f"Unknown metric '{metric}'. Options: {', '.join(cols[4:])}")
    df = query_df(con, f'SELECT ticker, fiscal_year, "{metric}" AS v FROM financials')
    if df.empty:
        print("No data yet. Run: python -m marketlens ingest")
        return
    table = df.pivot(index="fiscal_year", columns="ticker", values="v")
    is_ratio = metric.endswith(("margin", "growth", "pct_revenue"))
    if is_ratio:
        table = (table * 100).round(1).astype(str) + "%"
    elif metric != "eps_diluted":
        table = (table / 1e9).round(1)
    unit = "%" if is_ratio else ("USD" if metric == "eps_diluted" else "USD billions")
    print(f"\n{metric} ({unit})")
    with pd.option_context("display.width", 200, "display.max_columns", 20):
        print(table.replace("nan%", "-").fillna("-"))


def cmd_summary(args) -> None:
    _print_summary(db.connect(), args.metric)


def cmd_quality(args) -> None:
    df = query_df(db.connect(), "SELECT * FROM data_quality")
    if df.empty:
        print("All metrics present for every company-year.")
        return
    with pd.option_context("display.width", 200, "display.max_colwidth", 150):
        print(df.to_string(index=False))


def main() -> None:
    p = argparse.ArgumentParser(prog="marketlens")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("ingest", help="download SEC data and build tables")
    s.add_argument("--tickers", nargs="*", help="only these tickers (default: all in config)")
    s.add_argument("--refresh", action="store_true", help="ignore cache, re-download")
    s.set_defaults(func=cmd_ingest)

    s = sub.add_parser("build", help="rebuild derived tables from raw facts")
    s.set_defaults(func=cmd_build)

    s = sub.add_parser("summary", help="print a metric by company and year")
    s.add_argument("--metric", default="revenue")
    s.set_defaults(func=cmd_summary)

    s = sub.add_parser("quality", help="show missing metrics")
    s.set_defaults(func=cmd_quality)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
