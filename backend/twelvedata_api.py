"""
Twelve Data API integration for fetching stock market data.

Twelve Data provides high-quality intraday data for stocks, which is more
reliable than yfinance for certain use cases (e.g., recent trading day candles).

Free tier limits:
- 800 API calls per day
- 8 API calls per minute

This module implements caching and rate limiting to stay within these limits.
"""

import os
import time
import requests
from datetime import datetime, timedelta
from threading import Lock
from logger import setup_logger

logger = setup_logger('twelvedata_api')

# API Configuration
TWELVEDATA_BASE_URL = "https://api.twelvedata.com"
TWELVEDATA_API_KEY = os.environ.get('TWELVEDATA_API_KEY')

# Rate limiting: 8 requests per minute
RATE_LIMIT_REQUESTS = 8
RATE_LIMIT_WINDOW = 60  # seconds

# In-memory cache for time series data
# Key: f"{symbol}_{interval}_{outputsize}"
# Value: {"data": [...], "timestamp": datetime, "meta": {...}}
_cache = {}
_cache_lock = Lock()

# Cache TTL based on interval
# Intraday data is cached for shorter periods since it updates frequently
CACHE_TTL = {
    '1min': 60,        # 1 minute cache for 1min data
    '5min': 300,       # 5 minute cache for 5min data
    '15min': 900,      # 15 minute cache for 15min data
    '30min': 1800,     # 30 minute cache for 30min data
    '1h': 3600,        # 1 hour cache for hourly data
    '1day': 3600 * 6,  # 6 hour cache for daily data
}

# Rate limiting state
_request_timestamps = []
_rate_limit_lock = Lock()

# Credit tracking - all standard endpoints cost 1 credit per symbol
# See: https://support.twelvedata.com/en/articles/5615854-credits
ENDPOINT_CREDITS = {
    'time_series': 1,
    'quote': 1,
    'price': 1,
    'statistics': 1,
}

def _log_credit_usage(endpoint: str, symbol: str, credits: int = 1):
    """Log TwelveData API credit usage for transparency."""
    logger.info(f"[TWELVEDATA CREDIT] Endpoint: /{endpoint} | Symbol: {symbol} | Credits used: {credits}")


class RateLimitException(Exception):
    """Exception raised when rate limit is reached. Contains wait_time for frontend."""
    def __init__(self, wait_time: float):
        self.wait_time = wait_time
        super().__init__(f"Rate limit reached, retry after {wait_time:.1f}s")


def _check_rate_limit() -> float | None:
    """
    Check if we're about to exceed rate limits.
    
    Returns:
        None if request can proceed, or wait_time in seconds if rate limited.
    """
    global _request_timestamps
    
    with _rate_limit_lock:
        now = time.time()
        
        # Remove timestamps older than the rate limit window
        _request_timestamps = [ts for ts in _request_timestamps if now - ts < RATE_LIMIT_WINDOW]
        
        # If we've hit the limit, return wait time
        if len(_request_timestamps) >= RATE_LIMIT_REQUESTS:
            oldest = _request_timestamps[0]
            wait_time = RATE_LIMIT_WINDOW - (now - oldest) + 0.5  # Add 0.5s buffer
            if wait_time > 0:
                logger.info(f"Rate limit reached, need to wait {wait_time:.1f}s")
                return wait_time
        
        # Record this request
        _request_timestamps.append(time.time())
        return None


def _wait_for_rate_limit():
    """
    Check rate limit and raise RateLimitException if limit is reached.
    
    This is a non-blocking version that allows the Flask route to return
    HTTP 429 with retry_after info instead of blocking the request.
    
    Raises:
        RateLimitException: If rate limit is reached, with wait_time property.
    """
    wait_time = _check_rate_limit()
    if wait_time:
        logger.info(f"Rate limit reached, need to wait {wait_time:.1f}s")
        raise RateLimitException(wait_time)


def _get_cache_key(symbol: str, interval: str, outputsize: int) -> str:
    """Generate a cache key for the given parameters."""
    return f"{symbol.upper()}_{interval}_{outputsize}"


def _get_from_cache(cache_key: str, interval: str) -> dict | None:
    """Get data from cache if it's still valid."""
    with _cache_lock:
        if cache_key not in _cache:
            return None
        
        cached = _cache[cache_key]
        ttl = CACHE_TTL.get(interval, 3600)
        age = (datetime.now() - cached['timestamp']).total_seconds()
        
        if age < ttl:
            logger.debug(f"Cache hit for {cache_key} (age: {age:.0f}s)")
            return cached
        else:
            # Cache expired, remove it
            del _cache[cache_key]
            return None


def _set_cache(cache_key: str, data: dict, meta: dict):
    """Store data in cache."""
    with _cache_lock:
        _cache[cache_key] = {
            'data': data,
            'meta': meta,
            'timestamp': datetime.now(),
        }
        logger.debug(f"Cached data for {cache_key}")


# Map our interval format to Twelve Data format
INTERVAL_MAP = {
    '1m': '1min',
    '5m': '5min',
    '15m': '15min',
    '30m': '30min',
    '60m': '1h',
    '1h': '1h',
    '1d': '1day',
}


def is_available() -> bool:
    """Check if Twelve Data API is configured and available."""
    return bool(TWELVEDATA_API_KEY)


def get_time_series(
    symbol: str,
    interval: str = '5m',
    outputsize: int = 100,
    use_cache: bool = True
) -> dict | None:
    """
    Fetch time series data from Twelve Data API.
    
    Args:
        symbol: Stock ticker symbol (e.g., 'NVDA', 'AAPL')
        interval: Candle interval ('1m', '5m', '15m', '30m', '1h', '1d')
        outputsize: Number of data points to return (max 5000)
        use_cache: Whether to use cached data if available
        
    Returns:
        Dict with 'meta' and 'values' keys, or None if failed.
        'values' is a list of candles sorted oldest to newest.
        
    Example response:
        {
            'meta': {'symbol': 'NVDA', 'interval': '5min', ...},
            'values': [
                {'datetime': '2026-02-02 09:30:00', 'open': '188.0', 'high': '188.5', ...},
                ...
            ]
        }
    """
    if not TWELVEDATA_API_KEY:
        logger.warning("Twelve Data API key not configured")
        return None
    
    # Map interval to Twelve Data format
    td_interval = INTERVAL_MAP.get(interval, interval)
    if td_interval not in INTERVAL_MAP.values():
        logger.error(f"Invalid interval: {interval}")
        return None
    
    # Check cache first
    cache_key = _get_cache_key(symbol, td_interval, outputsize)
    if use_cache:
        cached = _get_from_cache(cache_key, td_interval)
        if cached:
            return {'meta': cached['meta'], 'values': cached['data']}
    
    # Wait for rate limit
    _wait_for_rate_limit()
    
    # Build request
    params = {
        'symbol': symbol.upper(),
        'interval': td_interval,
        'outputsize': min(outputsize, 5000),  # Max 5000
        'apikey': TWELVEDATA_API_KEY,
    }
    
    try:
        logger.info(f"Fetching Twelve Data: {symbol} @ {td_interval}")
        response = requests.get(
            f"{TWELVEDATA_BASE_URL}/time_series",
            params=params,
            timeout=30
        )
        response.raise_for_status()
        data = response.json()
        
        # Check for API errors
        if data.get('status') == 'error':
            error_msg = data.get('message', 'Unknown error')
            logger.error(f"Twelve Data API error: {error_msg}")
            return None
        
        # Validate response structure
        if 'values' not in data or 'meta' not in data:
            logger.error(f"Unexpected Twelve Data response structure: {list(data.keys())}")
            return None
        
        # Twelve Data returns data in descending order (newest first)
        # Reverse to match yfinance format (oldest first)
        values = data['values']
        values.reverse()
        
        # Cache the result
        _set_cache(cache_key, values, data['meta'])
        
        # Log credit usage
        _log_credit_usage('time_series', symbol)
        
        logger.info(f"Twelve Data returned {len(values)} candles for {symbol}")
        return {'meta': data['meta'], 'values': values}
        
    except requests.exceptions.Timeout:
        logger.error(f"Twelve Data request timed out for {symbol}")
        return None
    except requests.exceptions.RequestException as e:
        logger.error(f"Twelve Data request failed for {symbol}: {e}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error fetching Twelve Data for {symbol}: {e}")
        return None


def get_time_series_hourly_aligned(
    symbol: str,
    outputsize: int = 100,
    use_cache: bool = True
) -> dict | None:
    """
    Fetch hourly time series data aligned to round hours (:00).
    
    Instead of market-open aligned candles (09:30, 10:30, 11:30...),
    this returns candles aligned to round hours:
    - First candle: 09:30 (market open, only 30 minutes)
    - Subsequent candles: 10:00, 11:00, 12:00... (full 60-minute candles)
    
    This is achieved by fetching 30-minute candles and aggregating them.
    
    Args:
        symbol: Stock ticker symbol (e.g., 'NVDA', 'AAPL')
        outputsize: Approximate number of hourly data points to return
        use_cache: Whether to use cached data if available
        
    Returns:
        Dict with 'meta' and 'values' keys, or None if failed.
        'values' is a list of candles sorted oldest to newest.
    """
    if not TWELVEDATA_API_KEY:
        logger.warning("Twelve Data API key not configured")
        return None
    
    # Check cache first (use special cache key for aligned hourly data)
    cache_key = f"{symbol.upper()}_1h_aligned_{outputsize}"
    if use_cache:
        cached = _get_from_cache(cache_key, '1h')
        if cached:
            return {'meta': cached['meta'], 'values': cached['data']}
    
    # Fetch 30-minute candles (need ~2x for aggregation)
    # Plus extra to handle the first partial candle
    thirty_min_size = min(outputsize * 2 + 10, 5000)
    
    _wait_for_rate_limit()
    
    params = {
        'symbol': symbol.upper(),
        'interval': '30min',
        'outputsize': thirty_min_size,
        'apikey': TWELVEDATA_API_KEY,
    }
    
    try:
        logger.info(f"Fetching Twelve Data 30min for hourly alignment: {symbol}")
        response = requests.get(
            f"{TWELVEDATA_BASE_URL}/time_series",
            params=params,
            timeout=30
        )
        response.raise_for_status()
        data = response.json()
        
        if data.get('status') == 'error':
            error_msg = data.get('message', 'Unknown error')
            logger.error(f"Twelve Data API error: {error_msg}")
            return None
        
        if 'values' not in data or 'meta' not in data:
            logger.error(f"Unexpected Twelve Data response structure: {list(data.keys())}")
            return None
        
        # Reverse to oldest first
        thirty_min_candles = data['values']
        thirty_min_candles.reverse()
        
        # Aggregate into hour-aligned candles
        hourly_candles = []
        i = 0
        
        while i < len(thirty_min_candles):
            candle = thirty_min_candles[i]
            dt_str = candle['datetime']
            
            try:
                dt = datetime.strptime(dt_str, '%Y-%m-%d %H:%M:%S')
            except ValueError:
                i += 1
                continue
            
            minute = dt.minute
            
            if minute == 30:
                # This is a :30 candle
                # Check if it's market open (09:30) - keep as single 30-min candle
                if dt.hour == 9:
                    # Market open candle - keep as is (30 minutes only)
                    hourly_candles.append({
                        'datetime': dt_str,
                        'open': candle['open'],
                        'high': candle['high'],
                        'low': candle['low'],
                        'close': candle['close'],
                        'volume': candle.get('volume', '0'),
                    })
                    i += 1
                else:
                    # Non-market-open :30 candle - combine with next :00 candle
                    # This handles edge cases where data might start mid-hour
                    # Skip this candle and let the :00 candle be the primary
                    i += 1
            else:
                # This is a :00 candle - combine with following :30 candle if available
                open_price = float(candle['open'])
                high_price = float(candle['high'])
                low_price = float(candle['low'])
                close_price = float(candle['close'])
                volume = int(candle.get('volume', 0) or 0)
                
                # Check if next candle is :30 of same hour
                if i + 1 < len(thirty_min_candles):
                    next_candle = thirty_min_candles[i + 1]
                    try:
                        next_dt = datetime.strptime(next_candle['datetime'], '%Y-%m-%d %H:%M:%S')
                        if next_dt.hour == dt.hour and next_dt.minute == 30:
                            # Combine the two 30-min candles into one hourly candle
                            high_price = max(high_price, float(next_candle['high']))
                            low_price = min(low_price, float(next_candle['low']))
                            close_price = float(next_candle['close'])
                            volume += int(next_candle.get('volume', 0) or 0)
                            i += 1  # Skip the :30 candle
                    except ValueError:
                        pass
                
                hourly_candles.append({
                    'datetime': dt.strftime('%Y-%m-%d %H:%M:%S'),
                    'open': str(open_price),
                    'high': str(high_price),
                    'low': str(low_price),
                    'close': str(close_price),
                    'volume': str(volume),
                })
                i += 1
        
        # Update meta to indicate hourly interval
        meta = data['meta'].copy()
        meta['interval'] = '1h'
        meta['aligned'] = 'hour'
        
        # Cache the result
        _set_cache(cache_key, hourly_candles, meta)
        
        # Log credit usage
        _log_credit_usage('time_series', symbol)
        
        logger.info(f"Twelve Data returned {len(hourly_candles)} hour-aligned candles for {symbol}")
        return {'meta': meta, 'values': hourly_candles}
        
    except requests.exceptions.Timeout:
        logger.error(f"Twelve Data request timed out for {symbol}")
        return None
    except requests.exceptions.RequestException as e:
        logger.error(f"Twelve Data request failed for {symbol}: {e}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error fetching Twelve Data for {symbol}: {e}")
        return None


def format_history_response(
    symbol: str,
    td_data: dict,
    days: int,
    interval: str,
    currency: str = 'USD',
    exchange_timezone: str = 'America/New_York'
) -> dict:
    """
    Format Twelve Data response to match our API's history response format.
    
    Args:
        symbol: Stock ticker symbol
        td_data: Response from get_time_series()
        days: Number of days requested
        interval: Interval string (our format: '1m', '5m', etc.)
        currency: Currency code for the prices (e.g., 'USD', 'HKD', 'JPY')
        exchange_timezone: IANA timezone of the exchange (e.g., 'Asia/Hong_Kong')
        
    Returns:
        Dict matching our /api/stocks/<symbol>/history response format
    """
    td_interval = INTERVAL_MAP.get(interval, interval)
    is_intraday = interval != '1d'
    
    history = []
    for candle in td_data['values']:
        # Parse datetime
        dt_str = candle['datetime']
        try:
            # Twelve Data format: "2026-02-02 09:30:00" or "2026-02-02"
            if ' ' in dt_str:
                dt = datetime.strptime(dt_str, '%Y-%m-%d %H:%M:%S')
            else:
                dt = datetime.strptime(dt_str, '%Y-%m-%d')
        except ValueError:
            logger.warning(f"Could not parse datetime: {dt_str}")
            continue
        
        # Format date string based on interval
        date_format = '%Y-%m-%d %H:%M' if is_intraday else '%Y-%m-%d'
        
        history.append({
            'date': dt.strftime(date_format),
            'timestamp': int(dt.timestamp() * 1000),
            'price': float(candle['close']),
            'open': float(candle['open']),
            'high': float(candle['high']),
            'low': float(candle['low']),
            'volume': int(candle.get('volume', 0)) if candle.get('volume') else 0,
        })
    
    return {
        'id': f'stock-{symbol.lower().replace("-", "")}',
        'symbol': symbol.upper(),
        'days': days,
        'interval': interval,
        'source': 'twelvedata',
        'currency': currency,
        'exchange_timezone': exchange_timezone,
        'history': history,
    }


def get_outputsize_for_days(days: int, interval: str, exchange_timezone: str = 'America/New_York') -> int:
    """
    Calculate the number of data points needed for a given number of days and interval.
    
    Args:
        days: Number of days of history
        interval: Candle interval
        exchange_timezone: IANA timezone of the exchange (e.g., 'Asia/Hong_Kong')
        
    Returns:
        Approximate number of data points needed
    """
    # Use maximum trading hours across major markets to ensure we get enough data
    # US: 6.5 hrs, HK: 5.5 hrs, Tokyo: 5 hrs, London: 8.5 hrs
    # Use 8 hours as a safe baseline to cover all markets
    trading_hours = 8
    
    candles_per_day = {
        '1m': trading_hours * 60,      # 480
        '5m': trading_hours * 12,      # 96
        '15m': trading_hours * 4,      # 32
        '30m': trading_hours * 2,      # 16
        '1h': trading_hours,           # 8
        '60m': trading_hours,          # 8
        '1d': 1,
    }
    
    candles = candles_per_day.get(interval, 96)  # Default to 5m
    
    # Add extra buffer for international stocks due to timezone differences
    # When the server timezone differs from exchange timezone, "today" in exchange
    # time might be "yesterday" for the server, so we need extra data
    extra_days = 0
    if exchange_timezone and not exchange_timezone.startswith('America/'):
        # For non-US exchanges, add 1 extra day worth of data to handle timezone offset
        extra_days = 1
    
    total_days = days + extra_days
    
    # Add 30% buffer for weekends/holidays/gaps
    return min(int(total_days * candles * 1.3), 5000)


def clear_cache():
    """Clear all cached data."""
    global _cache
    with _cache_lock:
        _cache = {}
        logger.info("Twelve Data cache cleared")


def get_quote(symbol: str, use_cache: bool = True) -> dict | None:
    """
    Fetch real-time quote data from Twelve Data API.
    
    Provides today's trading data (open, high, low, close, volume) and 52-week range.
    
    Args:
        symbol: Stock ticker symbol (e.g., 'NVDA', 'AAPL')
        use_cache: Whether to use cached data if available
        
    Returns:
        Dict with quote data, or None if failed.
        
    Example response:
        {
            'symbol': 'AAPL',
            'name': 'Apple Inc.',
            'open': 259.915,
            'high': 270.48,
            'low': 259.2,
            'close': 269.99,
            'volume': 1863629,
            'previous_close': 259.48,
            'change': 10.51,
            'percent_change': 4.05,
            'average_volume': 52468123,
            'fifty_two_week': {
                'low': 169.21,
                'high': 288.62,
            }
        }
    """
    if not TWELVEDATA_API_KEY:
        logger.warning("Twelve Data API key not configured")
        return None
    
    # Check cache first (5 minute TTL for quote data)
    cache_key = f"quote_{symbol.upper()}"
    if use_cache:
        with _cache_lock:
            if cache_key in _cache:
                cached = _cache[cache_key]
                age = (datetime.now() - cached['timestamp']).total_seconds()
                if age < 300:  # 5 minute cache
                    logger.debug(f"Cache hit for quote {symbol} (age: {age:.0f}s)")
                    return cached['data']
    
    # Wait for rate limit
    _wait_for_rate_limit()
    
    params = {
        'symbol': symbol.upper(),
        'apikey': TWELVEDATA_API_KEY,
    }
    
    try:
        logger.info(f"Fetching Twelve Data quote: {symbol}")
        response = requests.get(
            f"{TWELVEDATA_BASE_URL}/quote",
            params=params,
            timeout=30
        )
        response.raise_for_status()
        data = response.json()
        
        # Check for API errors
        if data.get('status') == 'error' or 'code' in data:
            error_msg = data.get('message', 'Unknown error')
            logger.error(f"Twelve Data quote API error: {error_msg}")
            return None
        
        # Parse and normalize the response
        result = {
            'symbol': data.get('symbol'),
            'name': data.get('name'),
            'open': float(data.get('open', 0)) if data.get('open') else None,
            'high': float(data.get('high', 0)) if data.get('high') else None,
            'low': float(data.get('low', 0)) if data.get('low') else None,
            'close': float(data.get('close', 0)) if data.get('close') else None,
            'volume': int(data.get('volume', 0)) if data.get('volume') else None,
            'previous_close': float(data.get('previous_close', 0)) if data.get('previous_close') else None,
            'change': float(data.get('change', 0)) if data.get('change') else None,
            'percent_change': float(data.get('percent_change', 0)) if data.get('percent_change') else None,
            'average_volume': int(data.get('average_volume', 0)) if data.get('average_volume') else None,
            'is_market_open': data.get('is_market_open', False),
        }
        
        # Parse 52-week data
        if 'fifty_two_week' in data:
            ftw = data['fifty_two_week']
            result['fifty_two_week'] = {
                'low': float(ftw.get('low', 0)) if ftw.get('low') else None,
                'high': float(ftw.get('high', 0)) if ftw.get('high') else None,
            }
        
        # Cache the result
        with _cache_lock:
            _cache[cache_key] = {
                'data': result,
                'timestamp': datetime.now(),
            }
        
        # Log credit usage
        _log_credit_usage('quote', symbol)
        
        logger.info(f"Twelve Data quote for {symbol}: close={result['close']}")
        return result
        
    except requests.exceptions.Timeout:
        logger.error(f"Twelve Data quote request timed out for {symbol}")
        return None
    except requests.exceptions.RequestException as e:
        logger.error(f"Twelve Data quote request failed for {symbol}: {e}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error fetching Twelve Data quote for {symbol}: {e}")
        return None


def get_statistics(symbol: str, use_cache: bool = True) -> dict | None:
    """
    Fetch statistics data from Twelve Data API.
    
    Provides shares outstanding, average volumes, and other market statistics.
    
    Args:
        symbol: Stock ticker symbol (e.g., 'NVDA', 'AAPL')
        use_cache: Whether to use cached data if available
        
    Returns:
        Dict with statistics data, or None if failed.
        
    Example response:
        {
            'shares_outstanding': 14681140000,
            'float_shares': 14655741628,
            'avg_10_volume': 59496040,
            'avg_90_volume': 48837417,
            'fifty_two_week_low': 169.21,
            'fifty_two_week_high': 288.62,
            'beta': 1.093,
            'day_50_ma': 268.29,
            'day_200_ma': 236.65,
        }
    """
    if not TWELVEDATA_API_KEY:
        logger.warning("Twelve Data API key not configured")
        return None
    
    # Check cache first (1 hour TTL for statistics - doesn't change often)
    cache_key = f"statistics_{symbol.upper()}"
    if use_cache:
        with _cache_lock:
            if cache_key in _cache:
                cached = _cache[cache_key]
                age = (datetime.now() - cached['timestamp']).total_seconds()
                if age < 3600:  # 1 hour cache
                    logger.debug(f"Cache hit for statistics {symbol} (age: {age:.0f}s)")
                    return cached['data']
    
    # Wait for rate limit
    _wait_for_rate_limit()
    
    params = {
        'symbol': symbol.upper(),
        'apikey': TWELVEDATA_API_KEY,
    }
    
    try:
        logger.info(f"Fetching Twelve Data statistics: {symbol}")
        response = requests.get(
            f"{TWELVEDATA_BASE_URL}/statistics",
            params=params,
            timeout=30
        )
        response.raise_for_status()
        data = response.json()
        
        # Check for API errors
        if data.get('status') == 'error' or 'code' in data:
            error_msg = data.get('message', 'Unknown error')
            logger.error(f"Twelve Data statistics API error: {error_msg}")
            return None
        
        stats = data.get('statistics', {})
        stock_stats = stats.get('stock_statistics', {})
        price_summary = stats.get('stock_price_summary', {})
        
        result = {
            'shares_outstanding': stock_stats.get('shares_outstanding'),
            'float_shares': stock_stats.get('float_shares'),
            'avg_10_volume': stock_stats.get('avg_10_volume'),
            'avg_90_volume': stock_stats.get('avg_90_volume'),
            'fifty_two_week_low': price_summary.get('fifty_two_week_low'),
            'fifty_two_week_high': price_summary.get('fifty_two_week_high'),
            'beta': price_summary.get('beta'),
            'day_50_ma': price_summary.get('day_50_ma'),
            'day_200_ma': price_summary.get('day_200_ma'),
        }
        
        # Cache the result
        with _cache_lock:
            _cache[cache_key] = {
                'data': result,
                'timestamp': datetime.now(),
            }
        
        # Log credit usage
        _log_credit_usage('statistics', symbol)
        
        logger.info(f"Twelve Data statistics for {symbol}: shares_outstanding={result['shares_outstanding']}")
        return result
        
    except requests.exceptions.Timeout:
        logger.error(f"Twelve Data statistics request timed out for {symbol}")
        return None
    except requests.exceptions.RequestException as e:
        logger.error(f"Twelve Data statistics request failed for {symbol}: {e}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error fetching Twelve Data statistics for {symbol}: {e}")
        return None


def get_batch_quotes(symbols: list[str], use_cache: bool = True) -> dict[str, dict]:
    """
    Fetch real-time quote data for multiple symbols in a single API call.
    
    TwelveData supports up to 120 symbols per request on free tier.
    This is much more efficient than calling get_quote() for each symbol.
    
    Args:
        symbols: List of stock ticker symbols (e.g., ['NVDA', 'AAPL', 'MSFT'])
        use_cache: Whether to use cached data if available
        
    Returns:
        Dict mapping symbol -> quote data. Missing/failed symbols are omitted.
        
    Example:
        {'NVDA': {'close': 185.66, 'previous_close': 191.13, ...},
         'AAPL': {'close': 269.99, 'previous_close': 259.48, ...}}
    """
    if not TWELVEDATA_API_KEY:
        logger.warning("Twelve Data API key not configured")
        return {}
    
    if not symbols:
        return {}
    
    # Normalize symbols
    symbols = [s.upper() for s in symbols]
    
    # Check cache for symbols we already have
    results = {}
    symbols_to_fetch = []
    
    if use_cache:
        with _cache_lock:
            for symbol in symbols:
                cache_key = f"quote_{symbol}"
                if cache_key in _cache:
                    cached = _cache[cache_key]
                    age = (datetime.now() - cached['timestamp']).total_seconds()
                    if age < 300:  # 5 minute cache
                        results[symbol] = cached['data']
                        continue
                symbols_to_fetch.append(symbol)
    else:
        symbols_to_fetch = symbols
    
    if not symbols_to_fetch:
        logger.debug(f"Batch quote: all {len(symbols)} symbols from cache")
        return results
    
    # Wait for rate limit
    _wait_for_rate_limit()
    
    # TwelveData batch request - comma-separated symbols
    params = {
        'symbol': ','.join(symbols_to_fetch),
        'apikey': TWELVEDATA_API_KEY,
    }
    
    try:
        logger.info(f"Fetching Twelve Data batch quote: {len(symbols_to_fetch)} symbols")
        response = requests.get(
            f"{TWELVEDATA_BASE_URL}/quote",
            params=params,
            timeout=30
        )
        response.raise_for_status()
        data = response.json()
        
        # Handle single vs multiple symbols response
        # Single symbol returns a dict, multiple returns dict keyed by symbol
        if len(symbols_to_fetch) == 1:
            # Single symbol - wrap in dict
            data = {symbols_to_fetch[0]: data}
        
        # Process each symbol's data
        for symbol in symbols_to_fetch:
            quote_data = data.get(symbol, {})
            
            # Check for errors
            if quote_data.get('status') == 'error' or 'code' in quote_data:
                logger.warning(f"Batch quote error for {symbol}: {quote_data.get('message', 'Unknown')}")
                continue
            
            if not quote_data.get('close'):
                continue
            
            # Parse and normalize the response
            result = {
                'symbol': quote_data.get('symbol'),
                'name': quote_data.get('name'),
                'open': float(quote_data.get('open', 0)) if quote_data.get('open') else None,
                'high': float(quote_data.get('high', 0)) if quote_data.get('high') else None,
                'low': float(quote_data.get('low', 0)) if quote_data.get('low') else None,
                'close': float(quote_data.get('close', 0)) if quote_data.get('close') else None,
                'volume': int(quote_data.get('volume', 0)) if quote_data.get('volume') else None,
                'previous_close': float(quote_data.get('previous_close', 0)) if quote_data.get('previous_close') else None,
                'change': float(quote_data.get('change', 0)) if quote_data.get('change') else None,
                'percent_change': float(quote_data.get('percent_change', 0)) if quote_data.get('percent_change') else None,
                'average_volume': int(quote_data.get('average_volume', 0)) if quote_data.get('average_volume') else None,
                'is_market_open': quote_data.get('is_market_open', False),
            }
            
            # Parse 52-week data
            if 'fifty_two_week' in quote_data:
                ftw = quote_data['fifty_two_week']
                result['fifty_two_week'] = {
                    'low': float(ftw.get('low', 0)) if ftw.get('low') else None,
                    'high': float(ftw.get('high', 0)) if ftw.get('high') else None,
                }
            
            results[symbol] = result
            
            # Cache the result
            with _cache_lock:
                _cache[f"quote_{symbol}"] = {
                    'data': result,
                    'timestamp': datetime.now(),
                }
        
        logger.info(f"Twelve Data batch quote: got {len(results)} of {len(symbols)} symbols")
        return results
        
    except requests.exceptions.Timeout:
        logger.error("Twelve Data batch quote request timed out")
        return results
    except requests.exceptions.RequestException as e:
        logger.error(f"Twelve Data batch quote request failed: {e}")
        return results
    except Exception as e:
        logger.error(f"Unexpected error fetching Twelve Data batch quote: {e}")
        return results


# ============= CRYPTOCURRENCY FUNCTIONS =============
# TwelveData uses format like "BTC/USD" for crypto pairs

def get_crypto_time_series(
    symbol: str,
    interval: str = '5m',
    outputsize: int = 100,
    use_cache: bool = True
) -> dict | None:
    """
    Fetch time series data for a cryptocurrency from Twelve Data API.
    
    Args:
        symbol: Crypto pair symbol (e.g., 'BTC/USD', 'ETH/USD')
        interval: Candle interval ('1m', '5m', '15m', '30m', '1h', '1d')
        outputsize: Number of data points to return (max 5000)
        use_cache: Whether to use cached data if available
        
    Returns:
        Dict with 'meta' and 'values' keys, or None if failed.
        'values' is a list of candles sorted oldest to newest.
    """
    if not TWELVEDATA_API_KEY:
        logger.warning("Twelve Data API key not configured")
        return None
    
    # Map interval to Twelve Data format
    td_interval = INTERVAL_MAP.get(interval, interval)
    if td_interval not in INTERVAL_MAP.values():
        logger.error(f"Invalid interval: {interval}")
        return None
    
    # Check cache first
    cache_key = _get_cache_key(symbol, td_interval, outputsize)
    if use_cache:
        cached = _get_from_cache(cache_key, td_interval)
        if cached:
            return {'meta': cached['meta'], 'values': cached['data']}
    
    # Wait for rate limit
    _wait_for_rate_limit()
    
    # Build request
    params = {
        'symbol': symbol,  # e.g., "BTC/USD"
        'interval': td_interval,
        'outputsize': min(outputsize, 5000),
        'apikey': TWELVEDATA_API_KEY,
    }
    
    try:
        logger.info(f"Fetching Twelve Data crypto time series: {symbol} @ {td_interval}")
        response = requests.get(
            f"{TWELVEDATA_BASE_URL}/time_series",
            params=params,
            timeout=30
        )
        response.raise_for_status()
        data = response.json()
        
        # Check for API errors
        if data.get('status') == 'error':
            error_msg = data.get('message', 'Unknown error')
            logger.error(f"Twelve Data crypto API error: {error_msg}")
            return None
        
        # Validate response structure
        if 'values' not in data or 'meta' not in data:
            logger.error(f"Unexpected Twelve Data crypto response structure: {list(data.keys())}")
            return None
        
        # Twelve Data returns data in descending order (newest first)
        # Reverse to match our format (oldest first)
        values = data['values']
        values.reverse()
        
        # Cache the result
        _set_cache(cache_key, values, data['meta'])
        
        # Log credit usage
        _log_credit_usage('time_series', symbol)
        
        logger.info(f"Twelve Data crypto returned {len(values)} candles for {symbol}")
        return {'meta': data['meta'], 'values': values}
        
    except requests.exceptions.Timeout:
        logger.error(f"Twelve Data crypto request timed out for {symbol}")
        return None
    except requests.exceptions.RequestException as e:
        logger.error(f"Twelve Data crypto request failed for {symbol}: {e}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error fetching Twelve Data crypto for {symbol}: {e}")
        return None


def get_crypto_quote(symbol: str, use_cache: bool = True) -> dict | None:
    """
    Fetch real-time quote data for a cryptocurrency from Twelve Data API.
    
    Args:
        symbol: Crypto pair symbol (e.g., 'BTC/USD', 'ETH/USD')
        use_cache: Whether to use cached data if available
        
    Returns:
        Dict with quote data, or None if failed.
        
    Example response:
        {
            'symbol': 'BTC/USD',
            'name': 'Bitcoin',
            'close': 98500.00,
            'previous_close': 97800.00,
            'change': 700.00,
            'percent_change': 0.71,
        }
    """
    if not TWELVEDATA_API_KEY:
        logger.warning("Twelve Data API key not configured")
        return None
    
    # Check cache first (2 minute TTL for crypto quote - more volatile than stocks)
    cache_key = f"crypto_quote_{symbol.replace('/', '_')}"
    if use_cache:
        with _cache_lock:
            if cache_key in _cache:
                cached = _cache[cache_key]
                age = (datetime.now() - cached['timestamp']).total_seconds()
                if age < 120:  # 2 minute cache for crypto
                    logger.debug(f"Cache hit for crypto quote {symbol} (age: {age:.0f}s)")
                    return cached['data']
    
    # Wait for rate limit
    _wait_for_rate_limit()
    
    params = {
        'symbol': symbol,
        'apikey': TWELVEDATA_API_KEY,
    }
    
    try:
        logger.info(f"Fetching Twelve Data crypto quote: {symbol}")
        response = requests.get(
            f"{TWELVEDATA_BASE_URL}/quote",
            params=params,
            timeout=30
        )
        response.raise_for_status()
        data = response.json()
        
        # Check for API errors
        if data.get('status') == 'error' or 'code' in data:
            error_msg = data.get('message', 'Unknown error')
            logger.error(f"Twelve Data crypto quote API error: {error_msg}")
            return None
        
        # Parse and normalize the response
        result = {
            'symbol': data.get('symbol'),
            'name': data.get('name'),
            'open': float(data.get('open', 0)) if data.get('open') else None,
            'high': float(data.get('high', 0)) if data.get('high') else None,
            'low': float(data.get('low', 0)) if data.get('low') else None,
            'close': float(data.get('close', 0)) if data.get('close') else None,
            'volume': int(float(data.get('volume', 0))) if data.get('volume') else None,
            'previous_close': float(data.get('previous_close', 0)) if data.get('previous_close') else None,
            'change': float(data.get('change', 0)) if data.get('change') else None,
            'percent_change': float(data.get('percent_change', 0)) if data.get('percent_change') else None,
            'is_market_open': data.get('is_market_open', True),  # Crypto markets are always open
        }
        
        # Cache the result
        with _cache_lock:
            _cache[cache_key] = {
                'data': result,
                'timestamp': datetime.now(),
            }
        
        # Log credit usage
        _log_credit_usage('quote', symbol)
        
        logger.info(f"Twelve Data crypto quote for {symbol}: close={result['close']}")
        return result
        
    except requests.exceptions.Timeout:
        logger.error(f"Twelve Data crypto quote request timed out for {symbol}")
        return None
    except requests.exceptions.RequestException as e:
        logger.error(f"Twelve Data crypto quote request failed for {symbol}: {e}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error fetching Twelve Data crypto quote for {symbol}: {e}")
        return None


def get_crypto_batch_quotes(symbols: list[str], use_cache: bool = True) -> dict[str, dict]:
    """
    Fetch real-time quote data for multiple crypto pairs in a single API call.
    
    Args:
        symbols: List of crypto pair symbols (e.g., ['BTC/USD', 'ETH/USD', 'SOL/USD'])
        use_cache: Whether to use cached data if available
        
    Returns:
        Dict mapping symbol -> quote data. Missing/failed symbols are omitted.
    """
    if not TWELVEDATA_API_KEY:
        logger.warning("Twelve Data API key not configured")
        return {}
    
    if not symbols:
        return {}
    
    # Check cache for symbols we already have
    results = {}
    symbols_to_fetch = []
    
    if use_cache:
        with _cache_lock:
            for symbol in symbols:
                cache_key = f"crypto_quote_{symbol.replace('/', '_')}"
                if cache_key in _cache:
                    cached = _cache[cache_key]
                    age = (datetime.now() - cached['timestamp']).total_seconds()
                    if age < 120:  # 2 minute cache for crypto
                        results[symbol] = cached['data']
                        continue
                symbols_to_fetch.append(symbol)
    else:
        symbols_to_fetch = symbols
    
    if not symbols_to_fetch:
        logger.debug(f"Crypto batch quote: all {len(symbols)} symbols from cache")
        return results
    
    # Wait for rate limit
    _wait_for_rate_limit()
    
    # TwelveData batch request - comma-separated symbols
    params = {
        'symbol': ','.join(symbols_to_fetch),
        'apikey': TWELVEDATA_API_KEY,
    }
    
    try:
        logger.info(f"Fetching Twelve Data crypto batch quote: {len(symbols_to_fetch)} symbols")
        response = requests.get(
            f"{TWELVEDATA_BASE_URL}/quote",
            params=params,
            timeout=30
        )
        response.raise_for_status()
        data = response.json()
        
        # Handle single vs multiple symbols response
        if len(symbols_to_fetch) == 1:
            # Single symbol - wrap in dict
            data = {symbols_to_fetch[0]: data}
        
        # Process each symbol's data
        for symbol in symbols_to_fetch:
            quote_data = data.get(symbol, {})
            
            # Check for errors
            if quote_data.get('status') == 'error' or 'code' in quote_data:
                logger.warning(f"Crypto batch quote error for {symbol}: {quote_data.get('message', 'Unknown')}")
                continue
            
            if not quote_data.get('close'):
                continue
            
            # Parse and normalize the response
            result = {
                'symbol': quote_data.get('symbol'),
                'name': quote_data.get('name'),
                'open': float(quote_data.get('open', 0)) if quote_data.get('open') else None,
                'high': float(quote_data.get('high', 0)) if quote_data.get('high') else None,
                'low': float(quote_data.get('low', 0)) if quote_data.get('low') else None,
                'close': float(quote_data.get('close', 0)) if quote_data.get('close') else None,
                'volume': int(float(quote_data.get('volume', 0))) if quote_data.get('volume') else None,
                'previous_close': float(quote_data.get('previous_close', 0)) if quote_data.get('previous_close') else None,
                'change': float(quote_data.get('change', 0)) if quote_data.get('change') else None,
                'percent_change': float(quote_data.get('percent_change', 0)) if quote_data.get('percent_change') else None,
                'is_market_open': quote_data.get('is_market_open', True),
            }
            
            results[symbol] = result
            
            # Cache the result
            with _cache_lock:
                cache_key = f"crypto_quote_{symbol.replace('/', '_')}"
                _cache[cache_key] = {
                    'data': result,
                    'timestamp': datetime.now(),
                }
        
        logger.info(f"Twelve Data crypto batch quote: got {len(results)} of {len(symbols)} symbols")
        return results
        
    except requests.exceptions.Timeout:
        logger.error("Twelve Data crypto batch quote request timed out")
        return results
    except requests.exceptions.RequestException as e:
        logger.error(f"Twelve Data crypto batch quote request failed: {e}")
        return results
    except Exception as e:
        logger.error(f"Unexpected error fetching Twelve Data crypto batch quote: {e}")
        return results


def format_crypto_history_response(
    crypto_id: str,
    symbol: str,
    td_data: dict,
    days: int,
    interval: str,
) -> dict:
    """
    Format Twelve Data crypto response to match our API's history response format.
    
    Args:
        crypto_id: Crypto ID (e.g., 'bitcoin', 'ethereum')
        symbol: TwelveData symbol (e.g., 'BTC/USD')
        td_data: Response from get_crypto_time_series()
        days: Number of days requested
        interval: Interval string (our format: '1m', '5m', etc.)
        
    Returns:
        Dict matching our /api/crypto/<id>/history response format
    """
    td_interval = INTERVAL_MAP.get(interval, interval)
    is_intraday = interval != '1d'
    
    history = []
    for candle in td_data['values']:
        # Parse datetime
        dt_str = candle['datetime']
        try:
            # Twelve Data format: "2026-02-02 09:30:00" or "2026-02-02"
            if ' ' in dt_str:
                dt = datetime.strptime(dt_str, '%Y-%m-%d %H:%M:%S')
            else:
                dt = datetime.strptime(dt_str, '%Y-%m-%d')
        except ValueError:
            logger.warning(f"Could not parse datetime: {dt_str}")
            continue
        
        # Format date string based on interval
        date_format = '%Y-%m-%d %H:%M' if is_intraday else '%Y-%m-%d'
        
        history.append({
            'date': dt.strftime(date_format),
            'timestamp': int(dt.timestamp() * 1000),
            'price': float(candle['close']),
            'open': float(candle['open']),
            'high': float(candle['high']),
            'low': float(candle['low']),
            'volume': int(float(candle.get('volume', 0))) if candle.get('volume') else 0,
        })
    
    return {
        'id': crypto_id,
        'symbol': symbol,
        'days': days,
        'interval': interval,
        'source': 'twelvedata',
        'currency': 'USD',
        'history': history,
    }
