"""
Step 3: Download the 10-K documents themselves (the unstructured text).

ingest_edgar.py already saved, for each company, data/raw/<TICKER>/10k_filings_index.json:
the list of 10-K filings with their accession number and main document name.
This script reads that list and downloads each 10-K's HTML document from EDGAR:

    data/raw/AAPL/10k/AAPL_2025-09-27_10-K.htm
    data/raw/AAPL/10k/AAPL_2024-09-28_10-K.htm
    ...

The date in the file name is the end of the fiscal year the report covers.
Files that are already on disk are skipped, so re-runs are cheap.

Run ingest_edgar.py first, then:
    python src/download_10k_html.py
"""

import json
import time
from pathlib import Path

import requests

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from config.companies import COMPANIES, SEC_USER_AGENT

RAW_DIR = Path(__file__).resolve().parent.parent / "data" / "raw"
HEADERS = {"User-Agent": SEC_USER_AGENT}
ARCHIVES = "https://www.sec.gov/Archives/edgar/data"

# SEC asks for max ~10 requests/second; we go well under that to be safe.
REQUEST_DELAY_SECONDS = 0.3


def document_url(cik: str, accession_number: str, primary_document: str) -> str:
    """EDGAR address of a filing's main document.
    The CIK goes in without leading zeros, the accession number without dashes."""
    return f"{ARCHIVES}/{int(cik)}/{accession_number.replace('-', '')}/{primary_document}"


def download(url: str, path: Path) -> int:
    """Download one document to path and return its size in bytes."""
    resp = requests.get(url, headers=HEADERS, timeout=60)
    resp.raise_for_status()
    time.sleep(REQUEST_DELAY_SECONDS)
    path.write_bytes(resp.content)
    return len(resp.content)


def download_company(ticker: str, info: dict) -> tuple[int, int]:
    """Download every 10-K in the company's index. Returns (downloaded, skipped)."""
    index_file = RAW_DIR / ticker / "10k_filings_index.json"
    if not index_file.exists():
        print(f"[{ticker}] no 10k_filings_index.json yet - run src/ingest_edgar.py first")
        return 0, 0

    filings = json.loads(index_file.read_text())
    out_dir = RAW_DIR / ticker / "10k"
    out_dir.mkdir(parents=True, exist_ok=True)

    downloaded = skipped = 0
    for filing in filings:
        path = out_dir / f"{ticker}_{filing['reportDate']}_10-K.htm"
        if path.exists():
            skipped += 1
            continue
        url = document_url(info["cik"], filing["accessionNumber"], filing["primaryDocument"])
        try:
            size = download(url, path)
            downloaded += 1
            print(f"[{ticker}] saved {path.name} ({size / 1e6:.1f} MB)")
        except requests.HTTPError as e:
            print(f"[{ticker}] ERROR {filing['reportDate']}: {e}")
    return downloaded, skipped


def main():
    total_downloaded = total_skipped = 0
    for ticker, info in COMPANIES.items():
        downloaded, skipped = download_company(ticker, info)
        total_downloaded += downloaded
        total_skipped += skipped
        print(f"[{ticker}] {downloaded} downloaded, {skipped} already on disk")
        print("-" * 60)
    print(f"Done: {total_downloaded} downloaded, {total_skipped} already on disk.")


if __name__ == "__main__":
    main()
