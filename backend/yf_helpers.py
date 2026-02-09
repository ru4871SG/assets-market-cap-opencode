"""
yfinance Retry Helpers

Provides retry logic with exponential backoff for yfinance calls,
and a staggered ThreadPoolExecutor that adds small delays between
task submissions to avoid overwhelming Yahoo Finance's servers.

The curl_cffi transport used by yfinance >= 0.2.40 has a hard 30s 
timeout that can't be configured from user code. These helpers mitigate
transient failures by retrying and spreading out concurrent requests.
"""

import time
import yfinance as yf
from concurrent.futures import ThreadPoolExecutor, as_completed
from logger import setup_logger

logger = setup_logger('yf_helpers')


class EmptyHistoryError(Exception):
    """Raised when yfinance returns empty history data after all retries.
    
    This typically happens for international stocks during off-market hours,
    delisted symbols, or stocks with limited intraday data availability.
    """
    def __init__(self, symbol: str, message: str | None = None):
        self.symbol = symbol
        self.user_message = (
            f"We have tried to fetch historical data for {symbol}, but the API data source "
            "returned empty history. This can happen for international stocks outside trading hours "
            "or stocks with limited data availability. Check again when market reopens for this asset."
        )
        super().__init__(message if message else f"Empty history returned for {symbol}")


def yf_ticker_with_retry(symbol, max_retries=3, base_delay=2.0):
    """
    Create a yfinance Ticker and access .info with retry + exponential backoff.
    
    Returns (ticker_obj, info_dict) on success.
    Raises the last exception if all retries fail.
    
    Args:
        symbol: Yahoo Finance ticker symbol (e.g., 'AAPL', 'GC=F', 'BTC-USD')
        max_retries: Maximum number of attempts (default 3)
        base_delay: Base delay in seconds, doubled each retry (default 2.0)
    """
    last_error: Exception = Exception(f"Failed to fetch ticker info for {symbol}")
    for attempt in range(max_retries):
        try:
            ticker_obj = yf.Ticker(symbol)
            info = ticker_obj.info
            # Verify we got real data (yfinance can return empty dicts silently)
            if info and len(info) > 1:
                return ticker_obj, info
            # Treat empty/minimal info as a soft failure worth retrying
            last_error = Exception(f"Empty info returned for {symbol}")
        except Exception as e:
            last_error = e
        
        if attempt < max_retries - 1:
            delay = base_delay * (2 ** attempt)
            logger.warning(
                f"yfinance retry {attempt + 1}/{max_retries} for {symbol} "
                f"(waiting {delay:.1f}s): {last_error}"
            )
            time.sleep(delay)
    
    raise last_error


# Retry configuration for empty history (longer delay to wait for market data)
EMPTY_HISTORY_MAX_RETRIES = 2  # 2 attempts total (initial + 1 retry)
EMPTY_HISTORY_RETRY_DELAY = 60.0  # 60 seconds between retries


def yf_history_with_retry(ticker_obj, max_retries=3, base_delay=2.0, **kwargs):
    """
    Call ticker_obj.history() with retry + exponential backoff.
    
    Returns the history DataFrame on success.
    Raises EmptyHistoryError if yfinance returns empty history after retries.
    Raises other exceptions for network/API errors.
    
    For empty history (common with international stocks), uses longer delay (60s)
    and fewer retries (2 total) since it's often a data availability issue.
    
    Args:
        ticker_obj: A yfinance Ticker object
        max_retries: Maximum number of attempts for non-empty-history errors (default 3)
        base_delay: Base delay in seconds, doubled each retry (default 2.0)
        **kwargs: Passed directly to ticker_obj.history() (e.g., period='1y', interval='1d')
    """
    symbol = getattr(ticker_obj, 'ticker', '?')
    last_error: Exception = Exception(f"Failed to fetch history for {symbol}")
    empty_history_attempts = 0
    
    for attempt in range(max_retries):
        try:
            hist = ticker_obj.history(**kwargs)
            if hist is not None and not hist.empty:
                return hist
            
            # Empty history case - use special retry logic
            empty_history_attempts += 1
            if empty_history_attempts >= EMPTY_HISTORY_MAX_RETRIES:
                # No more retries for empty history - raise user-friendly error
                raise EmptyHistoryError(symbol)
            
            # Longer delay for empty history (60s)
            logger.warning(
                f"[yf_helpers] yfinance history retry {empty_history_attempts}/{EMPTY_HISTORY_MAX_RETRIES} for {symbol} "
                f"(waiting {EMPTY_HISTORY_RETRY_DELAY:.0f}s): Empty history returned for {symbol}"
            )
            time.sleep(EMPTY_HISTORY_RETRY_DELAY)
            continue  # Skip the normal retry logic below
            
        except EmptyHistoryError:
            # Re-raise EmptyHistoryError (don't catch and retry)
            raise
        except Exception as e:
            last_error = e
        
        if attempt < max_retries - 1:
            delay = base_delay * (2 ** attempt)
            logger.warning(
                f"[yf_helpers] yfinance history retry {attempt + 1}/{max_retries} for {symbol} "
                f"(waiting {delay:.1f}s): {last_error}"
            )
            time.sleep(delay)
    
    raise last_error


def staggered_executor(fn, items, max_workers=10, stagger_delay=0.3):
    """
    Run a function across items using ThreadPoolExecutor with a small stagger
    delay between each task submission to avoid overwhelming Yahoo Finance.
    
    Args:
        fn: Callable that takes a single item and returns a result (or None to skip)
        items: Iterable of items to process
        max_workers: Maximum concurrent workers (default 10)
        stagger_delay: Seconds to wait between submitting each task (default 0.3)
    
    Returns:
        List of non-None results (unordered)
    """
    results = []
    items_list = list(items)
    
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {}
        for item in items_list:
            future = executor.submit(fn, item)
            futures[future] = item
            # Small delay between submissions to spread out the requests
            time.sleep(stagger_delay)
        
        for future in as_completed(futures):
            result = future.result()
            if result is not None:
                results.append(result)
    
    return results
