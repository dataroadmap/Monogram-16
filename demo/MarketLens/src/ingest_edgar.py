"""
Step 2-3: Pull each company's filing history and structured XBRL facts
from SEC EDGAR's free JSON APIs, and cache the raw responses locally.

Run this first, before any parsing/DB loading. It never touches Postgres -
its only job is to get raw SEC data safely onto disk in data/raw/, so
re-runs are cheap and you never re-hit the SEC API unnecessarily.

Usage:
    python src/ingest_edgar.py
"""

import json
import time
from pathlib import Path

import requests

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from config.companies import COMPANIES, START_FISCAL_YEAR, SEC_USER_AGENT

RAW_DIR = Path(__file__).resolve().parent.parent / "data" / "raw"
HEADERS = {"User-Agent": SEC_USER_AGENT}

# SEC asks for max ~10 requests/second; we go well under that to be safe.
REQUEST_DELAY_SECONDS = 0.3


def fetch_json(url: str) -> dict:
    resp = requests.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    time.sleep(REQUEST_DELAY_SECONDS)
    return resp.json()


def fetch_submissions(cik: str) -> dict:
    """Full filing history for a company, including form types and dates."""
    url = f"https://data.sec.gov/submissions/CIK{cik}.json"
    return fetch_json(url)


def fetch_company_facts(cik: str) -> dict:
    """All XBRL-tagged structured financial facts ever reported by this company."""
    url = f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"
    return fetch_json(url)


def fetch_additional_filing_pages(submissions: dict, cik: str) -> list[dict]:
    """The 'recent' block only holds a company's most recent ~1000 filings.
    Companies with lots of filing history (8-Ks, proxies, etc.) have older
    filings split into extra paginated JSON files listed here. Fetch and
    return those pages' filing arrays so nothing older gets missed."""
    extra_pages = []
    older_files = submissions["filings"].get("files", [])
    for file_ref in older_files:
        url = f"https://data.sec.gov/submissions/{file_ref['name']}"
        page = fetch_json(url)
        extra_pages.append(page)
    return extra_pages


def filter_10k_filings(submissions: dict, extra_pages: list[dict], start_year: int) -> list[dict]:
    """Pull out just the 10-K filings from the full submissions history
    (recent + any older paginated files), keeping fiscal year >= start_year."""
    blocks = [submissions["filings"]["recent"]] + extra_pages
    results = []
    for block in blocks:
        for i, form in enumerate(block["form"]):
            if form != "10-K":
                continue
            filing_date = block["filingDate"][i]
            fiscal_year = int(filing_date[:4])
            if fiscal_year < start_year:
                continue
            results.append({
                "accessionNumber": block["accessionNumber"][i],
                "filingDate": filing_date,
                "reportDate": block["reportDate"][i],
                "primaryDocument": block["primaryDocument"][i],
            })
    # De-dupe in case of any overlap between pages
    seen = set()
    deduped = []
    for r in results:
        if r["accessionNumber"] not in seen:
            seen.add(r["accessionNumber"])
            deduped.append(r)
    return deduped


def ingest_company(ticker: str, info: dict) -> None:
    cik = info["cik"]
    out_dir = RAW_DIR / ticker
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"[{ticker}] fetching submissions index...")
    submissions = fetch_submissions(cik)
    (out_dir / "submissions.json").write_text(json.dumps(submissions, indent=2))

    extra_pages = fetch_additional_filing_pages(submissions, cik)
    filings = filter_10k_filings(submissions, extra_pages, START_FISCAL_YEAR)
    (out_dir / "10k_filings_index.json").write_text(json.dumps(filings, indent=2))
    print(f"[{ticker}] found {len(filings)} 10-K filings since {START_FISCAL_YEAR}")

    print(f"[{ticker}] fetching company facts (XBRL structured data)...")
    facts = fetch_company_facts(cik)
    (out_dir / "companyfacts.json").write_text(json.dumps(facts, indent=2))
    print(f"[{ticker}] done. Saved to {out_dir}")


def main():
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    for ticker, info in COMPANIES.items():
        try:
            ingest_company(ticker, info)
        except requests.HTTPError as e:
            print(f"[{ticker}] ERROR: {e}")
        print("-" * 60)


if __name__ == "__main__":
    main()
