"""Download SEC data and load it into the raw tables."""
from __future__ import annotations

import pandas as pd

from .config import Company
from .db import copy_df
from .sec_client import SecClient

ARCHIVES = "https://www.sec.gov/Archives/edgar/data"


def fiscal_year_from_end(end: pd.Series) -> pd.Series:
    """Fiscal year label from a period-end date.

    Uses the calendar year of the period end, except 52/53-week years that spill a few
    days into January (e.g. ends 2021-01-02 -> FY2020). Nvidia (ends late January) keeps
    its own convention: FY2025 ends 2025-01-26.
    """
    end = pd.to_datetime(end)
    spill = (end.dt.month == 1) & (end.dt.day <= 7)
    return (end.dt.year - spill.astype(int)).astype("Int64")


def facts_to_frame(cik: int, facts_json: dict) -> pd.DataFrame:
    rows = []
    for taxonomy, tags in facts_json.get("facts", {}).items():
        for tag, body in tags.items():
            for unit, points in body.get("units", {}).items():
                for p in points:
                    rows.append(
                        (
                            cik, taxonomy, tag, unit,
                            p.get("start"), p["end"], p.get("val"), p.get("accn"),
                            p.get("fy"), p.get("fp"), p.get("form"), p.get("filed"), p.get("frame"),
                        )
                    )
    df = pd.DataFrame(
        rows,
        columns=["cik", "taxonomy", "tag", "unit", "start_date", "end_date", "value",
                 "accession_no", "fy", "fp", "form", "filed", "frame"],
    )
    for c in ("start_date", "end_date", "filed"):
        df[c] = pd.to_datetime(df[c], errors="coerce").dt.date
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    df["fy"] = pd.to_numeric(df["fy"], errors="coerce").astype("Int64")
    return df


def submissions_to_frame(cik: int, pages: list[dict], forms: list[str], start_fy: int) -> pd.DataFrame:
    frames = []
    for page in pages:
        if not page.get("accessionNumber"):
            continue
        frames.append(pd.DataFrame({
            "accession_no": page["accessionNumber"],
            "form": page["form"],
            "filing_date": page["filingDate"],
            "report_date": page["reportDate"],
            "primary_document": page["primaryDocument"],
        }))
    if not frames:
        return pd.DataFrame()
    df = pd.concat(frames, ignore_index=True)
    df = df[df["form"].isin(forms)].copy()
    df["cik"] = cik
    df["filing_date"] = pd.to_datetime(df["filing_date"], errors="coerce")
    df["report_date"] = pd.to_datetime(df["report_date"], errors="coerce")
    df["fiscal_year"] = fiscal_year_from_end(df["report_date"])
    df = df[df["fiscal_year"] >= start_fy]
    df["url"] = [
        f"{ARCHIVES}/{cik}/{a.replace('-', '')}/{doc}"
        for a, doc in zip(df["accession_no"], df["primary_document"])
    ]
    df["filing_date"] = df["filing_date"].dt.date
    df["report_date"] = df["report_date"].dt.date
    return df[["accession_no", "cik", "form", "filing_date", "report_date",
               "fiscal_year", "primary_document", "url"]].drop_duplicates("accession_no")


def ingest_company(con, client: SecClient, company: Company, forms: list[str], start_fy: int) -> dict:
    facts_json = client.company_facts(company.cik10)
    facts = facts_to_frame(company.cik, facts_json)
    filings = submissions_to_frame(company.cik, client.submissions(company.cik10, since_year=start_fy - 1),
                                   forms, start_fy)
    load_company(con, company, facts_json.get("entityName"), facts, filings)
    return {"ticker": company.ticker, "facts": len(facts), "filings": len(filings)}


def load_company(con, company: Company, sec_name: str | None, facts: pd.DataFrame, filings: pd.DataFrame) -> None:
    """Idempotent: replaces everything stored for this company, in one transaction."""
    with con.transaction(), con.cursor() as cur:
        # facts_raw and filings rows go with it (ON DELETE CASCADE)
        cur.execute("DELETE FROM companies WHERE cik = %s OR ticker = %s", [company.cik, company.ticker])
        cur.execute("INSERT INTO companies (cik, ticker, name, sec_name) VALUES (%s, %s, %s, %s)",
                    [company.cik, company.ticker, company.name, sec_name])
        if len(facts):
            copy_df(cur, "facts_raw", facts)
        if len(filings):
            copy_df(cur, "filings", filings)
