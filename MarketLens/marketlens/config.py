"""Project paths and settings."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

import yaml
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = ROOT / "config"
DATA_DIR = ROOT / "data"
RAW_DIR = DATA_DIR / "raw" / "sec"

load_dotenv(ROOT / ".env")


def database_url() -> str:
    url = os.getenv("DATABASE_URL", "").strip()
    if not url:
        raise SystemExit(
            "DATABASE_URL is not set. In .env add e.g.\n"
            "  DATABASE_URL=postgresql://postgres:<your-password>@localhost:5432/marketlens"
        )
    return url


@dataclass(frozen=True)
class Company:
    ticker: str
    name: str
    cik: int

    @property
    def cik10(self) -> str:
        """CIK zero-padded to 10 digits, as the SEC APIs expect."""
        return f"{self.cik:010d}"


def load_companies() -> tuple[list[Company], int, list[str]]:
    cfg = yaml.safe_load((CONFIG_DIR / "companies.yaml").read_text())
    companies = [Company(c["ticker"], c["name"], int(c["cik"])) for c in cfg["companies"]]
    return companies, int(cfg.get("start_fiscal_year", 2018)), list(cfg.get("forms", ["10-K", "10-K/A"]))


def load_metrics() -> dict:
    return yaml.safe_load((CONFIG_DIR / "metrics.yaml").read_text())["metrics"]


def sec_user_agent() -> str:
    ua = os.getenv("SEC_USER_AGENT", "").strip()
    if not ua or "@" not in ua:
        raise SystemExit(
            "SEC_USER_AGENT is not set. Copy .env.example to .env and set it to "
            "'<Your Name> <your-email>' (the SEC requires this)."
        )
    return ua
