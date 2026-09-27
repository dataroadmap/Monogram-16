"""Tests for the facts -> annual financials pipeline, using a synthetic company that
reproduces the real-world quirks of SEC companyfacts data."""
import os

import pandas as pd
import psycopg
import psycopg.conninfo
import pytest

from marketlens import db, transform
from marketlens.config import Company
from marketlens.ingest import facts_to_frame, fiscal_year_from_end, load_company, submissions_to_frame

CO = Company("TEST", "Test Corp", 1234)


def fact(val, end, start=None, form="10-K", filed="2020-11-01", accn="0001-20-000001", fy=2020, fp="FY"):
    d = {"end": end, "val": val, "accn": accn, "fy": fy, "fp": fp, "form": form, "filed": filed}
    if start:
        d["start"] = start
    return d


FACTS = {
    "cik": 1234,
    "entityName": "TEST CORP",
    "facts": {
        "us-gaap": {
            # Old tag used in the FY2018 10-K, new tag afterwards.
            "SalesRevenueNet": {"units": {"USD": [
                fact(100, "2018-09-29", "2017-10-01", filed="2018-11-01", accn="A18", fy=2018),
            ]}},
            "Revenues": {"units": {"USD": [
                # FY2019 10-K: FY2019 and comparative FY2018
                fact(120, "2019-09-28", "2018-09-30", filed="2019-11-01", accn="A19", fy=2019),
                fact(100, "2018-09-29", "2017-10-01", filed="2019-11-01", accn="A19", fy=2019),
                # FY2020 10-K restates FY2019 to 121
                fact(150, "2020-09-26", "2019-09-29", filed="2020-11-01", accn="A20", fy=2020),
                fact(121, "2019-09-28", "2018-09-30", filed="2020-11-01", accn="A20", fy=2020),
                # Quarterly value in a 10-Q -> must be ignored
                fact(40, "2020-06-27", "2020-03-29", form="10-Q", filed="2020-07-30", accn="Q20", fy=2020, fp="Q3"),
                # Q4-only 3-month value inside a 10-K -> must be ignored (duration filter)
                fact(45, "2020-09-26", "2020-06-28", filed="2020-11-01", accn="A20", fy=2020),
                # Pre-2018 year -> excluded by start_fiscal_year
                fact(90, "2017-09-30", "2016-10-01", filed="2018-11-01", accn="A18", fy=2018),
            ]}},
            "CostOfRevenue": {"units": {"USD": [
                fact(60, "2019-09-28", "2018-09-30", filed="2019-11-01", accn="A19", fy=2019),
                fact(80, "2020-09-26", "2019-09-29", filed="2020-11-01", accn="A20", fy=2020),
            ]}},
            "Assets": {"units": {"USD": [
                fact(500, "2019-09-28", filed="2019-11-01", accn="A19", fy=2019),
                fact(600, "2020-09-26", filed="2020-11-01", accn="A20", fy=2020),
                # Balance at a non-year-end date (e.g. from a 10-Q) -> ignored
                fact(550, "2020-03-28", form="10-Q", filed="2020-05-01", accn="Q20b", fy=2020, fp="Q2"),
            ]}},
            "EarningsPerShareDiluted": {"units": {"USD/shares": [
                fact(2.5, "2020-09-26", "2019-09-29", filed="2020-11-01", accn="A20", fy=2020),
            ]}},
        },
        "dei": {
            "EntityCommonStockSharesOutstanding": {"units": {"shares": [
                fact(1000, "2020-10-15", filed="2020-11-01", accn="A20", fy=2020),
            ]}},
        },
    },
}


TEST_URL = os.getenv("TEST_DATABASE_URL", "postgresql://postgres@localhost:5432/marketlens_test")


@pytest.fixture
def con():
    if not psycopg.conninfo.conninfo_to_dict(TEST_URL).get("dbname", "").endswith("_test"):
        pytest.fail("TEST_DATABASE_URL must point to a database ending in _test (tests wipe it).")
    try:
        db.ensure_database(TEST_URL)
    except psycopg.OperationalError as e:
        pytest.skip(f"PostgreSQL not reachable for tests ({TEST_URL}): {e}")
    with psycopg.connect(TEST_URL, autocommit=True) as c:
        c.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
    con = db.connect(TEST_URL)
    facts = facts_to_frame(CO.cik, FACTS)
    load_company(con, CO, FACTS["entityName"], facts, pd.DataFrame())
    transform.build_all(con, ["10-K", "10-K/A"], 2018)
    return con


def get(con, metric, fy):
    r = con.execute(
        "SELECT value, source_tag FROM annual_financials WHERE metric=%s AND fiscal_year=%s", [metric, fy]
    ).fetchone()
    return r


def test_raw_facts_loaded(con):
    assert con.execute("SELECT count(*) FROM facts_raw").fetchone()[0] == 15


def test_tag_switch_and_start_year(con):
    years = [r[0] for r in con.execute(
        "SELECT fiscal_year FROM annual_financials WHERE metric='revenue' ORDER BY 1").fetchall()]
    assert years == [2018, 2019, 2020]  # 2017 excluded


def test_priority_prefers_revenues_over_old_tag(con):
    assert get(con, "revenue", 2018) == (100, "Revenues")


def test_restatement_latest_filing_wins(con):
    assert get(con, "revenue", 2019)[0] == 121


def test_quarterly_values_ignored(con):
    assert get(con, "revenue", 2020)[0] == 150
    assert get(con, "total_assets", 2020)[0] == 600


def test_derived_metrics(con):
    row = con.execute(
        "SELECT gross_profit, gross_margin, revenue_growth, eps_diluted FROM financials WHERE fiscal_year=2020"
    ).fetchone()
    assert row[0] == 70
    assert row[1] == pytest.approx(70 / 150)
    assert row[2] == pytest.approx(150 / 121 - 1)
    assert row[3] == 2.5


def test_idempotent_reload(con):
    facts = facts_to_frame(CO.cik, FACTS)
    load_company(con, CO, "TEST CORP", facts, pd.DataFrame())
    assert con.execute("SELECT count(*) FROM facts_raw").fetchone()[0] == 15
    assert con.execute("SELECT count(*) FROM companies").fetchone()[0] == 1


def test_data_quality_lists_missing(con):
    df = db.query_df(con, "SELECT * FROM data_quality WHERE fiscal_year=2020")
    missing = list(df["missing_metrics"].iloc[0])
    assert "net_income" in missing and "revenue" not in missing


def test_fiscal_year_rules():
    s = pd.Series(["2020-09-26", "2021-01-02", "2025-01-26", "2023-06-30"])
    assert list(fiscal_year_from_end(s)) == [2020, 2020, 2025, 2023]


def test_submissions_filter_and_url():
    page = {
        "accessionNumber": ["0000320193-20-000096", "0000320193-20-000062", "0000320193-17-000070"],
        "form": ["10-K", "10-Q", "10-K"],
        "filingDate": ["2020-10-30", "2020-07-31", "2017-11-03"],
        "reportDate": ["2020-09-26", "2020-06-27", "2017-09-30"],
        "primaryDocument": ["aapl-20200926.htm", "q.htm", "a10-k2017.htm"],
    }
    df = submissions_to_frame(320193, [page], ["10-K", "10-K/A"], 2018)
    assert len(df) == 1
    r = df.iloc[0]
    assert r["fiscal_year"] == 2020
    assert r["url"] == "https://www.sec.gov/Archives/edgar/data/320193/000032019320000096/aapl-20200926.htm"
