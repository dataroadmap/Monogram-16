# MarketLens

Trends and Q&A over company filings. It starts with 10-Ks for 7 big tech companies (FY2018 onward) and is built to grow to more companies and more filing types.

## Roadmap

| Step | What | Status |
|---|---|---|
| 1 | Financial numbers from SEC XBRL → PostgreSQL | ✅ this step |
| 2 | Trend dashboard (Streamlit) | next |
| 3 | Download 10-K text, split by Item (1, 1A, 7, 8) | |
| 4 | Chunk + embed, search tool | |
| 5 | Chatbot: SQL tool + search tool, with citations | |
| 6 | Qualitative trends: risk-factor diffs, term tracking | |
| 7 | Scale: more companies, 10-Q/8-K, Cloud SQL on GCP | |

## Setup (Windows, Anaconda Prompt)

```bat
cd C:\Users\monah\Desktop\2026\dataroadmap\MarketLens
conda create -n marketlens python=3.11 -y
conda activate marketlens
pip install -r requirements.txt
copy .env.example .env
```

Open `.env` and set:
- `SEC_USER_AGENT`: your name and email. The SEC blocks requests that don't include one.
- `DATABASE_URL`: replace `YOUR_PASSWORD` with the password you chose when installing PostgreSQL 18. The `marketlens` database is created automatically.

## Run

```bat
python -m marketlens ingest                      :: download + load + build (about 1 minute)
python -m marketlens summary                     :: revenue table
python -m marketlens summary --metric operating_margin
python -m marketlens quality                     :: which metrics are missing where
python -m pytest -q                              :: tests (need TEST_DATABASE_URL, see below)
```

Downloads are cached in `data/raw/sec/`. Running `ingest` again reuses the cache. Use `--refresh` to pull new filings.
If you edit `config/metrics.yaml`, run `python -m marketlens build` to rebuild the tables without downloading again.

## Database (PostgreSQL, database `marketlens`)

| Table / view | Grain | Use |
|---|---|---|
| `companies` | company | ticker, CIK, name |
| `filings` | filing | 10-K / 10-K/A index with document URLs (used by step 3) |
| `facts_raw` | XBRL fact | every fact the SEC has for the company, all forms, all years |
| `metric_map` | metric × tag | from `config/metrics.yaml` |
| `annual_financials` | company × year × metric | clean long table + source tag and filing (for citations) |
| `financials` (view) | company × year | wide table + margins, growth, FCF |
| `data_quality` (view) | company × year | raw metrics with no value |

You can browse it in pgAdmin (installed with PostgreSQL) under Databases → marketlens → Schemas → public, or query it from Python:

```python
import os, pandas as pd, psycopg
from dotenv import load_dotenv
load_dotenv()
con = psycopg.connect(os.environ["DATABASE_URL"])
pd.read_sql("SELECT ticker, fiscal_year, revenue/1e9 AS rev_b, operating_margin FROM financials", con)
```

Tests use a separate throwaway database, and they wipe it on every run. Add this line to `.env`:
`TEST_DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/marketlens_test`

## How the numbers are cleaned

- **Annual only:** duration facts must span 350–380 days and come from a 10-K or 10-K/A. Quarterly and Q4-only values are dropped.
- **Restatements:** each value appears in up to three 10-Ks. The most recently filed one is kept.
- **Tag changes:** each metric lists tags in priority order, and the first tag with a value wins for each year. `source_tag` records which tag was used.
- **Fiscal year:** taken from the period-end date. Apple's ends in September, Microsoft's in June and Nvidia's in late January (Nvidia's FY2025 ends Jan 2025).
- **Derived values:** gross profit is revenue minus cost of revenue when the company doesn't tag it (Amazon, Alphabet, Meta). Free cash flow is operating cash flow minus capex.

### Known caveats
- Amazon doesn't report R&D. `rnd_expense` falls back to Technology & content / Technology & infrastructure.
- `data_quality` lists `gross_profit` as missing for companies where it is derived. That is expected.
- Always sanity-check a new company against its 10-K the first time. Run `quality`, then look at `source_tag` in `annual_financials`.

## Adding companies

Add an entry to `config/companies.yaml` (ticker, name, CIK), then run `python -m marketlens ingest --tickers NEWTICKER`.

## Project layout

```
config/          companies.yaml, metrics.yaml
marketlens/      sec_client.py (EDGAR + cache), ingest.py, transform.py, db.py, __main__.py (CLI)
tests/           pipeline tests with synthetic SEC data
data/            (git-ignored) raw SEC download cache
```
