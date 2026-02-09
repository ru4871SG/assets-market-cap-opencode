from flask import Flask, jsonify, request, Response
from flask_cors import CORS
import yfinance as yf
from concurrent.futures import ThreadPoolExecutor, as_completed
from yf_helpers import yf_ticker_with_retry, yf_history_with_retry, staggered_executor, EmptyHistoryError
from supply_config import get_supply
from historical_events import get_events_in_range, get_all_categories, get_all_events
from data_refresher import refresh_all_data, get_sp500_marketcap_order, ASSET_PAGE_REFRESH_CANDLES, STATISTICS_ASSET_PAGE_TWELVEDATA
from premium_api import get_shanghai_premium_data, get_india_premium_data, get_all_premium_data
import twelvedata_api
from twelvedata_api import RateLimitException
from datetime import datetime, timedelta
from pathlib import Path
import json
import os
import requests
from dotenv import load_dotenv
from logger import setup_logger

# Load environment variables from .env file
load_dotenv()

# Set up logger
logger = setup_logger('app')


def calculate_period_changes(ticker_obj, current_price):
    """
    Calculate percentage changes for multiple time periods.
    
    Args:
        ticker_obj: A yfinance Ticker object
        current_price: The current price of the asset
        
    Returns:
        dict with keys: change7d, change30d, change60d, change90d, change180d, changeYtd
    """
    changes = {
        'change7d': None,
        'change30d': None,
        'change60d': None,
        'change90d': None,
        'change180d': None,
        'changeYtd': None,
    }
    
    if not current_price:
        return changes
    
    try:
        # Define periods to fetch - use 1y to get enough data for all calculations
        hist = yf_history_with_retry(ticker_obj, period='1y')
        
        if hist.empty:
            return changes
        
        today = datetime.now()
        
        # Calculate each period
        periods = {
            'change7d': 7,
            'change30d': 30,
            'change60d': 60,
            'change90d': 90,
            'change180d': 180,
        }
        
        for key, days in periods.items():
            target_date = today - timedelta(days=days)
            # Find the closest trading day
            mask = hist.index <= target_date.strftime('%Y-%m-%d %H:%M:%S%z') if hist.index.tz else hist.index <= target_date
            past_data = hist[mask]
            if not past_data.empty:
                past_price = past_data['Close'].iloc[-1]
                if past_price and past_price > 0:
                    changes[key] = round(((current_price - past_price) / past_price) * 100, 2)
        
        # Calculate YTD (Year to Date)
        year_start = datetime(today.year, 1, 1)
        mask = hist.index <= year_start.strftime('%Y-%m-%d %H:%M:%S%z') if hist.index.tz else hist.index <= year_start
        ytd_data = hist[mask]
        if not ytd_data.empty:
            ytd_price = ytd_data['Close'].iloc[-1]
            if ytd_price and ytd_price > 0:
                changes['changeYtd'] = round(((current_price - ytd_price) / ytd_price) * 100, 2)
        else:
            # If no data before year start, use first available data point of the year
            year_mask = hist.index >= year_start.strftime('%Y-%m-%d %H:%M:%S%z') if hist.index.tz else hist.index >= year_start
            year_data = hist[year_mask]
            if not year_data.empty:
                first_price = year_data['Close'].iloc[0]
                if first_price and first_price > 0:
                    changes['changeYtd'] = round(((current_price - first_price) / first_price) * 100, 2)
    
    except Exception as e:
        logger.debug(f"Error calculating period changes: {e}")
    
    return changes

# Load S&P 500 stock tickers from JSON file
DATA_DIR = Path(__file__).parent / "data"
STOCK_TICKERS_FILE = DATA_DIR / "stock_tickers.json"

def load_stock_tickers():
    """Load stock tickers from JSON file. Returns list of (ticker, name, image) tuples."""
    try:
        with open(STOCK_TICKERS_FILE, 'r') as f:
            data = json.load(f)
        # Convert to list of tuples for backwards compatibility
        return [(item['ticker'], item['name'], item['image']) for item in data]
    except Exception as e:
        logger.error(f"Error loading stock tickers: {e}")
        return []

STOCK_TICKERS = load_stock_tickers()
logger.info(f"Loaded {len(STOCK_TICKERS)} stock tickers from {STOCK_TICKERS_FILE}")

# Refresh cached datasets at startup
logger.info("Refreshing cached datasets...")
refresh_all_data()

# Initialize S&P 500 tickers in market cap order from cache/SlickCharts at startup
# This list contains all ~503 stocks sorted by market cap (weight) descending
logger.info("Loading S&P 500 stocks in market cap order...")
SP500_MARKETCAP_ORDER = get_sp500_marketcap_order()
logger.info(f"Loaded {len(SP500_MARKETCAP_ORDER)} stocks in market cap order: {SP500_MARKETCAP_ORDER[:5]}...")

app = Flask(__name__)
CORS(app)  # Enable CORS for frontend access


@app.errorhandler(RateLimitException)
def handle_rate_limit_exception(e: RateLimitException):
    """
    Global handler for TwelveData rate limit exceptions.
    Returns HTTP 429 with retry_after info for frontend countdown display.
    """
    logger.info(f"[RATE LIMIT] Returning 429 with retry_after={e.wait_time:.1f}s")
    response = jsonify({
        'error': 'Rate limit exceeded (sorry, I use free plan). Wait for 1 minute and it should automatically retry. If it has been over 1 minute, click the refresh button on the top-right to manually refresh.',
        'retry_after': round(e.wait_time, 1),
        'message': f'Rate limit exceeded (sorry, I use free plan). Wait for 1 minute and it should automatically retry. If it has been over 1 minute, click the refresh button on the top-right to manually refresh.',
    })
    response.status_code = 429
    response.headers['Retry-After'] = str(int(e.wait_time) + 1)
    return response


# Crypto tickers (using TwelveData format: SYMBOL/USD)
# Only display these major cryptocurrencies on the main listing page (had to be selective due to API limitations)
CRYPTO_TICKERS = {
    'BTC/USD': {
        'id': 'bitcoin',
        'name': 'Bitcoin',
        'symbol': 'BTC',
        'image': 'https://assets.coingecko.com/coins/images/1/large/bitcoin.png',
    },
    'ETH/USD': {
        'id': 'ethereum',
        'name': 'Ethereum',
        'symbol': 'ETH',
        'image': 'https://assets.coingecko.com/coins/images/279/large/ethereum.png',
    },
    # 'BNB/USD': {
    #     'id': 'binance-coin',
    #     'name': 'Binance Coin',
    #     'symbol': 'BNB',
    #     'image': 'https://assets.coingecko.com/coins/images/825/large/bnb-icon2_2x.png',
    # },
    # 'SOL/USD': {
    #     'id': 'solana',
    #     'name': 'Solana',
    #     'symbol': 'SOL',
    #     'image': 'https://assets.coingecko.com/coins/images/4128/large/solana.png',
    # },
}

# Metal tickers (futures contracts) - supply comes from supply_config.py
METAL_TICKERS = {
    'GC=F': {
        'name': 'Gold',
        'symbol': 'XAU',
        'image': 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d7/Gold-crystals.jpg/220px-Gold-crystals.jpg',
    },
    'SI=F': {
        'name': 'Silver',
        'symbol': 'XAG',
        'image': 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/55/Silver_crystal.jpg/220px-Silver_crystal.jpg',
    },
    'PL=F': {
        'name': 'Platinum',
        'symbol': 'XPT',
        'image': 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/68/Platinum_crystals.jpg/220px-Platinum_crystals.jpg',
    },
    'PA=F': {
        'name': 'Palladium',
        'symbol': 'XPD',
        'image': 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d7/Palladium_%2846_Pd%29.jpg/220px-Palladium_%2846_Pd%29.jpg',
    },
    'HG=F': {
        'name': 'Copper',
        'symbol': 'HG',
        'image': 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f0/NatCopper.jpg/220px-NatCopper.jpg',
    },
}

# Ticker-to-logo overrides for CompaniesMarketCap CDN
# Some tickers use a different symbol on the CDN than their trading ticker.
# e.g., GOOGL (Class A) trades as GOOGL but the logo is under GOOG on the CDN.
LOGO_TICKER_OVERRIDES = {
    'GOOGL': 'GOOG',  # Alphabet Class A -> CDN uses GOOG
}


def get_stock_logo_url(ticker: str) -> str:
    """Get the CompaniesMarketCap CDN logo URL for a stock ticker.
    
    Handles special cases where the trading ticker differs from the CDN logo ticker
    (e.g., GOOGL -> GOOG). For international tickers like 7203.T, strips the
    exchange suffix.
    """
    logo_ticker = LOGO_TICKER_OVERRIDES.get(ticker, ticker)
    # For international tickers, strip exchange suffix (e.g., 7203.T -> 7203)
    if '.' in logo_ticker:
        logo_ticker = logo_ticker.split('.')[0]
    return f'https://companiesmarketcap.com/img/company-logos/64/{logo_ticker}.png'


def get_stock_realtime_data(ticker: str) -> dict | None:
    """Get real-time price data from TwelveData for a stock.
    
    Returns dict with price, previous_close, and change24h if successful.
    Returns None if TwelveData is unavailable or fails (caller should fallback to yfinance).
    
    Used by search functionality for real-time pricing.
    """
    if not twelvedata_api.is_available():
        return None
    
    try:
        td_quote = twelvedata_api.get_quote(ticker)
        if not td_quote or not td_quote.get('close'):
            return None
        
        price = td_quote['close']
        previous_close = td_quote.get('previous_close')
        
        # Calculate 24h change from TwelveData prices
        change_24h = 0
        if previous_close and price:
            change_24h = ((price - previous_close) / previous_close) * 100
        
        return {
            'price': price,
            'previous_close': previous_close,
            'change24h': round(change_24h, 2),
        }
    except Exception as e:
        logger.warning(f"TwelveData quote failed for {ticker}: {e}")
        return None


def fetch_stock_data(ticker_info):
    """Fetch data for a single stock ticker from yfinance. 
    
    Used for main page listing - uses yfinance only for faster loading.
    Returns asset dict with error field if failed.
    """
    ticker, name, _ = ticker_info  # Ignore the old Clearbit image URL
    # Use CompaniesMarketCap CDN for stock logos (handles ticker overrides like GOOGL->GOOG)
    image = get_stock_logo_url(ticker)
    base_asset = {
        'id': f'stock-{ticker.lower().replace("-", "")}',
        'name': name,
        'symbol': ticker,
        'type': 'stock',
        'image': image,
        'rank': 0,
        'marketCap': 0,
        'price': 0,
        'change24h': 0,
        'change7d': None,
        'change30d': None,
        'change60d': None,
        'change90d': None,
        'change180d': None,
        'changeYtd': None,
    }
    
    try:
        stock, info = yf_ticker_with_retry(ticker)
        
        price = info.get('currentPrice') or info.get('regularMarketPrice') or 0
        market_cap = info.get('marketCap') or 0
        previous_close = info.get('previousClose') or info.get('regularMarketPreviousClose') or 0
        
        if not price or not market_cap:
            return {**base_asset, 'error': f'Unable to load {name} data'}
        
        # Calculate 24h change
        change_24h = 0
        if previous_close and price:
            change_24h = ((price - previous_close) / previous_close) * 100
        
        # Calculate period changes (7d, 30d, 60d, 90d, 180d, YTD)
        period_changes = calculate_period_changes(stock, price)
        
        return {
            **base_asset,
            'marketCap': market_cap,
            'price': price,
            'change24h': round(change_24h, 2),
            **period_changes,
        }
    except Exception as e:
        logger.error(f"Error fetching {ticker}: {e}")
        return {**base_asset, 'error': f'Unable to load {name} data'}


def fetch_stock_data_with_twelvedata(ticker_info):
    """Fetch data for a single stock ticker using TwelveData for real-time price.
    
    Used for search results - uses TwelveData for price/change, yfinance for shares
    and period changes. Market cap = shares_outstanding * TwelveData price.
    
    Falls back to yfinance if TwelveData is unavailable.
    """
    ticker, name, _ = ticker_info
    image = get_stock_logo_url(ticker)
    base_asset = {
        'id': f'stock-{ticker.lower().replace("-", "")}',
        'name': name,
        'symbol': ticker,
        'type': 'stock',
        'image': image,
        'rank': 0,
        'marketCap': 0,
        'price': 0,
        'change24h': 0,
        'change7d': None,
        'change30d': None,
        'change60d': None,
        'change90d': None,
        'change180d': None,
        'changeYtd': None,
    }
    
    try:
        # Always fetch yfinance for shares_outstanding and period changes
        stock, info = yf_ticker_with_retry(ticker)
        
        shares_outstanding = info.get('sharesOutstanding') or 0
        yf_price = info.get('currentPrice') or info.get('regularMarketPrice') or 0
        yf_previous_close = info.get('previousClose') or info.get('regularMarketPreviousClose') or 0
        yf_market_cap = info.get('marketCap') or 0
        
        # Try to get real-time data from TwelveData
        td_data = get_stock_realtime_data(ticker)
        
        if td_data:
            # Use TwelveData for price and change
            price = td_data['price']
            change_24h = td_data['change24h']
            # Calculate market cap: yfinance shares * TwelveData price
            if shares_outstanding:
                market_cap = shares_outstanding * price
            else:
                # Fallback: scale yfinance market cap by price ratio
                if yf_price:
                    market_cap = yf_market_cap * (price / yf_price)
                else:
                    market_cap = yf_market_cap
            logger.debug(f"Search {ticker}: Using TwelveData price={price}")
        else:
            # Fallback to yfinance
            price = yf_price
            market_cap = yf_market_cap
            change_24h = 0
            if yf_previous_close and price:
                change_24h = ((price - yf_previous_close) / yf_previous_close) * 100
            logger.debug(f"Search {ticker}: Fallback to yfinance price={price}")
        
        if not price or not market_cap:
            return {**base_asset, 'error': f'Unable to load {name} data'}
        
        # Calculate period changes (7d, 30d, 60d, 90d, 180d, YTD) - always from yfinance
        period_changes = calculate_period_changes(stock, price)
        
        return {
            **base_asset,
            'marketCap': market_cap,
            'price': price,
            'change24h': round(change_24h, 2),
            **period_changes,
        }
    except Exception as e:
        logger.error(f"Error fetching {ticker} with TwelveData: {e}")
        return {**base_asset, 'error': f'Unable to load {name} data'}


# Cache for forex rates to avoid repeated API calls
_forex_cache = {}
_forex_cache_expiry = {}
FOREX_CACHE_TTL = 3600  # Cache forex rates for 1 hour

def get_forex_rate_to_usd(currency: str) -> float:
    """Get the exchange rate from a currency to USD.
    
    Args:
        currency: The source currency code (e.g., 'JPY', 'EUR', 'GBP')
        
    Returns:
        The exchange rate to convert from the source currency to USD.
        Returns 1.0 if currency is USD or if rate cannot be fetched.
    """
    if currency == 'USD':
        return 1.0
    
    import time
    current_time = time.time()
    
    # Check cache
    if currency in _forex_cache and current_time < _forex_cache_expiry.get(currency, 0):
        return _forex_cache[currency]
    
    try:
        # Yahoo Finance forex ticker format: JPYUSD=X for JPY to USD
        forex_ticker = f'{currency}USD=X'
        forex, info = yf_ticker_with_retry(forex_ticker)
        
        rate = info.get('regularMarketPrice') or info.get('previousClose')
        if rate:
            # Cache the rate
            _forex_cache[currency] = rate
            _forex_cache_expiry[currency] = current_time + FOREX_CACHE_TTL
            logger.debug(f"Fetched forex rate {currency}/USD: {rate}")
            return rate
        else:
            logger.warning(f"Could not get forex rate for {currency}/USD")
            return 1.0
    except Exception as e:
        logger.error(f"Error fetching forex rate for {currency}: {e}")
        return 1.0


def fetch_arbitrary_stock_data(ticker):
    """Fetch data for any Yahoo Finance ticker (not limited to S&P 500).
    
    Used for search functionality to allow querying any valid ticker.
    Returns asset dict with error field if failed or ticker is invalid.
    
    Uses TwelveData for real-time price and % change, yfinance for shares_outstanding
    and period changes. Market cap = shares_outstanding * TwelveData price.
    
    For non-USD stocks, market cap and price are converted to USD using current forex rates.
    """
    # Normalize ticker (preserve dots for international tickers like 7203.T)
    ticker = ticker.strip().upper()
    
    # Use CompaniesMarketCap CDN for stock logos (handles overrides and international tickers)
    image = get_stock_logo_url(ticker)
    
    base_asset = {
        'id': f'stock-{ticker.lower().replace("-", "")}',  # Keep dots for international tickers like 7203.T
        'name': ticker,  # Will be updated with actual name from Yahoo
        'symbol': ticker,
        'type': 'stock',
        'image': image,
        'rank': 0,
        'marketCap': 0,
        'price': 0,
        'change24h': 0,
        'change7d': None,
        'change30d': None,
        'change60d': None,
        'change90d': None,
        'change180d': None,
        'changeYtd': None,
    }
    
    try:
        # Always fetch yfinance for validation, name, shares, and period changes
        stock, info = yf_ticker_with_retry(ticker)
        
        # Check if we got valid data (yfinance returns empty dict for invalid tickers)
        if not info or info.get('regularMarketPrice') is None and info.get('currentPrice') is None:
            return None  # Invalid ticker, return None instead of error
        
        # Get company name from Yahoo Finance
        name = info.get('shortName') or info.get('longName') or ticker
        
        shares_outstanding = info.get('sharesOutstanding') or 0
        yf_price = info.get('currentPrice') or info.get('regularMarketPrice') or 0
        yf_previous_close = info.get('previousClose') or info.get('regularMarketPreviousClose') or 0
        yf_market_cap = info.get('marketCap') or 0
        
        # Get currency for conversion
        currency = info.get('currency', 'USD')
        forex_rate = get_forex_rate_to_usd(currency) if currency != 'USD' else 1.0
        
        # Try to get real-time data from TwelveData
        td_data = get_stock_realtime_data(ticker)
        
        if td_data:
            # Use TwelveData for price and change
            price = td_data['price']
            change_24h = td_data['change24h']
            # Calculate market cap: yfinance shares * TwelveData price
            if shares_outstanding:
                market_cap = shares_outstanding * price
            else:
                # Fallback: scale yfinance market cap by price ratio
                if yf_price:
                    market_cap = yf_market_cap * (price / yf_price)
                else:
                    market_cap = yf_market_cap
        else:
            # Fallback to yfinance
            price = yf_price
            market_cap = yf_market_cap
            change_24h = 0
            if yf_previous_close and price:
                change_24h = ((price - yf_previous_close) / yf_previous_close) * 100
        
        # Convert to USD if stock is in a different currency
        if currency != 'USD':
            price = price * forex_rate
            market_cap = market_cap * forex_rate
            logger.debug(f"Converted {ticker} from {currency} to USD (rate: {forex_rate})")
        
        if not price or not market_cap:
            return None  # Not enough data
        
        # Calculate period changes (7d, 30d, 60d, 90d, 180d, YTD) - always from yfinance
        period_changes = calculate_period_changes(stock, price)
        
        return {
            **base_asset,
            'name': name,
            'marketCap': market_cap,
            'price': price,
            'change24h': round(change_24h, 2),
            **period_changes,
        }
    except Exception as e:
        logger.error(f"Error fetching arbitrary ticker {ticker}: {e}")
        return None


def fetch_metal_data(ticker):
    """Fetch data for a single metal ticker. Returns asset dict with error field if failed."""
    metal_info = METAL_TICKERS[ticker]
    base_asset = {
        'id': f'metal-{metal_info["name"].lower()}',
        'name': metal_info['name'],
        'symbol': metal_info['symbol'],
        'type': 'metal',
        'image': metal_info['image'],
        'rank': 0,
        'marketCap': 0,
        'price': 0,
        'change24h': 0,
        'change7d': None,
        'change30d': None,
        'change60d': None,
        'change90d': None,
        'change180d': None,
        'changeYtd': None,
    }
    
    try:
        metal, info = yf_ticker_with_retry(ticker)
        
        price = info.get('regularMarketPrice') or info.get('previousClose') or 0
        previous_close = info.get('previousClose') or info.get('regularMarketPreviousClose') or 0
        
        if not price:
            return {**base_asset, 'error': f'Unable to load {metal_info["name"]} data'}
        
        # Get supply from config file
        supply = get_supply(metal_info['symbol'])
        if not supply:
            return {**base_asset, 'error': f'Unable to load {metal_info["name"]} supply data'}
        
        # Calculate market cap = price * above-ground supply
        market_cap = price * supply
        
        # Calculate 24h change
        change_24h = 0
        if previous_close and price:
            change_24h = ((price - previous_close) / previous_close) * 100
        
        # Calculate period changes (7d, 30d, 60d, 90d, 180d, YTD)
        period_changes = calculate_period_changes(metal, price)
        
        return {
            **base_asset,
            'marketCap': market_cap,
            'price': price,
            'change24h': round(change_24h, 2),
            **period_changes,
        }
    except Exception as e:
        logger.error(f"Error fetching {ticker}: {e}")
        return {**base_asset, 'error': f'Unable to load {metal_info["name"]} data'}


def fetch_crypto_data(ticker):
    """Fetch data for a single crypto ticker using TwelveData API for price/24h change.
    
    Returns asset dict with error field if failed.
    
    Data sources:
    - TwelveData: Current price and 24h change (real-time)
    - yfinance: Circulating supply (for market cap) and period changes (7D-YTD)
    - Market cap = yfinance circulating supply × TwelveData real-time price
    """
    crypto_info = CRYPTO_TICKERS[ticker]
    crypto_id = crypto_info['id']  # e.g., 'bitcoin', 'ethereum'
    base_asset = {
        'id': f'crypto-{crypto_id}',
        'name': crypto_info['name'],
        'symbol': crypto_info['symbol'],
        'type': 'crypto',
        'image': crypto_info['image'],
        'rank': 0,
        'marketCap': 0,
        'price': 0,
        'change24h': 0,
        'change7d': None,
        'change30d': None,
        'change60d': None,
        'change90d': None,
        'change180d': None,
        'changeYtd': None,
    }
    
    try:
        # Use TwelveData for current price and 24h change (real-time)
        if not twelvedata_api.is_available():
            return {**base_asset, 'error': 'TwelveData API not configured'}
        
        td_quote = twelvedata_api.get_crypto_quote(ticker)
        
        if not td_quote or not td_quote.get('close'):
            return {**base_asset, 'error': f'Unable to load {crypto_info["name"]} data'}
        
        price = td_quote['close']
        previous_close = td_quote.get('previous_close') or 0
        
        # Calculate 24h change from TwelveData
        change_24h = 0
        if td_quote.get('percent_change'):
            change_24h = td_quote['percent_change']
        elif previous_close and price:
            change_24h = ((price - previous_close) / previous_close) * 100
        
        # Use yfinance for circulating supply (market cap) and period changes
        # Convert TwelveData ticker format (BTC/USD) to yfinance format (BTC-USD)
        yf_ticker = ticker.replace('/', '-')
        period_changes = {}
        market_cap = 0
        try:
            crypto_yf, crypto_yf_info = yf_ticker_with_retry(yf_ticker)
            period_changes = calculate_period_changes(crypto_yf, price)
            
            # Calculate market cap: circulating supply (yfinance) × real-time price (TwelveData)
            circulating_supply = crypto_yf_info.get('circulatingSupply')
            if circulating_supply and price:
                market_cap = int(circulating_supply * price)
                logger.debug(f"{ticker}: market cap = {circulating_supply:,.0f} supply × ${price:,.2f} = ${market_cap:,.0f}")
            else:
                logger.warning(f"No circulating supply from yfinance for {ticker}")
        except Exception as e:
            logger.warning(f"Could not fetch yfinance data for {ticker}: {e}")
            period_changes = {
                'change7d': None,
                'change30d': None,
                'change60d': None,
                'change90d': None,
                'change180d': None,
                'changeYtd': None,
            }
        
        return {
            **base_asset,
            'marketCap': market_cap,
            'price': price,
            'change24h': round(change_24h, 2),
            **period_changes,
        }
    except Exception as e:
        logger.error(f"Error fetching {ticker}: {e}")
        return {**base_asset, 'error': f'Unable to load {crypto_info["name"]} data'}


# TOP_30_TICKERS is loaded dynamically at startup from stock_screener.py
# It uses cached data from backend/data/top_stocks_list.json, refreshed daily

@app.route('/api/stocks', methods=['GET'])
def get_stocks():
    """Fetch stock data in parallel from yfinance.
    
    Query parameters:
    - limit: Number of stocks to fetch (default: 503 for all S&P 500)
    
    Uses yfinance for all data (price, market cap, changes).
    Note: Search and details pages use TwelveData for real-time prices.
    """
    limit_param = request.args.get('limit', '503')
    
    # Parse limit as integer
    try:
        limit = int(limit_param)
    except ValueError:
        limit = 503
    
    # Clamp limit between 1 and 503
    limit = max(1, min(limit, 503))
    
    # Determine which stocks to fetch based on limit
    # SP500_MARKETCAP_ORDER contains all S&P 500 stocks sorted by market cap (from SlickCharts)
    # We take the first N stocks from this pre-sorted list
    tickers_in_marketcap_order = SP500_MARKETCAP_ORDER[:limit]
    
    # If cached market cap order doesn't have enough stocks (e.g., stale cache with only 30),
    # supplement with remaining tickers from STOCK_TICKERS (alphabetical fallback)
    if len(tickers_in_marketcap_order) < limit:
        existing_set = set(tickers_in_marketcap_order)
        for ticker_info in STOCK_TICKERS:
            if ticker_info[0] not in existing_set:
                tickers_in_marketcap_order.append(ticker_info[0])
                existing_set.add(ticker_info[0])
                if len(tickers_in_marketcap_order) >= limit:
                    break
        logger.warning(
            f"SP500_MARKETCAP_ORDER only had {len(SP500_MARKETCAP_ORDER)} stocks, "
            f"supplemented to {len(tickers_in_marketcap_order)} from STOCK_TICKERS for limit={limit}"
        )
    
    # Get the ticker info (ticker, name, image) for each stock in market cap order
    # STOCK_TICKERS contains all S&P 500 stocks with their full info
    ticker_info_map = {t[0]: t for t in STOCK_TICKERS}
    tickers_to_fetch = [ticker_info_map[ticker] for ticker in tickers_in_marketcap_order 
                        if ticker in ticker_info_map]
    
    assets = staggered_executor(fetch_stock_data, tickers_to_fetch, max_workers=10, stagger_delay=0.3)
    
    # Sort by market cap descending (errors go to bottom since marketCap=0)
    assets.sort(key=lambda x: x['marketCap'], reverse=True)
    for i, asset in enumerate(assets):
        asset['rank'] = i + 1
    
    return jsonify(assets)


@app.route('/api/metals', methods=['GET'])
def get_metals():
    """Fetch all metal data in parallel. Returns all assets including errored ones."""
    assets = staggered_executor(fetch_metal_data, METAL_TICKERS, max_workers=5, stagger_delay=0.3)
    
    # Sort by market cap descending (errors go to bottom since marketCap=0)
    assets.sort(key=lambda x: x['marketCap'], reverse=True)
    for i, asset in enumerate(assets):
        asset['rank'] = i + 1
    
    return jsonify(assets)


@app.route('/api/crypto', methods=['GET'])
def get_crypto():
    """Fetch all crypto data in parallel using TwelveData + yfinance.
    
    Returns 4 major cryptocurrencies: BTC, ETH, BNB, SOL.
    
    Data sources:
    - TwelveData: Current price and 24h change (real-time)
    - yfinance: Circulating supply (for market cap) and period changes (7D-YTD)
    - Market cap = yfinance circulating supply × TwelveData real-time price
    """
    assets = staggered_executor(fetch_crypto_data, CRYPTO_TICKERS, max_workers=8, stagger_delay=0.3)
    
    # Sort by market cap descending (same as stocks)
    # Falls back to predefined order for any assets with marketCap=0
    predefined_order = {info['id']: i for i, info in enumerate(CRYPTO_TICKERS.values())}
    
    def get_sort_key(asset):
        market_cap = asset.get('marketCap', 0)
        if market_cap > 0:
            return (-market_cap, 0)  # Primary: market cap descending
        # Fallback: predefined order for assets without market cap
        crypto_id = asset['id'].replace('crypto-', '')
        return (0, predefined_order.get(crypto_id, 999))
    
    assets.sort(key=get_sort_key)
    
    # Assign ranks
    for i, asset in enumerate(assets):
        asset['rank'] = i + 1
    
    return jsonify(assets)


@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint."""
    return jsonify({'status': 'ok'})


@app.route('/api/search', methods=['GET'])
def search_asset():
    """Search for a specific asset by ticker/symbol.
    
    Query parameters:
    - q: Search query (ticker symbol, 2-10 characters)
    
    Returns matching stock asset. Supports:
    - S&P 500 stocks (from whitelist)
    - Any valid Yahoo Finance ticker (e.g., 7203.T for Toyota Tokyo, TM for Toyota US)
    
    Note: Crypto search is disabled. Use the /api/crypto endpoint to get crypto data.
    """
    query = request.args.get('q', '').strip().upper()
    
    if not query or len(query) < 2 or len(query) > 10:
        return jsonify({'error': 'Query must be 2-10 characters'}), 400
    
    results = []
    
    # Search in stocks first (check if ticker exists in our S&P 500 list)
    matching_stock = None
    for ticker, name, image in STOCK_TICKERS:
        if ticker.upper() == query or ticker.upper().replace('-', '') == query:
            matching_stock = (ticker, name, image)
            break
    
    if matching_stock:
        # Found in S&P 500 whitelist - use TwelveData for real-time price
        stock_data = fetch_stock_data_with_twelvedata(matching_stock)
        if stock_data and not stock_data.get('error'):
            results.append(stock_data)
    else:
        # Not in S&P 500 - try querying Yahoo Finance directly for any valid ticker
        stock_data = fetch_arbitrary_stock_data(query)
        if stock_data:
            results.append(stock_data)
    
    # Crypto search is disabled - users should use the /api/crypto endpoint
    # to get the list of supported cryptocurrencies
    
    return jsonify({
        'query': query,
        'results': results,
        'count': len(results),
    })


# ============= NEW: Historical Data Endpoints =============

# Map days to yfinance period strings
DAYS_TO_PERIOD = {
    7: '7d',
    30: '1mo',
    90: '3mo',
    365: '1y',
}

# Valid intervals for yfinance
# Note on data availability:
# - 1m: only last 7 days
# - 5m: only last 60 days
# - 15m, 30m: only last 60 days
# - 60m/1h: only last 730 days (~2 years)
# - 1d: full history
VALID_INTERVALS = ['1m', '5m', '15m', '30m', '60m', '1h', '1d']
DEFAULT_INTERVAL = '1d'

# Recommended interval based on period to avoid data unavailability
# and balance between granularity and API efficiency
def get_recommended_interval(days: int, requested_interval: str | None = None) -> str:
    """
    Get the recommended interval for a given period.
    If a specific interval is requested, validate it's available for the period.
    
    Args:
        days: Number of days of history
        requested_interval: Optional specific interval requested
        
    Returns:
        The interval to use (either requested or recommended)
    """
    if requested_interval and requested_interval in VALID_INTERVALS:
        # Validate the requested interval is available for the period
        if requested_interval == '1m' and days > 7:
            logger.warning(f"1m interval only available for 7 days, but {days} days requested. Using 5m.")
            return '5m' if days <= 60 else '1h' if days <= 730 else '1d'
        elif requested_interval == '5m' and days > 60:
            logger.warning(f"5m interval only available for 60 days, but {days} days requested. Using 1h.")
            return '1h' if days <= 730 else '1d'
        elif requested_interval in ['15m', '30m'] and days > 60:
            logger.warning(f"{requested_interval} interval only available for 60 days. Using 1h.")
            return '1h' if days <= 730 else '1d'
        elif requested_interval in ['60m', '1h'] and days > 730:
            logger.warning(f"1h interval only available for 730 days. Using 1d.")
            return '1d'
        return requested_interval
    
    # Default recommendations based on period
    if days <= 7:
        return '5m'  # 5m for 7 days (more stable than 1m, fewer API calls)
    elif days <= 60:
        return '1h'  # 1h for up to 60 days
    else:
        return '1d'  # Daily for longer periods

def aggregate_to_hourly_aligned(hist_df, market_open_minute: int = 30):
    """
    Aggregate yfinance intraday data to hour-aligned candles.
    
    yfinance returns candles aligned to market open (e.g., 09:30, 10:30, 11:30).
    This function aggregates 30-min candles into hour-aligned candles:
    - First candle: market open (e.g., 09:30) - kept as is (partial hour)
    - Subsequent candles: aligned to :00 (10:00, 11:00, 12:00, etc.)
    
    Args:
        hist_df: pandas DataFrame from yfinance with OHLCV data
        market_open_minute: Minute of market open (typically 30 for :30 open)
        
    Returns:
        List of candle dicts sorted oldest to newest
    """
    if hist_df.empty:
        return []
    
    candles = []
    i = 0
    rows = list(hist_df.iterrows())
    
    while i < len(rows):
        idx, row = rows[i]
        minute = idx.minute
        
        if minute == market_open_minute:
            # This is a :30 candle (market-open aligned)
            hour = idx.hour
            
            # Check if it's market open hour (first candle of the day)
            # We detect this by checking if there's no earlier candle on the same day
            is_first_of_day = True
            if i > 0:
                prev_idx = rows[i-1][0]
                if prev_idx.date() == idx.date():
                    is_first_of_day = False
            
            if is_first_of_day:
                # Market open candle - keep as is (30 minutes only)
                candles.append({
                    'datetime': idx,
                    'open': row['Open'],
                    'high': row['High'],
                    'low': row['Low'],
                    'close': row['Close'],
                    'volume': row['Volume'],
                })
                i += 1
            else:
                # Non-market-open :30 candle - this shouldn't happen with 30-min data
                # but skip it if it does (let the :00 candle be primary)
                i += 1
        else:
            # This is a :00 candle - combine with following :30 candle if available
            open_price = row['Open']
            high_price = row['High']
            low_price = row['Low']
            close_price = row['Close']
            volume = row['Volume']
            
            # Check if next candle is :30 of same hour
            if i + 1 < len(rows):
                next_idx, next_row = rows[i + 1]
                if next_idx.hour == idx.hour and next_idx.minute == market_open_minute:
                    # Combine the two 30-min candles into one hourly candle
                    high_price = max(high_price, next_row['High'])
                    low_price = min(low_price, next_row['Low'])
                    close_price = next_row['Close']
                    volume += next_row['Volume']
                    i += 1  # Skip the :30 candle
            
            candles.append({
                'datetime': idx,
                'open': open_price,
                'high': high_price,
                'low': low_price,
                'close': close_price,
                'volume': volume,
            })
            i += 1
    
    return candles


# Mapping from our asset IDs to stock tickers
STOCK_ID_TO_TICKER = {f'stock-{ticker.lower().replace("-", "")}': ticker for ticker, _, _ in STOCK_TICKERS}

# Mapping from our asset IDs to metal tickers
METAL_ID_TO_TICKER = {f'metal-{info["name"].lower()}': ticker for ticker, info in METAL_TICKERS.items()}

# Mapping from crypto IDs to TwelveData tickers
# Supports both full ID (e.g., 'bitcoin') and symbol (e.g., 'btc')
CRYPTO_ID_TO_TICKER = {info['id']: ticker for ticker, info in CRYPTO_TICKERS.items()}
CRYPTO_ID_TO_TICKER.update({info['symbol'].lower(): ticker for ticker, info in CRYPTO_TICKERS.items()})
# Result: {'bitcoin': 'BTC/USD', 'btc': 'BTC/USD', 'ethereum': 'ETH/USD', 'eth': 'ETH/USD', ...}


@app.route('/api/crypto/<crypto_id>/history', methods=['GET'])
def get_crypto_history(crypto_id):
    """Fetch historical price data for a cryptocurrency from TwelveData API.
    
    Query parameters:
    - days: Number of days of history (7, 30, 90, 365). Default: 30
    - interval: Candle interval ('1m', '5m', '15m', '30m', '60m', '1h', '1d'). Default: auto-selected based on days
    - nocache: If present, bypass cache for fresh data (used for manual refresh)
    
    Note on interval availability:
    - TwelveData provides crypto data 24/7
    - All intervals available for crypto markets
    """
    days = request.args.get('days', 30, type=int)
    requested_interval = request.args.get('interval', None, type=str)
    nocache = request.args.get('nocache', None) is not None
    
    # Validate days parameter
    if days not in DAYS_TO_PERIOD:
        days = 30
    
    # Get the appropriate interval
    interval = get_recommended_interval(days, requested_interval)
    
    # Find the TwelveData ticker for this crypto
    ticker = CRYPTO_ID_TO_TICKER.get(crypto_id.lower())
    if not ticker:
        supported_ids = list(set(info['id'] for info in CRYPTO_TICKERS.values()))
        return jsonify({'error': f'Unknown crypto: {crypto_id}. Supported: {", ".join(supported_ids)}'}), 404
    
    # Find crypto info for response
    crypto_info = None
    for t, info in CRYPTO_TICKERS.items():
        if t == ticker:
            crypto_info = info
            break
    
    if not twelvedata_api.is_available():
        return jsonify({'error': 'TwelveData API not configured'}), 500
    
    try:
        # Calculate output size based on days and interval
        outputsize = twelvedata_api.get_outputsize_for_days(days, interval)
        
        # For crypto, markets are 24/7 so we need more data points
        # Multiply by ~3.5 to account for 24h markets vs 6.5h stock markets
        outputsize = min(int(outputsize * 3.5), 5000)
        
        td_data = twelvedata_api.get_crypto_time_series(
            symbol=ticker,
            interval=interval,
            outputsize=outputsize,
            use_cache=not nocache
        )
        
        if td_data and td_data.get('values'):
            logger.info(f"[CRYPTO HISTORY] {crypto_id} - Source: TWELVEDATA - Interval: {interval} - Points: {len(td_data.get('values', []))}")
            return jsonify(twelvedata_api.format_crypto_history_response(
                crypto_id=crypto_info['id'] if crypto_info else crypto_id,
                symbol=ticker,
                td_data=td_data,
                days=days,
                interval=interval,
            ))
        else:
            return jsonify({'error': f'No data found for {crypto_id}'}), 404
        
    except Exception as e:
        logger.error(f"Error fetching crypto history for {crypto_id}: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/crypto/<crypto_id>/details', methods=['GET'])
def get_crypto_details(crypto_id):
    """Fetch detailed information for a cryptocurrency using TwelveData API.
    
    Note: TwelveData free tier doesn't provide market cap, supply data, etc.
    We return what's available: price, 24h change, 52-week range (from history).
    """
    # Find the TwelveData ticker for this crypto (e.g., 'BTC/USD')
    ticker = CRYPTO_ID_TO_TICKER.get(crypto_id.lower())
    if not ticker:
        supported = list(set(CRYPTO_ID_TO_TICKER.keys()))
        return jsonify({'error': f'Unknown crypto: {crypto_id}. Supported: {", ".join(sorted(supported))}'}), 404
    
    # Find our crypto config for name/image
    crypto_info = None
    for t, info in CRYPTO_TICKERS.items():
        if t == ticker:
            crypto_info = info
            break
    
    if not crypto_info:
        return jsonify({'error': f'Crypto config not found for {crypto_id}'}), 404
    
    try:
        # Get current quote from TwelveData
        quote = twelvedata_api.get_crypto_quote(ticker)
        
        if not quote or 'error' in quote:
            error_msg = quote.get('message', 'Unknown error') if quote else 'No data returned'
            return jsonify({'error': f'Failed to fetch crypto quote: {error_msg}'}), 500
        
        price = float(quote.get('close', 0))
        open_price = float(quote.get('open', 0))
        day_high = float(quote.get('high', 0))
        day_low = float(quote.get('low', 0))
        previous_close = float(quote.get('previous_close', 0))
        volume = float(quote.get('volume', 0)) if quote.get('volume') else None
        
        # Calculate 24h change
        price_change_24h = 0
        price_change_pct = 0
        if previous_close and price:
            price_change_24h = price - previous_close
            price_change_pct = (price_change_24h / previous_close) * 100
        
        # Try to get 52-week high/low from historical data (365 days of daily candles)
        fifty_two_week_high = None
        fifty_two_week_low = None
        try:
            history = twelvedata_api.get_crypto_time_series(ticker, interval='1day', outputsize=365)
            if history and history.get('values'):
                highs = [float(v['high']) for v in history['values'] if v.get('high')]
                lows = [float(v['low']) for v in history['values'] if v.get('low')]
                if highs:
                    fifty_two_week_high = max(highs)
                if lows:
                    fifty_two_week_low = min(lows)
        except Exception as e:
            logger.warning(f"Could not fetch 52-week range for {crypto_id}: {e}")
        
        # Get circulating supply and market cap from yfinance
        yf_ticker = ticker.replace('/', '-')
        circulating_supply = None
        total_supply = None
        max_supply = None
        market_cap = None
        try:
            crypto_yf, yf_info = yf_ticker_with_retry(yf_ticker)
            circulating_supply = yf_info.get('circulatingSupply')
            total_supply = yf_info.get('totalSupply')
            max_supply_val = yf_info.get('maxSupply')
            max_supply = max_supply_val if max_supply_val and max_supply_val > 0 else None
            if circulating_supply and price:
                market_cap = int(circulating_supply * price)
        except Exception as e:
            logger.warning(f"Could not fetch yfinance supply data for {crypto_id}: {e}")
        
        # Crypto homepage links
        crypto_links = {
            'bitcoin': 'https://bitcoin.org',
            'btc': 'https://bitcoin.org',
            'ethereum': 'https://ethereum.org',
            'eth': 'https://ethereum.org',
            'binancecoin': 'https://www.bnbchain.org',
            'bnb': 'https://www.bnbchain.org',
            'cardano': 'https://cardano.org',
            'ada': 'https://cardano.org',
            'ripple': 'https://ripple.com',
            'xrp': 'https://ripple.com',
            'solana': 'https://solana.com',
            'sol': 'https://solana.com',
            'tron': 'https://tron.network',
            'trx': 'https://tron.network',
            'dogecoin': 'https://dogecoin.com',
            'doge': 'https://dogecoin.com',
        }
        homepage = crypto_links.get(crypto_id.lower(), '')
        
        details = {
            'id': crypto_id,
            'name': crypto_info['name'],
            'symbol': crypto_info['symbol'],
            'image': crypto_info['image'],
            'description': '',  # TwelveData doesn't provide descriptions
            'market_data': {
                'current_price': price,
                'market_cap': market_cap,
                'previous_close': previous_close if previous_close else None,
                'open': open_price if open_price else None,
                'day_high': day_high if day_high else None,
                'day_low': day_low if day_low else None,
                'volume': volume,
                'average_volume': None,  # Not available from TwelveData
                'fifty_two_week_high': fifty_two_week_high,
                'fifty_two_week_low': fifty_two_week_low,
                'price_change_24h': round(price_change_24h, 2),
                'price_change_percentage_24h': round(price_change_pct, 2),
                'circulating_supply': circulating_supply,
                'total_supply': total_supply,
                'max_supply': max_supply,
            },
            'links': {
                'homepage': homepage,
            },
        }
        
        logger.info(f"[CRYPTO DETAILS] {crypto_id} - Source: TWELVEDATA - Price: ${price:.2f}")
        return jsonify(details)
        
    except Exception as e:
        logger.error(f"Error fetching crypto details for {crypto_id}: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/stocks/<symbol>/history', methods=['GET'])
def get_stock_history(symbol):
    """Fetch historical price data for a stock.
    
    Uses Twelve Data API as primary source for better intraday data quality,
    with yfinance as fallback if Twelve Data is unavailable or rate limited.
    
    Query parameters:
    - days: Number of days of history (7, 30, 90, 365). Default: 30
    - interval: Candle interval ('1m', '5m', '15m', '30m', '60m', '1h', '1d'). Default: auto-selected based on days
    - nocache: If present, bypass cache for fresh data (used for manual refresh)
    
    Note on interval availability:
    - 1m: only last 7 days
    - 5m: only last 60 days  
    - 1h: only last 730 days
    - 1d: full history
    """
    days = request.args.get('days', 30, type=int)
    requested_interval = request.args.get('interval', None, type=str)
    nocache = request.args.get('nocache', None) is not None
    
    # Validate days parameter
    if days not in DAYS_TO_PERIOD:
        days = 30
    
    period = DAYS_TO_PERIOD[days]
    
    # Get the appropriate interval
    interval = get_recommended_interval(days, requested_interval)
    
    # Get currency and exchange timezone from yfinance for the response
    # This is a quick lookup that's often cached
    try:
        _, stock_info = yf_ticker_with_retry(symbol)
        currency = stock_info.get('currency', 'USD')
        # Get exchange timezone (e.g., 'Asia/Hong_Kong', 'Asia/Tokyo', 'America/New_York')
        exchange_timezone = stock_info.get('exchangeTimezoneName', 'America/New_York')
    except Exception:
        currency = 'USD'
        exchange_timezone = 'America/New_York'
    
    # Try Twelve Data first for stocks (better intraday data quality)
    if twelvedata_api.is_available():
        outputsize = twelvedata_api.get_outputsize_for_days(days, interval, exchange_timezone)
        
        # Use hour-aligned candles for hourly interval
        # This gives us candles at :00 instead of market-open-aligned :30
        if interval == '1h':
            td_data = twelvedata_api.get_time_series_hourly_aligned(
                symbol=symbol,
                outputsize=outputsize,
                use_cache=not nocache  # Bypass cache if nocache is set
            )
        else:
            td_data = twelvedata_api.get_time_series(
                symbol=symbol,
                interval=interval,
                outputsize=outputsize,
                use_cache=not nocache  # Bypass cache if nocache is set
            )
        
        if td_data and td_data.get('values'):
            logger.info(f"[STOCK HISTORY] {symbol} - Source: TWELVEDATA - Interval: {interval} - Points: {len(td_data.get('values', []))} - Currency: {currency}")
            return jsonify(twelvedata_api.format_history_response(
                symbol=symbol,
                td_data=td_data,
                days=days,
                interval=interval,
                currency=currency,
                exchange_timezone=exchange_timezone
            ))
        else:
            logger.warning(f"[STOCK HISTORY] {symbol} - Source: TWELVEDATA FAILED - Falling back to yfinance")
    
    # Fallback to yfinance
    try:
        stock = yf.Ticker(symbol)
        
        # For hourly interval, fetch 30-min data and aggregate to hour-aligned candles
        # This gives us candles at :00 instead of market-open-aligned :30
        if interval == '1h':
            hist = yf_history_with_retry(stock, period=period, interval='30m')
            
            if hist.empty:
                return jsonify({'error': f'No data found for {symbol}'}), 404
            
            # Aggregate 30-min candles to hour-aligned candles
            aggregated = aggregate_to_hourly_aligned(hist)
            
            # Format the aggregated data
            history = [
                {
                    'date': candle['datetime'].strftime('%Y-%m-%d %H:%M'),
                    'timestamp': int(candle['datetime'].timestamp() * 1000),
                    'price': candle['close'],
                    'open': candle['open'],
                    'high': candle['high'],
                    'low': candle['low'],
                    'volume': candle['volume'],
                }
                for candle in aggregated
            ]
            
            logger.info(f"[STOCK HISTORY] {symbol} - Source: YFINANCE (hour-aligned) - Interval: {interval} - Points: {len(history)} - Currency: {currency}")
        else:
            hist = yf_history_with_retry(stock, period=period, interval=interval)
            
            if hist.empty:
                return jsonify({'error': f'No data found for {symbol}'}), 404
            
            # Format date/time based on interval (include time for intraday)
            is_intraday = interval != '1d'
            date_format = '%Y-%m-%d %H:%M' if is_intraday else '%Y-%m-%d'
            
            # Transform data
            history = [
                {
                    'date': index.strftime(date_format),
                    'timestamp': int(index.timestamp() * 1000),
                    'price': row['Close'],
                    'open': row['Open'],
                    'high': row['High'],
                    'low': row['Low'],
                    'volume': row['Volume'],
                }
                for index, row in hist.iterrows()
            ]
            
            logger.info(f"[STOCK HISTORY] {symbol} - Source: YFINANCE - Interval: {interval} - Points: {len(history)} - Currency: {currency}")
        
        return jsonify({
            'id': f'stock-{symbol.lower().replace("-", "")}',
            'symbol': symbol,
            'days': days,
            'interval': interval,
            'source': 'yfinance',
            'currency': currency,
            'exchange_timezone': exchange_timezone,
            'history': history,
        })
        
    except EmptyHistoryError as e:
        # User-friendly error for empty history (common with international stocks)
        logger.warning(f"[STOCK HISTORY] {symbol} - Empty history after retries: {e}")
        return jsonify({
            'error': e.user_message,
            'error_type': 'empty_history',
            'symbol': e.symbol,
            'no_retry': True  # Tell frontend not to auto-retry
        }), 404
    except Exception as e:
        logger.error(f"Error fetching stock history for {symbol}: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/stocks/<symbol>/details', methods=['GET'])
def get_stock_details(symbol):
    """Fetch detailed information for a stock.
    
    For stocks: Uses TwelveData for real-time trading data (today's OHLCV, 52-week range,
    average volume) and yfinance for valuation metrics and company info.
    
    For non-stocks (crypto, metals): Uses yfinance only.
    
    Supports any valid Yahoo Finance ticker, not just S&P 500 stocks.
    For international tickers (e.g., 7203.T), pass the full symbol including exchange suffix.
    
    For non-USD stocks, price-related data is converted to USD using current forex rates.
    """
    try:
        stock, info = yf_ticker_with_retry(symbol)
        
        if not info or info.get('regularMarketPrice') is None:
            return jsonify({'error': f'No data found for {symbol}'}), 404
        
        # Find the stock name from our S&P 500 config first
        name = None
        for ticker, stock_name, _stock_image in STOCK_TICKERS:
            if ticker == symbol:
                name = stock_name
                break
        
        # Always use CompaniesMarketCap CDN for consistent logos across all pages
        image = get_stock_logo_url(symbol)
        
        # If not in S&P 500 list, get name from Yahoo Finance
        if name is None:
            name = info.get('shortName') or info.get('longName') or symbol
        
        # Get forex rate for currency conversion
        currency = info.get('currency', 'USD')
        forex_rate = get_forex_rate_to_usd(currency) if currency != 'USD' else 1.0
        
        # Helper function to convert price values to USD
        def to_usd(value):
            if value is None:
                return None
            return value * forex_rate
        
        # Determine if this is a stock (not crypto/forex/etc) - check quoteType
        quote_type = info.get('quoteType', '').upper()
        is_stock = quote_type in ('EQUITY', 'ETF', '')
        
        # Get raw native currency values
        native_current_price = info.get('currentPrice') or info.get('regularMarketPrice')
        native_previous_close = info.get('previousClose')
        native_open = info.get('open') or info.get('regularMarketOpen')
        native_day_high = info.get('dayHigh') or info.get('regularMarketDayHigh')
        native_day_low = info.get('dayLow') or info.get('regularMarketDayLow')
        native_52w_high = info.get('fiftyTwoWeekHigh')
        native_52w_low = info.get('fiftyTwoWeekLow')
        
        # Initialize market data with yfinance values (used as fallback and for non-stocks)
        # USD values for: current_price (top-right display), market_cap (always USD)
        # Native currency values for: today's trading, 52-week range (chart consistency)
        market_data = {
            # USD prices for header display and market cap
            'current_price': to_usd(native_current_price),
            'market_cap': to_usd(info.get('marketCap')),
            
            # Native currency prices for today's trading (consistency with chart)
            'previous_close': native_previous_close,
            'open': native_open,
            'day_high': native_day_high,
            'day_low': native_day_low,
            'volume': info.get('volume') or info.get('regularMarketVolume'),
            'average_volume': info.get('averageVolume'),
            
            # Native currency for 52-week range (consistency with chart)
            'fifty_two_week_high': native_52w_high,
            'fifty_two_week_low': native_52w_low,
            
            # Native currency for moving averages (consistency with chart)
            'fifty_day_average': info.get('fiftyDayAverage'),
            'two_hundred_day_average': info.get('twoHundredDayAverage'),
            
            # Ratios and other non-price data
            'trailing_pe': info.get('trailingPE'),
            'forward_pe': info.get('forwardPE'),
            'dividend_yield': info.get('dividendYield'),
            'beta': info.get('beta'),
            'shares_outstanding': info.get('sharesOutstanding'),
            
            # Native currency price for dual display (USD price / Native price)
            'current_price_native': native_current_price,
        }
        
        data_source = 'yfinance'
        
        # For stocks, try to get real-time data from TwelveData
        if is_stock and twelvedata_api.is_available():
            try:
                # Fetch quote for today's trading data and 52-week range
                td_quote = twelvedata_api.get_quote(symbol)
                
                # Fetch statistics only if enabled in config
                # Note: /statistics requires TwelveData Pro plan. On free tier, this call
                # always fails but still consumes 1 API credit. Set STATISTICS_ASSET_PAGE_TWELVEDATA
                # to False in data_refresher.py to skip this and use yfinance instead.
                td_stats = None
                if STATISTICS_ASSET_PAGE_TWELVEDATA:
                    td_stats = twelvedata_api.get_statistics(symbol)
                
                if td_quote:
                    # Get native currency prices from TwelveData
                    td_close = td_quote.get('close')
                    td_previous_close = td_quote.get('previous_close')
                    td_open = td_quote.get('open')
                    td_high = td_quote.get('high')
                    td_low = td_quote.get('low')
                    
                    # USD price for header display
                    market_data['current_price'] = to_usd(td_close)
                    # Native currency price for dual display
                    market_data['current_price_native'] = td_close
                    
                    # Native currency for today's trading (consistency with chart)
                    market_data['previous_close'] = td_previous_close
                    market_data['open'] = td_open
                    market_data['day_high'] = td_high
                    market_data['day_low'] = td_low
                    market_data['volume'] = td_quote.get('volume')
                    
                    # 52-week range from quote (native currency)
                    if td_quote.get('fifty_two_week'):
                        ftw = td_quote['fifty_two_week']
                        if ftw.get('high'):
                            market_data['fifty_two_week_high'] = ftw['high']
                        if ftw.get('low'):
                            market_data['fifty_two_week_low'] = ftw['low']
                    
                    # Average volume from quote (if available)
                    if td_quote.get('average_volume'):
                        market_data['average_volume'] = td_quote['average_volume']
                    
                    data_source = 'twelvedata'
                    logger.info(f"[STOCK DETAILS] {symbol} - Using TwelveData for trading data")
                
                if td_stats:
                    # Update with TwelveData statistics
                    if td_stats.get('shares_outstanding'):
                        market_data['shares_outstanding'] = td_stats['shares_outstanding']
                    if td_stats.get('avg_10_volume'):
                        market_data['average_volume'] = td_stats['avg_10_volume']
                    if td_stats.get('beta'):
                        market_data['beta'] = td_stats['beta']
                    # Moving averages in native currency (consistency with chart)
                    if td_stats.get('day_50_ma'):
                        market_data['fifty_day_average'] = td_stats['day_50_ma']
                    if td_stats.get('day_200_ma'):
                        market_data['two_hundred_day_average'] = td_stats['day_200_ma']
                    # Use TwelveData 52-week from stats if not already set from quote (native currency)
                    if td_stats.get('fifty_two_week_high') and not market_data.get('fifty_two_week_high'):
                        market_data['fifty_two_week_high'] = td_stats['fifty_two_week_high']
                    if td_stats.get('fifty_two_week_low') and not market_data.get('fifty_two_week_low'):
                        market_data['fifty_two_week_low'] = td_stats['fifty_two_week_low']
                
                # Recalculate market cap: yfinance shares × TwelveData current price
                # Use TwelveData shares_outstanding if available, otherwise fall back to yfinance
                shares = market_data.get('shares_outstanding') or info.get('sharesOutstanding')
                current_price = market_data.get('current_price')
                if shares and current_price:
                    market_data['market_cap'] = shares * current_price
                    
            except Exception as td_error:
                logger.warning(f"TwelveData failed for {symbol}, using yfinance: {td_error}")
                data_source = 'yfinance'
        
        details = {
            'id': f'stock-{symbol.lower().replace("-", "")}',
            'name': name,
            'symbol': symbol,
            'image': image,
            'currency': currency,
            'data_source': data_source,
            'market_data': market_data,
            'company_info': {
                'sector': info.get('sector'),
                'industry': info.get('industry'),
                'website': info.get('website'),
                'description': (info.get('longBusinessSummary') or '')[:500],
                'employees': info.get('fullTimeEmployees'),
                'headquarters': f"{info.get('city', '')}, {info.get('country', '')}".strip(', '),
            },
            'exchange_info': {
                'exchange': info.get('exchange'),
                'exchange_timezone': info.get('exchangeTimezoneName'),
                'exchange_timezone_short': info.get('exchangeTimezoneShortName'),
            },
        }
        
        return jsonify(details)
        
    except Exception as e:
        logger.error(f"Error fetching stock details for {symbol}: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/metals/<symbol>/history', methods=['GET'])
def get_metal_history(symbol):
    """Fetch historical price data for a metal from Yahoo Finance.
    
    Query parameters:
    - days: Number of days of history (7, 30, 90, 365). Default: 30
    - interval: Candle interval ('1m', '5m', '15m', '30m', '60m', '1h', '1d'). Default: auto-selected based on days
    
    Note on interval availability:
    - 1m: only last 7 days
    - 5m: only last 60 days  
    - 1h: only last 730 days
    - 1d: full history
    
    Note: Futures contracts (metals) may have data gaps with intraday intervals due to
    yfinance limitations. If intraday data is stale, the endpoint will automatically
    fall back to daily data.
    """
    days = request.args.get('days', 30, type=int)
    requested_interval = request.args.get('interval', None, type=str)
    
    # Validate days parameter
    if days not in DAYS_TO_PERIOD:
        days = 30
    
    period = DAYS_TO_PERIOD[days]
    
    # Get the appropriate interval
    interval = get_recommended_interval(days, requested_interval)
    
    # Find the futures ticker for this metal symbol
    ticker = None
    metal_name = None
    for futures_ticker, info in METAL_TICKERS.items():
        if info['symbol'] == symbol:
            ticker = futures_ticker
            metal_name = info['name']
            break
    
    if not ticker:
        return jsonify({'error': f'Unknown metal symbol: {symbol}'}), 404
    
    try:
        metal = yf.Ticker(ticker)
        hist = yf_history_with_retry(metal, period=period, interval=interval)
        
        # Check if intraday data is stale (more than 2 days old)
        # This handles yfinance data gaps for futures contracts
        actual_interval = interval
        if interval != '1d' and not hist.empty:
            last_timestamp = hist.index[-1]
            # Convert to naive datetime for comparison if timezone-aware
            if hasattr(last_timestamp, 'tz'):
                last_timestamp = last_timestamp.tz_localize(None) if last_timestamp.tz is None else last_timestamp.tz_convert(None)
            
            days_old = (datetime.now() - last_timestamp.to_pydatetime().replace(tzinfo=None)).days
            
            if days_old >= 2:
                logger.warning(f"Metal {symbol} intraday data is {days_old} days old, falling back to daily")
                # Fall back to daily data
                hist = yf_history_with_retry(metal, period=period, interval='1d')
                actual_interval = '1d'
        
        if hist.empty:
            return jsonify({'error': f'No data found for {symbol}'}), 404
        
        # Format date/time based on interval (include time for intraday)
        is_intraday = actual_interval != '1d'
        date_format = '%Y-%m-%d %H:%M' if is_intraday else '%Y-%m-%d'
        
        # Transform data
        history = [
            {
                'date': index.strftime(date_format),
                'timestamp': int(index.timestamp() * 1000),
                'price': row['Close'],
                'open': row['Open'],
                'high': row['High'],
                'low': row['Low'],
                'volume': row['Volume'],
            }
            for index, row in hist.iterrows()
        ]
        
        logger.info(f"[METAL HISTORY] {symbol} ({metal_name}) - Source: YFINANCE - Interval: {actual_interval} - Points: {len(history)}")
        
        return jsonify({
            'id': f'metal-{metal_name.lower()}',
            'symbol': symbol,
            'days': days,
            'interval': actual_interval,
            'source': 'yfinance',
            'history': history,
        })
        
    except Exception as e:
        logger.error(f"Error fetching metal history for {symbol}: {e}")
        return jsonify({'error': str(e)}), 500


# ============= REAL-TIME CURRENT PRICE ENDPOINTS =============
# Lightweight endpoints for polling current prices without full history

@app.route('/api/crypto/<crypto_id>/price', methods=['GET'])
def get_crypto_current_price(crypto_id):
    """Fetch just the current price for a cryptocurrency (lightweight endpoint for polling).
    
    Returns only the current price and 24h change, optimized for frequent polling.
    Uses TwelveData quote endpoint for real-time price.
    """
    ticker = CRYPTO_ID_TO_TICKER.get(crypto_id.lower())
    if not ticker:
        supported = list(set(CRYPTO_ID_TO_TICKER.keys()))
        return jsonify({'error': f'Unknown crypto: {crypto_id}. Supported: {", ".join(sorted(supported))}'}), 404
    
    try:
        # Get quote from TwelveData
        quote = twelvedata_api.get_crypto_quote(ticker)
        
        if not quote or 'error' in quote:
            error_msg = quote.get('message', 'Unknown error') if quote else 'No data returned'
            return jsonify({'error': f'Failed to fetch crypto price: {error_msg}'}), 500
        
        price = float(quote.get('close', 0))
        previous_close = float(quote.get('previous_close', 0)) if quote.get('previous_close') else 0
        
        change_24h = 0
        if previous_close and price:
            change_24h = ((price - previous_close) / previous_close) * 100
        
        # Use datetime timestamp from quote or current time
        import time
        timestamp = int(time.time() * 1000)
        
        return jsonify({
            'id': crypto_id,
            'price': price,
            'change24h': round(change_24h, 2),
            'timestamp': timestamp,
        })
        
    except Exception as e:
        logger.error(f"Error fetching current price for {crypto_id}: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/stocks/<symbol>/price', methods=['GET'])
def get_stock_current_price(symbol):
    """Fetch just the current price for a stock (lightweight endpoint for polling).
    
    Returns only the current price and 24h change, optimized for frequent polling.
    Uses the latest 5m candle to get near-real-time price.
    """
    try:
        stock, info = yf_ticker_with_retry(symbol)
        # Get the most recent 5m candle for near-real-time price
        hist = yf_history_with_retry(stock, period='1d', interval='5m')
        
        if hist.empty:
            return jsonify({'error': f'No data found for {symbol}'}), 404
        
        # Get the latest candle
        latest = hist.iloc[-1]
        latest_price = latest['Close']
        
        # Get previous close for 24h change calculation
        previous_close = info.get('previousClose') or info.get('regularMarketPreviousClose') or 0
        
        # Handle currency conversion for international stocks
        currency = info.get('currency', 'USD')
        if currency != 'USD':
            forex_rate = get_forex_rate_to_usd(currency)
            latest_price = latest_price * forex_rate
            previous_close = previous_close * forex_rate
        
        change_24h = 0
        if previous_close and latest_price:
            change_24h = ((latest_price - previous_close) / previous_close) * 100
        
        return jsonify({
            'id': f'stock-{symbol.lower().replace("-", "")}',
            'symbol': symbol,
            'price': latest_price,
            'change24h': round(change_24h, 2),
            'timestamp': int(hist.index[-1].timestamp() * 1000),
        })
        
    except Exception as e:
        logger.error(f"Error fetching current price for {symbol}: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/metals/<symbol>/price', methods=['GET'])
def get_metal_current_price(symbol):
    """Fetch just the current price for a metal (lightweight endpoint for polling).
    
    Returns only the current price and 24h change, optimized for frequent polling.
    Uses the latest 5m candle to get near-real-time price.
    """
    # Find the futures ticker for this metal symbol
    ticker = None
    metal_name = None
    for futures_ticker, info in METAL_TICKERS.items():
        if info['symbol'] == symbol:
            ticker = futures_ticker
            metal_name = info['name']
            break
    
    if not ticker:
        return jsonify({'error': f'Unknown metal symbol: {symbol}'}), 404
    
    try:
        metal, info = yf_ticker_with_retry(ticker)
        # Get the most recent 5m candle for near-real-time price
        hist = yf_history_with_retry(metal, period='1d', interval='5m')
        
        if hist.empty:
            return jsonify({'error': f'No data found for {symbol}'}), 404
        
        # Get the latest candle
        latest = hist.iloc[-1]
        latest_price = latest['Close']
        
        # Get previous close for 24h change calculation
        previous_close = info.get('previousClose') or info.get('regularMarketPreviousClose') or 0
        
        change_24h = 0
        if previous_close and latest_price:
            change_24h = ((latest_price - previous_close) / previous_close) * 100
        
        return jsonify({
            'id': f'metal-{metal_name.lower()}',
            'symbol': symbol,
            'price': latest_price,
            'change24h': round(change_24h, 2),
            'timestamp': int(hist.index[-1].timestamp() * 1000),
        })
        
    except Exception as e:
        logger.error(f"Error fetching current price for {symbol}: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/stocks/<symbol>/refresh', methods=['GET'])
def refresh_stock_data(symbol):
    """Lightweight refresh endpoint for stocks - returns quote + last candles.
    
    Query parameters:
    - interval: Candle interval for the last candles ('5m', '1h', '1d'). Default: '1h'
    - candles: Number of recent candles to return (1-10). Default: 3
    
    Returns:
    - quote: Current price, previous_close, change data
    - candles: Last N candles for chart update
    - timestamp: Server timestamp
    """
    import time
    
    requested_interval = request.args.get('interval', '1h', type=str)
    num_candles = request.args.get('candles', ASSET_PAGE_REFRESH_CANDLES, type=int)
    num_candles = max(1, min(10, num_candles))  # Clamp between 1 and 10
    
    # Validate interval
    if requested_interval not in VALID_INTERVALS:
        requested_interval = '1h'
    
    # Get currency from yfinance (quick cached lookup)
    try:
        _, stock_info = yf_ticker_with_retry(symbol)
        currency = stock_info.get('currency', 'USD')
        exchange_timezone = stock_info.get('exchangeTimezoneName', 'America/New_York')
    except Exception:
        currency = 'USD'
        exchange_timezone = 'America/New_York'
    
    forex_rate = get_forex_rate_to_usd(currency) if currency != 'USD' else 1.0
    
    result = {
        'id': f'stock-{symbol.lower().replace("-", "")}',
        'symbol': symbol,
        'currency': currency,
        'timestamp': int(time.time() * 1000),
        'quote': None,
        'candles': [],
        'interval': requested_interval,
    }
    
    if not twelvedata_api.is_available():
        # Fallback to yfinance for quote
        try:
            stock, info = yf_ticker_with_retry(symbol)
            price = info.get('currentPrice') or info.get('regularMarketPrice') or 0
            previous_close = info.get('previousClose') or 0
            
            if currency != 'USD':
                price = price * forex_rate
                previous_close = previous_close * forex_rate
            
            change_24h = 0
            if previous_close and price:
                change_24h = ((price - previous_close) / previous_close) * 100
            
            result['quote'] = {
                'price': price,
                'previous_close': previous_close,
                'change_24h': round(change_24h, 2),
            }
            result['source'] = 'yfinance'
            logger.info(f"[STOCK REFRESH] {symbol} - Source: YFINANCE (fallback)")
        except Exception as e:
            logger.error(f"Error in stock refresh fallback for {symbol}: {e}")
            return jsonify({'error': str(e)}), 500
        
        return jsonify(result)
    
    try:
        # Fetch quote (1 TwelveData credit)
        td_quote = twelvedata_api.get_quote(symbol)
        
        if td_quote and td_quote.get('close'):
            price = td_quote['close']
            previous_close = td_quote.get('previous_close') or 0
            
            # Convert to USD if needed
            if currency != 'USD':
                price = price * forex_rate
                previous_close = previous_close * forex_rate
            
            change_24h = 0
            if previous_close and price:
                change_24h = ((price - previous_close) / previous_close) * 100
            
            result['quote'] = {
                'price': price,
                'previous_close': previous_close,
                'change_24h': round(change_24h, 2),
                'open': td_quote.get('open'),
                'high': td_quote.get('high'),
                'low': td_quote.get('low'),
                'volume': td_quote.get('volume'),
            }
        
        # Fetch last few candles (1 TwelveData credit)
        # We request a small outputsize to minimize data transfer
        outputsize = num_candles + 2  # Request a few extra in case of gaps
        
        if requested_interval == '1h':
            td_candles = twelvedata_api.get_time_series_hourly_aligned(
                symbol=symbol,
                outputsize=outputsize,
                use_cache=False  # Always fresh for refresh
            )
        else:
            td_candles = twelvedata_api.get_time_series(
                symbol=symbol,
                interval=requested_interval,
                outputsize=outputsize,
                use_cache=False  # Always fresh for refresh
            )
        
        if td_candles and td_candles.get('values'):
            # TwelveData's get_time_series already returns oldest first (after internal reverse)
            # Take the last N candles (most recent) - they're already in chronological order
            values = td_candles['values'][-num_candles:]
            
            # Determine date format based on interval
            is_intraday = requested_interval != '1d'
            
            candles = []
            for v in values:
                dt_str = v.get('datetime', '')
                # Parse datetime and create timestamp
                try:
                    if is_intraday and ' ' in dt_str:
                        dt = datetime.strptime(dt_str, '%Y-%m-%d %H:%M:%S')
                    else:
                        dt = datetime.strptime(dt_str.split()[0], '%Y-%m-%d')
                    timestamp = int(dt.timestamp() * 1000)
                except Exception:
                    timestamp = 0
                
                candles.append({
                    'date': dt_str,
                    'timestamp': timestamp,
                    'open': float(v.get('open', 0)),
                    'high': float(v.get('high', 0)),
                    'low': float(v.get('low', 0)),
                    'close': float(v.get('close', 0)),
                    'price': float(v.get('close', 0)),  # Alias for compatibility
                    'volume': float(v.get('volume', 0)) if v.get('volume') else 0,
                })
            
            result['candles'] = candles
        
        result['source'] = 'twelvedata'
        logger.info(f"[STOCK REFRESH] {symbol} - Source: TWELVEDATA - Interval: {requested_interval} - Candles: {len(result['candles'])}")
        
        return jsonify(result)
        
    except Exception as e:
        logger.error(f"Error in stock refresh for {symbol}: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/crypto/<crypto_id>/refresh', methods=['GET'])
def refresh_crypto_data(crypto_id):
    """Lightweight refresh endpoint for crypto - returns quote + last candles.
    
    Query parameters:
    - interval: Candle interval for the last candles ('5m', '1h', '1d'). Default: '1h'
    - candles: Number of recent candles to return (1-10). Default: 3
    
    Returns:
    - quote: Current price, previous_close, change data
    - candles: Last N candles for chart update
    - timestamp: Server timestamp
    """
    import time
    
    requested_interval = request.args.get('interval', '1h', type=str)
    num_candles = request.args.get('candles', ASSET_PAGE_REFRESH_CANDLES, type=int)
    num_candles = max(1, min(10, num_candles))  # Clamp between 1 and 10
    
    # Validate interval
    if requested_interval not in VALID_INTERVALS:
        requested_interval = '1h'
    
    # Find the TwelveData ticker for this crypto
    ticker = CRYPTO_ID_TO_TICKER.get(crypto_id.lower())
    if not ticker:
        supported_ids = list(set(info['id'] for info in CRYPTO_TICKERS.values()))
        return jsonify({'error': f'Unknown crypto: {crypto_id}. Supported: {", ".join(supported_ids)}'}), 404
    
    # Find crypto info
    crypto_info = None
    for t, info in CRYPTO_TICKERS.items():
        if t == ticker:
            crypto_info = info
            break
    
    result = {
        'id': f'crypto-{crypto_info["id"] if crypto_info else crypto_id}',
        'symbol': crypto_info['symbol'] if crypto_info else crypto_id.upper(),
        'timestamp': int(time.time() * 1000),
        'quote': None,
        'candles': [],
        'interval': requested_interval,
    }
    
    if not twelvedata_api.is_available():
        return jsonify({'error': 'TwelveData API not configured'}), 500
    
    try:
        # Fetch quote (1 TwelveData credit)
        td_quote = twelvedata_api.get_crypto_quote(ticker)
        
        if td_quote and td_quote.get('close'):
            price = td_quote['close']
            previous_close = td_quote.get('previous_close') or 0
            
            change_24h = 0
            if td_quote.get('percent_change'):
                change_24h = td_quote['percent_change']
            elif previous_close and price:
                change_24h = ((price - previous_close) / previous_close) * 100
            
            result['quote'] = {
                'price': price,
                'previous_close': previous_close,
                'change_24h': round(change_24h, 2),
                'open': td_quote.get('open'),
                'high': td_quote.get('high'),
                'low': td_quote.get('low'),
                'volume': td_quote.get('volume'),
            }
        
        # Fetch last few candles (1 TwelveData credit)
        outputsize = num_candles + 2  # Request a few extra in case of gaps
        
        td_candles = twelvedata_api.get_crypto_time_series(
            symbol=ticker,
            interval=requested_interval,
            outputsize=outputsize,
            use_cache=False  # Always fresh for refresh
        )
        
        if td_candles and td_candles.get('values'):
            # TwelveData's get_crypto_time_series already returns oldest first (after internal reverse)
            # Take the last N candles (most recent) - they're already in chronological order
            values = td_candles['values'][-num_candles:]
            
            # Determine date format based on interval
            is_intraday = requested_interval != '1d'
            
            candles = []
            for v in values:
                dt_str = v.get('datetime', '')
                # Parse datetime and create timestamp
                try:
                    if is_intraday and ' ' in dt_str:
                        dt = datetime.strptime(dt_str, '%Y-%m-%d %H:%M:%S')
                    else:
                        dt = datetime.strptime(dt_str.split()[0], '%Y-%m-%d')
                    timestamp = int(dt.timestamp() * 1000)
                except Exception:
                    timestamp = 0
                
                candles.append({
                    'date': dt_str,
                    'timestamp': timestamp,
                    'open': float(v.get('open', 0)),
                    'high': float(v.get('high', 0)),
                    'low': float(v.get('low', 0)),
                    'close': float(v.get('close', 0)),
                    'price': float(v.get('close', 0)),  # Alias for compatibility
                    'volume': float(v.get('volume', 0)) if v.get('volume') else 0,
                })
            
            result['candles'] = candles
        
        result['source'] = 'twelvedata'
        logger.info(f"[CRYPTO REFRESH] {crypto_id} - Source: TWELVEDATA - Interval: {requested_interval} - Candles: {len(result['candles'])}")
        
        return jsonify(result)
        
    except Exception as e:
        logger.error(f"Error in crypto refresh for {crypto_id}: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/metals/<symbol>/refresh', methods=['GET'])
def refresh_metal_data(symbol):
    """Lightweight refresh endpoint for metals - returns quote + last candles.
    
    Query parameters:
    - interval: Candle interval for the last candles ('5m', '1h', '1d'). Default: '1d'
    - candles: Number of recent candles to return (1-10). Default: 3
    
    Returns:
    - quote: Current price, previous_close, change data
    - candles: Last N candles for chart update
    - timestamp: Server timestamp
    """
    import time
    
    requested_interval = request.args.get('interval', '1d', type=str)
    num_candles = request.args.get('candles', ASSET_PAGE_REFRESH_CANDLES, type=int)
    num_candles = max(1, min(10, num_candles))  # Clamp between 1 and 10
    
    # Validate interval
    if requested_interval not in VALID_INTERVALS:
        requested_interval = '1d'
    
    # Find the futures ticker for this metal symbol
    ticker = None
    metal_info_found = None
    for futures_ticker, info in METAL_TICKERS.items():
        if info['symbol'] == symbol:
            ticker = futures_ticker
            metal_info_found = info
            break
    
    if not ticker:
        return jsonify({'error': f'Unknown metal symbol: {symbol}'}), 404
    
    result = {
        'id': f'metal-{metal_info_found["name"].lower()}',
        'symbol': symbol,
        'timestamp': int(time.time() * 1000),
        'quote': None,
        'candles': [],
        'interval': requested_interval,
        'source': 'yfinance',
    }
    
    try:
        metal, info = yf_ticker_with_retry(ticker)
        
        # Get quote data
        price = info.get('regularMarketPrice') or info.get('previousClose') or 0
        previous_close = info.get('previousClose') or 0
        
        change_24h = 0
        if previous_close and price:
            change_24h = ((price - previous_close) / previous_close) * 100
        
        result['quote'] = {
            'price': price,
            'previous_close': previous_close,
            'change_24h': round(change_24h, 2),
            'open': info.get('regularMarketOpen'),
            'high': info.get('regularMarketDayHigh'),
            'low': info.get('regularMarketDayLow'),
            'volume': info.get('regularMarketVolume'),
        }
        
        # Get last few candles
        # For metals, use a short period to minimize data fetched
        period = '5d' if requested_interval in ['1m', '5m', '15m', '30m'] else '1mo'
        hist = yf_history_with_retry(metal, period=period, interval=requested_interval)
        
        if not hist.empty:
            # Get last N candles
            hist_tail = hist.tail(num_candles)
            
            is_intraday = requested_interval != '1d'
            date_format = '%Y-%m-%d %H:%M' if is_intraday else '%Y-%m-%d'
            
            candles = []
            for index, row in hist_tail.iterrows():
                candles.append({
                    'date': index.strftime(date_format),
                    'timestamp': int(index.timestamp() * 1000),
                    'open': row['Open'],
                    'high': row['High'],
                    'low': row['Low'],
                    'close': row['Close'],
                    'price': row['Close'],  # Alias for compatibility
                    'volume': row['Volume'],
                })
            
            result['candles'] = candles
        
        logger.info(f"[METAL REFRESH] {symbol} - Source: YFINANCE - Interval: {requested_interval} - Candles: {len(result['candles'])}")
        
        return jsonify(result)
        
    except Exception as e:
        logger.error(f"Error in metal refresh for {symbol}: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/metals/<symbol>/details', methods=['GET'])
def get_metal_details(symbol):
    """Fetch detailed information for a metal from Yahoo Finance."""
    # Find the futures ticker for this metal symbol
    ticker = None
    metal_info = None
    for futures_ticker, info in METAL_TICKERS.items():
        if info['symbol'] == symbol:
            ticker = futures_ticker
            metal_info = info
            break
    
    if not ticker:
        return jsonify({'error': f'Unknown metal symbol: {symbol}'}), 404
    
    try:
        metal, info = yf_ticker_with_retry(ticker)
        
        price = info.get('regularMarketPrice') or info.get('previousClose') or 0
        previous_close = info.get('previousClose') or 0
        
        # Get supply from config
        supply = get_supply(symbol)
        market_cap = price * supply if supply else 0
        
        details = {
            'id': f'metal-{metal_info["name"].lower()}',
            'name': metal_info['name'],
            'symbol': symbol,
            'image': metal_info['image'],
            'futures_ticker': ticker,
            'market_data': {
                'current_price': price,
                'market_cap': market_cap,
                'previous_close': previous_close,
                'open': info.get('regularMarketOpen'),
                'day_high': info.get('regularMarketDayHigh'),
                'day_low': info.get('regularMarketDayLow'),
                'volume': info.get('regularMarketVolume'),
                'fifty_two_week_high': info.get('fiftyTwoWeekHigh'),
                'fifty_two_week_low': info.get('fiftyTwoWeekLow'),
                'above_ground_supply': supply,
                'supply_unit': 'troy ounces' if symbol in ['XAU', 'XAG', 'XPT', 'XPD'] else 'metric tonnes',
            },
        }
        
        return jsonify(details)
        
    except Exception as e:
        logger.error(f"Error fetching metal details for {symbol}: {e}")
        return jsonify({'error': str(e)}), 500


# ============= HISTORICAL EVENTS API =============

@app.route('/api/events', methods=['GET'])
def get_events():
    """
    Fetch historical events for chart overlays.
    
    Query parameters:
    - start_date: Start date in YYYY-MM-DD format (required)
    - end_date: End date in YYYY-MM-DD format (required)
    - categories: Comma-separated list of category IDs (optional)
    
    Example: /api/events?start_date=2020-01-01&end_date=2024-12-31&categories=government_shutdown,recession
    """
    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')
    categories_param = request.args.get('categories')
    
    if not start_date or not end_date:
        return jsonify({'error': 'start_date and end_date are required'}), 400
    
    # Parse categories if provided
    categories = None
    if categories_param:
        categories = [c.strip() for c in categories_param.split(',')]
    
    try:
        events = get_events_in_range(start_date, end_date, categories)
        return jsonify({
            'start_date': start_date,
            'end_date': end_date,
            'categories': categories,
            'events': events,
            'count': len(events),
        })
    except ValueError as e:
        return jsonify({'error': f'Invalid date format: {e}'}), 400
    except Exception as e:
        logger.error(f"Error fetching events: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/events/categories', methods=['GET'])
def get_event_categories():
    """Get all available event categories with metadata."""
    return jsonify(get_all_categories())


@app.route('/api/events/all', methods=['GET'])
def get_all_historical_events():
    """Get all historical events (useful for debugging/admin)."""
    return jsonify({
        'events': get_all_events(),
        'count': len(get_all_events()),
    })


# ============= COMEX INVENTORY API =============

import csv
from datetime import datetime

# Load COMEX inventory data from CSV files
def load_comex_inventory_csv(metal_symbol):
    """Load COMEX inventory data for a metal from CSV (XAU for gold, XAG for silver)."""
    file_map = {
        'XAU': 'comex_inventory_gold.csv',
        'XAG': 'comex_inventory_silver.csv',
    }
    
    metal_names = {
        'XAU': 'Gold',
        'XAG': 'Silver',
    }
    
    filename = file_map.get(metal_symbol)
    if not filename:
        return None
    
    file_path = DATA_DIR / filename
    try:
        data = []
        with open(file_path, 'r') as f:
            reader = csv.DictReader(f)
            for row in reader:
                # Parse the date from ISO format (e.g., "2023-01-30T16:00:00.000Z")
                date_str = row['date']
                # Convert to YYYY-MM-DD format
                date_parsed = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
                date_formatted = date_parsed.strftime('%Y-%m-%d')
                
                # Get the inventory value (column name differs by metal)
                inventory_col = f'COMEX Inventory: {metal_names[metal_symbol]} (oz)'
                total = float(row[inventory_col])
                
                data.append({
                    'date': date_formatted,
                    'total': total,
                })
        
        # Get last date for metadata
        last_date = data[-1]['date'] if data else None
        
        return {
            'metadata': {
                'name': f'COMEX {metal_names[metal_symbol]} Inventory',
                'symbol': metal_symbol,
                'unit': 'troy_ounces',
                'source': 'COMEX',
                'description': f'Total COMEX warehouse inventory for {metal_names[metal_symbol].lower()}.',
                'last_updated': last_date,
                'notes': 'Data represents total inventory in COMEX-approved warehouses.',
            },
            'data': data,
        }
    except Exception as e:
        logger.error(f"Error loading COMEX inventory CSV for {metal_symbol}: {e}")
        return None


@app.route('/api/metals/<symbol>/inventory', methods=['GET'])
def get_metal_inventory(symbol):
    """
    Fetch COMEX inventory data for a metal.
    
    Query parameters:
    - days: Number of days of history (default: 365, max: all available data)
    
    Returns:
    - metadata: Information about the data source
    - data: Array of inventory data points with date and total
    """
    # Only gold and silver have COMEX inventory data
    if symbol not in ['XAU', 'XAG']:
        return jsonify({'error': f'COMEX inventory data not available for {symbol}. Only XAU (gold) and XAG (silver) are supported.'}), 404
    
    days = request.args.get('days', 365, type=int)
    
    inventory_data = load_comex_inventory_csv(symbol)
    if not inventory_data:
        return jsonify({'error': f'Failed to load COMEX inventory data for {symbol}'}), 500
    
    # Filter data based on days parameter
    data = inventory_data.get('data', [])
    if days and days > 0 and len(data) > days:
        # Get the most recent 'days' worth of data
        # Data is sorted chronologically, so we take from the end
        data = data[-days:]
    
    return jsonify({
        'symbol': symbol,
        'metadata': inventory_data.get('metadata', {}),
        'data': data,
        'count': len(data),
    })


@app.route('/api/metals/inventory/supported', methods=['GET'])
def get_supported_inventory_metals():
    """Get list of metals that have COMEX inventory data available."""
    return jsonify({
        'supported': ['XAU', 'XAG'],
        'metals': {
            'XAU': {
                'name': 'Gold',
                'description': 'COMEX Gold Inventory',
            },
            'XAG': {
                'name': 'Silver', 
                'description': 'COMEX Silver Inventory',
            },
        },
    })


@app.route('/api/metals/<symbol>/premium', methods=['GET'])
def get_metal_premium(symbol):
    """
    Fetch Shanghai and India premium data for gold or silver (if needed)
    
    Query parameters:
    - region: Optional filter for specific region ('shanghai', 'india', or 'all')
              Default: 'all' returns both regions
    
    Returns:
    - Shanghai premium: SGE spot and SHFE futures vs Western prices
    - India premium: MCX prices vs Western prices
    - Premium calculations (absolute and percentage)
    
    Example: /api/metals/XAU/premium?region=shanghai
    """
    symbol = symbol.upper()
    
    # Only gold and silver have premium data
    if symbol not in ['XAU', 'XAG']:
        return jsonify({
            'error': f'Premium data not available for {symbol}. Only XAU (gold) and XAG (silver) are supported.'
        }), 404
    
    region = request.args.get('region', 'all').lower()
    metal = 'gold' if symbol == 'XAU' else 'silver'
    
    try:
        if region == 'shanghai':
            data = get_shanghai_premium_data(metal)
            if 'error' in data:
                return jsonify(data), 500
            logger.info(f"[METAL PREMIUM] {symbol} - Source: METALCHARTS.ORG - Region: Shanghai")
            return jsonify({
                'symbol': symbol,
                'metal': metal,
                'shanghai': data,
            })
        elif region == 'india':
            data = get_india_premium_data(metal)
            if 'error' in data:
                return jsonify(data), 500
            logger.info(f"[METAL PREMIUM] {symbol} - Source: METALCHARTS.ORG - Region: India")
            return jsonify({
                'symbol': symbol,
                'metal': metal,
                'india': data,
            })
        else:  # 'all'
            data = get_all_premium_data(metal)
            logger.info(f"[METAL PREMIUM] {symbol} - Source: METALCHARTS.ORG - Region: All")
            return jsonify({
                'symbol': symbol,
                **data,
            })
    except Exception as e:
        logger.error(f"Error fetching premium data for {symbol}: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/metals/premium/supported', methods=['GET'])
def get_supported_premium_metals():
    """Get list of metals that have premium data available."""
    return jsonify({
        'supported': ['XAU', 'XAG'],
        'regions': ['shanghai', 'india'],
        'metals': {
            'XAU': {
                'name': 'Gold',
                'description': 'Shanghai and India gold premiums',
            },
            'XAG': {
                'name': 'Silver',
                'description': 'Shanghai and India silver premiums',
            },
        },
        'data_sources': {
            'shanghai': {
                'spot': 'Shanghai Gold Exchange (SGE)',
                'futures': 'Shanghai Futures Exchange (SHFE)',
                'library': 'akshare',
            },
            'india': {
                'spot': 'MCX (Multi Commodity Exchange)',
                'futures': 'MCX Futures',
                'fallback': 'Indian ETFs (GOLDBEES.NS, SILVERBEES.NS)',
            },
            'western': {
                'futures': 'COMEX via Yahoo Finance',
            },
        },
    })


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('FLASK_DEBUG', 'true').lower() == 'true'
    app.run(host='0.0.0.0', port=port, debug=debug)
