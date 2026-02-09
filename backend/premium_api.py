"""
Premium Price API Module
Fetches Shanghai and India premium data for gold and silver.

Shanghai Premium: Uses metalcharts.org API to get SGE (Shanghai Gold Exchange) spot prices.
                  
India Premium: Uses metalcharts.org API for MCX (Multi Commodity Exchange) spot prices.
"""

import time
import random
from datetime import datetime
from typing import Dict, Any, Optional, List
import requests
import yfinance as yf
from logger import setup_logger

logger = setup_logger('premium_api')

# Cache settings
CACHE_TTL = 300  # 5 minutes cache for premium data
_premium_cache: Dict[str, Dict[str, Any]] = {}
_cache_timestamps: Dict[str, float] = {}

# Free public CORS proxies to try when direct requests fail (if you want to get premium data)
# These are rotated through on failure
FREE_PROXIES: List[str] = [
    # AllOrigins - reliable free CORS proxy
    'https://api.allorigins.win/raw?url=',
    # corsproxy.io - another free option
    'https://corsproxy.io/?',
    # cors.sh - free tier available
    'https://cors.sh/',
]

# Track which proxies have failed recently to avoid repeated failures
_failed_proxies: Dict[str, float] = {}
PROXY_FAILURE_TTL = 300  # Don't retry a failed proxy for 5 minutes


def get_cached_data(key: str) -> Optional[Dict[str, Any]]:
    """Get cached data if still valid."""
    if key in _premium_cache and key in _cache_timestamps:
        if time.time() - _cache_timestamps[key] < CACHE_TTL:
            return _premium_cache[key]
    return None


def set_cached_data(key: str, data: Dict[str, Any]):
    """Cache data with timestamp."""
    _premium_cache[key] = data
    _cache_timestamps[key] = time.time()


def _get_available_proxies() -> List[str]:
    """Get list of proxies that haven't failed recently."""
    now = time.time()
    available = []
    for proxy in FREE_PROXIES:
        if proxy not in _failed_proxies or now - _failed_proxies[proxy] > PROXY_FAILURE_TTL:
            available.append(proxy)
    # If all proxies have failed, reset and try them all again
    if not available:
        _failed_proxies.clear()
        available = FREE_PROXIES.copy()
    return available


def _mark_proxy_failed(proxy: str):
    """Mark a proxy as failed."""
    _failed_proxies[proxy] = time.time()


def _fetch_with_proxy_fallback(url: str, headers: Dict[str, str], timeout: int = 10) -> Optional[requests.Response]:
    """
    Try to fetch a URL, falling back to proxies if direct request fails.
    
    Args:
        url: The URL to fetch
        headers: Request headers
        timeout: Request timeout in seconds
        
    Returns:
        Response object if successful, None if all attempts fail
    """
    # First try direct request
    try:
        response = requests.get(url, headers=headers, timeout=timeout)
        if response.status_code == 200:
            return response
        logger.warning(f"Direct request failed with HTTP {response.status_code}, trying proxies...")
    except requests.RequestException as e:
        logger.warning(f"Direct request failed: {e}, trying proxies...")
    
    # Try proxies
    available_proxies = _get_available_proxies()
    random.shuffle(available_proxies)  # Randomize to distribute load
    
    for proxy in available_proxies:
        try:
            proxy_url = f"{proxy}{url}"
            logger.info(f"Trying proxy: {proxy[:30]}...")
            
            # Proxies typically don't need origin/referer headers
            proxy_headers = {
                'User-Agent': headers.get('User-Agent', 'Mozilla/5.0'),
                'Accept': 'application/json',
            }
            
            response = requests.get(proxy_url, headers=proxy_headers, timeout=timeout + 5)
            
            if response.status_code == 200:
                logger.info(f"Successfully fetched via proxy")
                return response
            else:
                logger.warning(f"Proxy returned HTTP {response.status_code}")
                _mark_proxy_failed(proxy)
                
        except requests.RequestException as e:
            logger.warning(f"Proxy request failed: {e}")
            _mark_proxy_failed(proxy)
            continue
    
    logger.error(f"All fetch attempts failed for {url}")
    return None


# ============= FOREX RATES =============

def get_forex_rate(from_currency: str, to_currency: str = 'USD') -> float:
    """Get exchange rate using yfinance."""
    if from_currency == to_currency:
        return 1.0
    
    cache_key = f'forex_{from_currency}_{to_currency}'
    cached = get_cached_data(cache_key)
    if cached:
        return cached['rate']
    
    try:
        # Yahoo Finance format: CNYUSD=X for CNY to USD
        ticker = f'{from_currency}{to_currency}=X'
        forex = yf.Ticker(ticker)
        info = forex.info
        rate = info.get('regularMarketPrice') or info.get('previousClose')
        
        if rate:
            set_cached_data(cache_key, {'rate': rate})
            return rate
        
        logger.warning(f"Could not get forex rate for {from_currency}/{to_currency}")
        return 1.0
    except Exception as e:
        logger.error(f"Error fetching forex rate {from_currency}/{to_currency}: {e}")
        return 1.0


# ============= SHANGHAI PREMIUM (via metalcharts.org API) =============

def scrape_metalcharts_shanghai(metal: str) -> Dict[str, Any]:
    """
    Fetch Shanghai premium data from metalcharts.org API.
    
    Args:
        metal: 'gold' or 'silver' (or 'xau'/'xag')
        
    Returns:
        Dictionary with SGE spot prices, western prices, and premium calculations
    """
    metal = metal.lower()
    if metal in ['gold', 'xau']:
        metal_key = 'gold'
        symbol = 'XAU'
    elif metal in ['silver', 'xag']:
        metal_key = 'silver'
        symbol = 'XAG'
    else:
        return {'error': f'Unsupported metal: {metal}. Use gold/xau or silver/xag'}
    
    cache_key = f'shanghai_{metal_key}'
    cached = get_cached_data(cache_key)
    if cached:
        return cached
    
    result = {
        'metal': metal_key,
        'region': 'shanghai',
        'timestamp': datetime.now().isoformat(),
        'shanghai_spot': None,
        'western_spot': None,
        'spot_premium': None,
        'spot_premium_pct': None,
        'unit': 'USD/oz',
        'source': 'metalcharts.org',
    }
    
    try:
        # Fetch Shanghai data from metalcharts.org API (with proxy fallback for cloud hosting)
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json',
            'Referer': 'https://metalcharts.org/',
            'Origin': 'https://metalcharts.org',
        }
        
        response = _fetch_with_proxy_fallback('https://metalcharts.org/api/shanghai', headers=headers, timeout=10)
        
        if response and response.status_code == 200:
            data = response.json()
            
            if data.get('success') and 'data' in data:
                metal_data = data['data'].get(symbol)
                
                if metal_data:
                    # Shanghai spot price (already in USD/oz)
                    result['shanghai_spot'] = round(metal_data.get('price', 0), 2) if metal_data.get('price') else None
                    
                    # Premium already calculated by the API
                    if metal_data.get('premium') is not None:
                        result['spot_premium'] = round(metal_data['premium'], 2)
                    if metal_data.get('premiumPercent') is not None:
                        result['spot_premium_pct'] = round(metal_data['premiumPercent'], 2)
                    
                    # Calculate western spot from shanghai spot minus premium
                    if result['shanghai_spot'] and result['spot_premium'] is not None:
                        result['western_spot'] = round(result['shanghai_spot'] - result['spot_premium'], 2)
                
                logger.info(f"Successfully fetched Shanghai {metal_key} data from metalcharts.org")
        else:
            logger.warning(f"Failed to fetch metalcharts.org shanghai API (all attempts failed)")
            
    except Exception as e:
        logger.error(f"Error fetching metalcharts.org shanghai API: {e}")
    
    # If API failed to provide western_spot, fetch from yfinance as fallback
    if not result['western_spot']:
        try:
            western_ticker = 'GC=F' if metal_key == 'gold' else 'SI=F'
            western = yf.Ticker(western_ticker)
            western_info = western.info
            western_price = western_info.get('regularMarketPrice') or western_info.get('previousClose')
            if western_price:
                result['western_spot'] = round(western_price, 2)
        except Exception as e:
            logger.error(f"Error fetching western {metal_key} price as fallback: {e}")
    
    set_cached_data(cache_key, result)
    return result


def get_shanghai_premium_data(metal: str) -> Dict[str, Any]:
    """
    Get Shanghai premium data for gold or silver.
    
    Uses metalcharts.org API to fetch SGE (Shanghai Gold Exchange) spot prices.
    
    Args:
        metal: 'gold' or 'silver' (or 'xau'/'xag')
        
    Returns:
        Dictionary with spot price, western price, and premium calculations
    """
    return scrape_metalcharts_shanghai(metal)


# ============= INDIA PREMIUM (via metalcharts.org API) =============

def scrape_metalcharts_india(metal: str) -> Dict[str, Any]:
    """
    Fetch India premium data from metalcharts.org API.
    
    Args:
        metal: 'gold' or 'silver' (or 'xau'/'xag')
        
    Returns:
        Dictionary with MCX spot prices, western prices, and premium calculations
    """
    metal = metal.lower()
    if metal in ['gold', 'xau']:
        metal_key = 'gold'
        symbol = 'XAU'
    elif metal in ['silver', 'xag']:
        metal_key = 'silver'
        symbol = 'XAG'
    else:
        return {'error': f'Unsupported metal: {metal}. Use gold/xau or silver/xag'}
    
    cache_key = f'india_{metal_key}'
    cached = get_cached_data(cache_key)
    if cached:
        return cached
    
    result = {
        'metal': metal_key,
        'region': 'india',
        'timestamp': datetime.now().isoformat(),
        'india_spot': None,
        'western_spot': None,
        'spot_premium': None,
        'spot_premium_pct': None,
        'unit': 'USD/oz',
        'source': 'metalcharts.org',
    }
    
    try:
        # Fetch India data from metalcharts.org API (with proxy fallback for cloud hosting)
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json',
            'Referer': 'https://metalcharts.org/',
            'Origin': 'https://metalcharts.org',
        }
        
        response = _fetch_with_proxy_fallback('https://metalcharts.org/api/india', headers=headers, timeout=10)
        
        if response and response.status_code == 200:
            data = response.json()
            
            if data.get('success') and 'data' in data:
                metal_data = data['data'].get(symbol)
                
                if metal_data:
                    # India spot price (already in USD/oz)
                    result['india_spot'] = round(metal_data.get('price', 0), 2) if metal_data.get('price') else None
                    
                    # Premium already calculated by the API
                    if metal_data.get('premium') is not None:
                        result['spot_premium'] = round(metal_data['premium'], 2)
                    if metal_data.get('premiumPercent') is not None:
                        result['spot_premium_pct'] = round(metal_data['premiumPercent'], 2)
                    
                    # Calculate western spot from premium
                    if result['india_spot'] and result['spot_premium'] is not None:
                        result['western_spot'] = round(result['india_spot'] - result['spot_premium'], 2)
                
                logger.info(f"Successfully fetched India {metal_key} data from metalcharts.org")
        else:
            logger.warning(f"Failed to fetch metalcharts.org india API (all attempts failed)")
            
    except Exception as e:
        logger.error(f"Error fetching metalcharts.org india API: {e}")
    
    # If API failed to provide western_spot, fetch from yfinance as fallback
    if not result['western_spot']:
        try:
            western_ticker = 'GC=F' if metal_key == 'gold' else 'SI=F'
            western = yf.Ticker(western_ticker)
            western_info = western.info
            western_price = western_info.get('regularMarketPrice') or western_info.get('previousClose')
            if western_price:
                result['western_spot'] = round(western_price, 2)
        except Exception as e:
            logger.error(f"Error fetching western {metal_key} price as fallback: {e}")
    
    # If still no India data, try ETF proxy as fallback
    if not result['india_spot']:
        try:
            # Get USD/INR rate for conversion
            usd_inr_rate = get_forex_rate('INR', 'USD')  # INR to USD
            
            etf_ticker = 'GOLDBEES.NS' if metal_key == 'gold' else 'SILVERBEES.NS'
            etf = yf.Ticker(etf_ticker)
            etf_info = etf.info
            etf_price = etf_info.get('regularMarketPrice') or etf_info.get('previousClose')
            
            if etf_price and usd_inr_rate:
                # GOLDBEES tracks ~1 gram of gold
                # SILVERBEES tracks ~1 kg of silver
                # Convert to USD/oz
                GRAMS_PER_TROY_OZ = 31.1035
                KG_PER_TROY_OZ = 0.0311035
                
                if metal_key == 'gold':
                    # GOLDBEES price is INR per ~1 gram
                    india_usd_oz = etf_price * GRAMS_PER_TROY_OZ * usd_inr_rate
                else:
                    # SILVERBEES price is INR per ~1 kg (approx)
                    india_usd_oz = etf_price * 1000 * KG_PER_TROY_OZ * usd_inr_rate
                
                result['india_spot'] = round(india_usd_oz, 2)
                result['source'] = f'{etf_ticker} ETF proxy'
                result['note'] = 'Using Indian ETF as proxy - actual MCX prices may differ'
                
                # Recalculate premium
                if result['western_spot']:
                    result['spot_premium'] = round(result['india_spot'] - result['western_spot'], 2)
                    result['spot_premium_pct'] = round(
                        (result['spot_premium'] / result['western_spot']) * 100, 2
                    )
                
        except Exception as e:
            logger.error(f"Error fetching India ETF proxy: {e}")
    
    set_cached_data(cache_key, result)
    return result


def get_india_premium_data(metal: str) -> Dict[str, Any]:
    """
    Get India premium data for gold or silver.
    
    Uses metalcharts.org API to fetch MCX spot prices, falls back to Indian ETF proxy.
    
    Args:
        metal: 'gold' or 'silver' (or 'xau'/'xag')
        
    Returns:
        Dictionary with MCX spot prices, western prices, and premium calculations
    """
    return scrape_metalcharts_india(metal)


# ============= COMBINED PREMIUM DATA =============

def get_all_premium_data(metal: str) -> Dict[str, Any]:
    """
    Get all premium data (Shanghai + India) for a metal.
    
    Args:
        metal: 'gold' or 'silver' (or 'xau'/'xag')
        
    Returns:
        Dictionary with both Shanghai and India premium data
    """
    metal = metal.lower()
    if metal in ['gold', 'xau']:
        metal_key = 'gold'
    elif metal in ['silver', 'xag']:
        metal_key = 'silver'
    else:
        return {'error': f'Unsupported metal: {metal}. Use gold/xau or silver/xag'}
    
    shanghai_data = get_shanghai_premium_data(metal_key)
    
    # India premium only available for silver
    india_data = None
    if metal_key == 'silver':
        india_data = get_india_premium_data(metal_key)
    
    result = {
        'metal': metal_key,
        'timestamp': datetime.now().isoformat(),
        'shanghai': shanghai_data if 'error' not in shanghai_data else None,
        'india': india_data if india_data and 'error' not in india_data else None,
    }
    
    # Add errors if any
    errors = {}
    if 'error' in shanghai_data:
        errors['shanghai'] = shanghai_data.get('error')
    if india_data and 'error' in india_data:
        errors['india'] = india_data.get('error')
    if errors:
        result['errors'] = errors
    
    return result
