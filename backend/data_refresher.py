"""
Centralized data refresh utilities.

Refreshes:
- top_stocks_list.json (daily)
- fomc_meetings.json (30-day interval)
- government_shutdowns.json (30-day interval)
- commodities_supply.json (30-day interval)
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta
from pathlib import Path

import requests
from typing import Any
from bs4 import BeautifulSoup
from bs4.element import Tag
import yfinance as yf

from logger import setup_logger


logger = setup_logger("data_refresher")

DATA_DIR = Path(__file__).parent / "data"

# Cache/data files
# Cache file for all S&P 500 stocks sorted by market cap (from SlickCharts)
# This file contains all ~503 stocks in market cap order, not just top 30
# Note: filename is "top_stocks_list.json" for legacy reasons but contains all stocks
SP500_MARKETCAP_ORDER_FILE = DATA_DIR / "top_stocks_list.json"
# Legacy name kept for backwards compatibility
TOP_30_CACHE_FILE = SP500_MARKETCAP_ORDER_FILE
FOMC_FILE = DATA_DIR / "fomc_meetings.json"
SHUTDOWNS_FILE = DATA_DIR / "government_shutdowns.json"
SUPPLY_FILE = DATA_DIR / "commodities_supply.json"

# Timestamp files
TOP_30_TIMESTAMP_FILE = DATA_DIR / "refresh_stock_timestamp.txt"
FOMC_TIMESTAMP_FILE = DATA_DIR / "refresh_fomc_timestamp.txt"
SHUTDOWNS_TIMESTAMP_FILE = DATA_DIR / "refresh_shutdowns_timestamp.txt"
SUPPLY_TIMESTAMP_FILE = DATA_DIR / "refresh_commodities_timestamp.txt"

# Update intervals
DAILY_INTERVAL_DAYS = 1
MONTHLY_INTERVAL_DAYS = 30

# Asset detail page auto-refresh configuration
# NOTE: ASSET_PAGE_REFRESH_MINUTES must be kept in sync with AUTO_REFRESH_INTERVAL in
#       src/hooks/useAutoRefreshCountdown.ts (frontend uses milliseconds: 3 * 60 * 1000)
ASSET_PAGE_REFRESH_MINUTES = 3   # How often to auto-refresh the asset detail page (for homepage it's defined in useAutoRefreshCountdown.ts)
ASSET_PAGE_REFRESH_CANDLES = 3   # Number of recent candles to fetch on each refresh

# TwelveData API configuration for asset detail page
# The /statistics endpoint requires a Pro plan ($29/mo+). On the free plan, this call
# always fails but still consumes 1 API credit. Set to False to skip it and save credits.
# When False, statistics data (shares outstanding, avg volume) comes from yfinance instead.
# When True, attempts TwelveData first, falls back to yfinance on failure.
STATISTICS_ASSET_PAGE_TWELVEDATA = False

REQUEST_HEADERS = {
    "User-Agent": "assets-market-cap/1.0 (https://github.com/)"
}

# Fallback list in case of complete failure (approximate top 30 by market cap)
FALLBACK_TOP_30 = [
    "NVDA", "AAPL", "MSFT", "AMZN", "GOOGL", "META", "AVGO", "TSLA", "BRK-B",
    "WMT", "LLY", "JPM", "V", "XOM", "JNJ", "ORCL", "MA", "COST", "HD",
    "PG", "ABBV", "BAC", "NFLX", "CVX", "KO", "MRK", "CRM", "PEP", "AMD", "UNH",
]

METAL_MARKETCAP_SOURCES = {
    "XAU": {
        "slug": "gold",
        "price_ticker": "GC=F",
        "unit": "troy_ounces",
    },
    "XAG": {
        "slug": "silver",
        "price_ticker": "SI=F",
        "unit": "troy_ounces",
    },
    "XPT": {
        "slug": "platinum",
        "price_ticker": "PL=F",
        "unit": "troy_ounces",
    },
    "XPD": {
        "slug": "palladium",
        "price_ticker": "PA=F",
        "unit": "troy_ounces",
    },
    "HG": {
        "slug": "copper",
        "price_ticker": "HG=F",
        "unit": "lbs",
    },
}


def _parse_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        pass
    try:
        return datetime.strptime(value.split("T")[0], "%Y-%m-%d")
    except ValueError:
        return None


def _read_timestamp(path: Path) -> datetime | None:
    if not path.exists():
        return None
    try:
        return _parse_timestamp(path.read_text().strip())
    except Exception as exc:
        logger.error(f"Error reading timestamp file {path}: {exc}")
        return None


def _write_timestamp(path: Path) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
        path.write_text(timestamp)
        logger.info(f"Updated timestamp: {path} -> {timestamp}")
    except Exception as exc:
        logger.error(f"Error writing timestamp file {path}: {exc}")


def _needs_refresh(path: Path, interval_days: int) -> bool:
    timestamp = _read_timestamp(path)
    if timestamp is None:
        logger.info(f"No timestamp file found at {path}, refresh needed")
        return True
    if datetime.now() - timestamp >= timedelta(days=interval_days):
        logger.info(f"Timestamp older than {interval_days} days, refresh needed")
        return True
    return False


def _read_json(path: Path) -> dict | list | None:
    if not path.exists():
        return None
    try:
        with path.open("r") as f:
            return json.load(f)
    except Exception as exc:
        logger.error(f"Error reading JSON {path}: {exc}")
        return None


def _as_dict(data: dict | list | None) -> dict:
    if isinstance(data, dict):
        return data
    return {}


def _as_list(data: dict | list | None) -> list:
    if isinstance(data, list):
        return data
    return []


def _write_json(path: Path, data: dict | list) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w") as f:
            json.dump(data, f, indent=2)
    except Exception as exc:
        logger.error(f"Error writing JSON {path}: {exc}")


def _fetch_sp500_from_slickcharts() -> list[str]:
    """Fetch all S&P 500 stocks from SlickCharts, sorted by market cap (weight).
    
    SlickCharts lists S&P 500 companies sorted by their index weight,
    which correlates directly with market cap. This gives us all ~503
    stocks in market cap descending order.
    
    Returns:
        List of ticker symbols in market cap order (highest to lowest)
    """
    logger.info("Fetching S&P 500 stocks from SlickCharts (sorted by market cap)...")
    url = "https://www.slickcharts.com/sp500"
    response = requests.get(url, headers=REQUEST_HEADERS, timeout=15)
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "html.parser")
    table = soup.find("table", class_="table")
    if not table:
        raise ValueError("Could not find S&P 500 table on SlickCharts")

    # Get all rows (skip header row) - SlickCharts lists all ~503 stocks
    rows = table.find_all("tr")[1:]
    symbols = []
    for row in rows:
        cols = row.find_all("td")
        if len(cols) >= 3:
            # Column 3 contains the ticker symbol
            symbol = cols[2].text.strip().replace(".", "-")
            symbols.append(symbol)
    
    logger.info(f"Fetched {len(symbols)} stocks from SlickCharts in market cap order")
    return symbols


def read_cached_sp500_marketcap_order() -> list[str] | None:
    """Read cached S&P 500 stocks in market cap order."""
    data = _read_json(SP500_MARKETCAP_ORDER_FILE)
    if isinstance(data, list) and data:
        return data
    return None


def write_cached_sp500_marketcap_order(tickers: list[str]) -> None:
    """Write S&P 500 stocks in market cap order to cache."""
    _write_json(SP500_MARKETCAP_ORDER_FILE, tickers)


# Alias for backwards compatibility
read_cached_top_30 = read_cached_sp500_marketcap_order
write_cached_top_30 = write_cached_sp500_marketcap_order


def refresh_sp500_marketcap_order() -> list[str]:
    """Refresh the S&P 500 stocks list sorted by market cap.
    
    Fetches from SlickCharts daily. The list contains all ~503 S&P 500
    stocks in market cap (weight) descending order.
    
    Also forces a refresh if the cached list has fewer than 100 stocks,
    which indicates a stale/incomplete cache (e.g., from before the
    refactor that expanded from top-30 to all S&P 500 stocks).
    
    Returns:
        List of ticker symbols in market cap order
    """
    # Check if cached list is suspiciously small (stale cache from before refactor)
    cached = read_cached_sp500_marketcap_order()
    cache_is_undersized = cached is not None and len(cached) < 100
    if cache_is_undersized:
        logger.warning(
            f"Cached S&P 500 list only has {len(cached)} stocks (expected ~503), "
            "forcing refresh regardless of timestamp"
        )

    if _needs_refresh(TOP_30_TIMESTAMP_FILE, DAILY_INTERVAL_DAYS) or cache_is_undersized:
        try:
            stocks = _fetch_sp500_from_slickcharts()
            if len(stocks) >= 100:  # Sanity check - S&P 500 should have ~503 stocks
                write_cached_sp500_marketcap_order(stocks)
                _write_timestamp(TOP_30_TIMESTAMP_FILE)
                logger.info(f"Cached {len(stocks)} S&P 500 stocks in market cap order")
                return stocks
            logger.warning(f"Only got {len(stocks)} tickers, using cache/fallback")
        except Exception as exc:
            logger.error(f"Error fetching S&P 500 from SlickCharts: {exc}")

    if cached:
        logger.info(f"Using cached S&P 500 market cap order: {len(cached)} tickers")
        return cached

    logger.warning("Using fallback hardcoded list (top 30 only)")
    return FALLBACK_TOP_30


# Alias for backwards compatibility  
refresh_top_30_stocks = refresh_sp500_marketcap_order


def get_sp500_marketcap_order() -> list[str]:
    """Get S&P 500 stocks in market cap order (refreshes if needed)."""
    return refresh_sp500_marketcap_order()


# Alias for backwards compatibility
get_top_30_tickers = get_sp500_marketcap_order


def _parse_fomc_meetings(html: str) -> list[str]:
    soup = BeautifulSoup(html, "html.parser")
    meetings = []

    for month_el in soup.select(".fomc-meeting__month"):
        month = month_el.get_text(strip=True)
        date_el = month_el.find_next(class_="fomc-meeting__date")
        if not date_el:
            continue
        date_text = date_el.get_text(strip=True)
        start_day = date_text.split("-")[0]

        year = None
        for prev in month_el.find_all_previous(["h2", "h3", "h4"]):
            text = prev.get_text(strip=True)
            if "FOMC Meetings" in text:
                year_match = re.search(r"(\d{4})", text)
                if year_match:
                    year = int(year_match.group(1))
                    break

        if not year:
            continue

        try:
            dt = datetime.strptime(f"{year} {month} {start_day}", "%Y %B %d")
            meetings.append(dt.strftime("%Y-%m-%d"))
        except ValueError:
            continue

    return sorted(set(meetings))


def refresh_fomc_meetings(interval_days: int = MONTHLY_INTERVAL_DAYS) -> bool:
    if not _needs_refresh(FOMC_TIMESTAMP_FILE, interval_days):
        return False

    try:
        url = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm"
        response = requests.get(url, headers=REQUEST_HEADERS, timeout=20)
        response.raise_for_status()
        meetings = _parse_fomc_meetings(response.text)

        existing = _as_dict(_read_json(FOMC_FILE))
        existing_meetings = _as_list(existing.get("meetings", []))
        if meetings and meetings != existing_meetings:
            data = {
                "_comment": "FOMC (Federal Open Market Committee) meeting dates. The Fed announces rate decisions at the end of each meeting.",
                "_source": "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
                "_last_updated": datetime.now().strftime("%Y-%m-%d"),
                "meetings": meetings,
            }
            _write_json(FOMC_FILE, data)
            logger.info(f"Updated FOMC meetings: {len(meetings)} dates")

        _write_timestamp(FOMC_TIMESTAMP_FILE)
        return True
    except Exception as exc:
        logger.error(f"Error refreshing FOMC meetings: {exc}")
        return False


def _fetch_wikipedia_parse(page: str) -> dict | None:
    url = "https://en.wikipedia.org/w/api.php"
    params = {
        "action": "parse",
        "page": page,
        "prop": "text",
        "format": "json",
        "formatversion": 2,
    }
    response = requests.get(url, params=params, headers=REQUEST_HEADERS, timeout=20)
    response.raise_for_status()
    return response.json().get("parse")


def _parse_shutdown_dates(infobox: Tag) -> tuple[str | None, str | None]:
    date_row = None
    for row in infobox.find_all("tr"):
        header = row.find("th")
        if not header:
            continue
        key = header.get_text(" ", strip=True).lower()
        if key in {"date", "dates"}:
            date_row = row
            break

    if not date_row:
        return None, None

    date_text = date_row.get_text(" ", strip=True)
    iso_matches = re.findall(r"(\d{4}-\d{2}-\d{2})", date_text)
    if len(iso_matches) >= 2:
        return iso_matches[0], iso_matches[1]
    if len(iso_matches) == 1:
        return iso_matches[0], iso_matches[0]

    return None, None


def _parse_shutdown_page(page: str) -> tuple[str | None, str | None, str | None]:
    parsed = _fetch_wikipedia_parse(page)
    if not parsed:
        return None, None, None

    html = parsed.get("text", "")
    soup = BeautifulSoup(html, "html.parser")
    infobox = soup.find("table", class_="infobox")
    if not infobox:
        return None, None, parsed.get("title")

    start_date, end_date = _parse_shutdown_dates(infobox)
    return start_date, end_date, parsed.get("title")


def refresh_government_shutdowns(interval_days: int = MONTHLY_INTERVAL_DAYS) -> bool:
    if not _needs_refresh(SHUTDOWNS_TIMESTAMP_FILE, interval_days):
        return False

    try:
        parsed = _fetch_wikipedia_parse("Government_shutdowns_in_the_United_States")
        if not parsed:
            raise ValueError("No parsed data from Wikipedia")

        soup = BeautifulSoup(parsed.get("text", ""), "html.parser")
        caption = None
        for cap in soup.find_all("caption"):
            text = cap.get_text(" ", strip=True)
            if "Overview of shutdowns involving furloughs" in text:
                caption = cap
                break
        if not caption:
            raise ValueError("Shutdowns table not found")

        table = caption.find_parent("table")
        if not table:
            raise ValueError("Could not find parent table for caption")
        rows = table.find_all("tr")

        existing = _as_dict(_read_json(SHUTDOWNS_FILE))
        shutdowns = _as_list(existing.get("shutdowns", []))
        latest_start = max((s.get("start_date", "") for s in shutdowns if isinstance(s, dict)), default="")

        new_entries = []
        for row in rows[1:]:
            cells = row.find_all(["th", "td"])
            if not cells:
                continue
            first_text = cells[0].get_text(" ", strip=True)
            if first_text in {"Senate", "House"}:
                continue
            link = cells[0].find("a")
            if not link:
                continue

            href = link.get("href")
            if not href or isinstance(href, list):
                continue
            page = str(href).replace("/wiki/", "")
            if not page:
                continue

            start_date, end_date, title = _parse_shutdown_page(page)
            if not start_date:
                continue

            if latest_start and start_date <= latest_start:
                continue

            days_text = cells[1].get_text(" ", strip=True) if len(cells) > 1 else ""
            days_match = re.search(r"(\d+)", days_text)
            days = int(days_match.group(1)) if days_match else 0
            president = cells[5].get_text(" ", strip=True) if len(cells) > 5 else ""

            shutdown_id = f"shutdown_{page.lower()}"
            shutdown_id = re.sub(r"[^a-z0-9]+", "_", shutdown_id).strip("_")

            new_entries.append({
                "id": shutdown_id,
                "start_date": start_date,
                "end_date": end_date or start_date,
                "title": title or first_text,
                "description": f"{days}-day shutdown under {president}.".strip(),
                "days": days,
                "president": president,
            })

        if new_entries:
            shutdowns.extend(new_entries)
            metadata = _as_dict(existing.get("_metadata", {}))
            metadata["last_updated"] = datetime.now().strftime("%Y-%m-%d")
            metadata.setdefault(
                "source",
                "https://en.wikipedia.org/wiki/Government_shutdowns_in_the_United_States",
            )
            metadata.setdefault(
                "description",
                "U.S. Government Shutdowns that resulted in employee furloughs",
            )
            metadata.setdefault(
                "notes",
                "Only includes shutdowns that caused federal employee furloughs. Update this file when new shutdowns occur.",
            )
            _write_json(SHUTDOWNS_FILE, {"_metadata": metadata, "shutdowns": shutdowns})
            logger.info(f"Added {len(new_entries)} new shutdown entries")

        _write_timestamp(SHUTDOWNS_TIMESTAMP_FILE)
        return True
    except Exception as exc:
        logger.error(f"Error refreshing government shutdowns: {exc}")
        return False


def _parse_market_cap_value(text: str) -> float | None:
    match = re.search(r"\$\s*([\d,.]+)\s*([TBM])", text)
    if not match:
        return None
    value = float(match.group(1).replace(",", ""))
    unit = match.group(2)
    multiplier = {"T": 1e12, "B": 1e9, "M": 1e6}.get(unit)
    if not multiplier:
        return None
    return value * multiplier


def _fetch_market_cap(slug: str) -> tuple[float | None, str | None]:
    url = f"https://companiesmarketcap.com/{slug}/marketcap/"
    try:
        response = requests.get(url, headers=REQUEST_HEADERS, timeout=20)
    except requests.RequestException as exc:
        logger.warning(f"Error fetching market cap for {slug}: {exc}")
        return None, None

    if response.status_code != 200:
        logger.warning(f"Market cap page unavailable for {slug}: {response.status_code}")
        return None, None

    soup = BeautifulSoup(response.text, "html.parser")
    market_text = None
    for h2 in soup.find_all("h2"):
        text = h2.get_text(" ", strip=True)
        if re.search(r"Estimated Market Cap", text, re.I):
            market_text = text
            break
    if not market_text:
        return None, None
    return _parse_market_cap_value(market_text), market_text


def _fetch_price(ticker: str) -> float | None:
    try:
        info = yf.Ticker(ticker).info
        return info.get("regularMarketPrice") or info.get("previousClose")
    except Exception:
        return None


def refresh_commodities_supply(interval_days: int = MONTHLY_INTERVAL_DAYS) -> bool:
    if not _needs_refresh(SUPPLY_TIMESTAMP_FILE, interval_days):
        return False

    existing = _as_dict(_read_json(SUPPLY_FILE))
    updated = dict(existing)
    updated["_comment"] = (
        "Above-ground supply estimates for precious metals. Used to calculate market cap: price × supply"
    )
    updated["_last_updated"] = datetime.now().strftime("%Y-%m-%d")
    updated["_update_frequency"] = "Refresh every 30 days from CompaniesMarketCap and current price APIs."

    refreshed_any = False
    for symbol, config in METAL_MARKETCAP_SOURCES.items():
        try:
            market_cap, market_cap_text = _fetch_market_cap(config["slug"])
            price = _fetch_price(config["price_ticker"])
            if not market_cap or not price:
                logger.warning(
                    f"Unable to refresh supply for {symbol} (market cap or price missing)"
                )
                continue

            supply = int(round(market_cap / price))
            entry = updated.get(symbol, {})
            entry.update({
                "supply": supply,
                "unit": config["unit"],
                "source": "CompaniesMarketCap (market cap) + Yahoo Finance (price)",
                "notes": f"Derived supply from {market_cap_text} and price {price}.",
            })
            updated[symbol] = entry
            refreshed_any = True
        except Exception as exc:
            logger.error(f"Error refreshing supply for {symbol}: {exc}")
            continue

    if refreshed_any:
        _write_json(SUPPLY_FILE, updated)
        logger.info("Updated commodities supply data")

    _write_timestamp(SUPPLY_TIMESTAMP_FILE)
    return True


def refresh_all_data() -> None:
    try:
        refresh_top_30_stocks()
    except Exception as exc:
        logger.error(f"Top 30 refresh failed: {exc}")
    try:
        refresh_fomc_meetings()
    except Exception as exc:
        logger.error(f"FOMC refresh failed: {exc}")
    try:
        refresh_government_shutdowns()
    except Exception as exc:
        logger.error(f"Shutdowns refresh failed: {exc}")
    try:
        refresh_commodities_supply()
    except Exception as exc:
        logger.error(f"Commodities refresh failed: {exc}")
