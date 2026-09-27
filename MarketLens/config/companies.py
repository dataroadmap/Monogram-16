"""
Target company universe for MarketLens.
CIK = SEC's Central Index Key, the stable ID EDGAR uses (not ticker).
10-digit, zero-padded — required format for API calls.
"""

COMPANIES = {
    "AAPL": {"name": "Apple Inc.", "cik": "0000320193"},
    "MSFT": {"name": "Microsoft Corporation", "cik": "0000789019"},
    "GOOGL": {"name": "Alphabet Inc.", "cik": "0001652044"},
    "AMZN": {"name": "Amazon.com, Inc.", "cik": "0001018724"},
    "META": {"name": "Meta Platforms, Inc.", "cik": "0001326801"},
    "NVDA": {"name": "NVIDIA Corporation", "cik": "0001045810"},
    "TSLA": {"name": "Tesla, Inc.", "cik": "0001318605"},
}

START_FISCAL_YEAR = 2018

# SEC requires a descriptive User-Agent with contact info on every request,
# or it will block you. Replace with your real name/email before running.
SEC_USER_AGENT = "MarketLens research tool dataroadmap@gmail.com"
