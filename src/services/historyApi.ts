import { 
  HistoryResponse, 
  CryptoDetails, 
  StockDetails, 
  MetalDetails, 
  AssetType, 
  TimeRange,
  CandleInterval,
  CurrentPriceResponse,
  TIMEFRAME_INTERVALS,
  CANDLE_INTERVAL_DAYS
} from '../types/asset';
import { RateLimitError, ServerTimeoutError, SymbolNotFoundError, EmptyHistoryError } from './errors';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

// Retry configuration for 522 Server Errors
const RETRY_DELAY_MS = 5000; // 5 seconds
const MAX_RETRIES = 2;

/**
 * Sleep for a specified number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if an error message indicates a 522 Server Error (Cloudflare timeout)
 */
function is522Error(errorMessage: string): boolean {
  return errorMessage.includes('522') || errorMessage.includes('Server Error:');
}

/**
 * Check if an error message indicates a delisted/not found symbol
 */
function isDelistedError(errorMessage: string): boolean {
  const lowerMessage = errorMessage.toLowerCase();
  return lowerMessage.includes('delisted') || 
         lowerMessage.includes('no price data found') ||
         lowerMessage.includes('no data found') ||
         lowerMessage.includes('symbol may be delisted');
}

/**
 * Extract symbol from error message (e.g., "$NEWM: possibly delisted" -> "NEWM")
 */
function extractSymbolFromErrorMessage(errorMessage: string): string | null {
  // Match $SYMBOL pattern
  const dollarMatch = errorMessage.match(/\$([A-Z0-9.]+)/);
  if (dollarMatch) {
    return dollarMatch[1];
  }
  // Match "for SYMBOL" pattern
  const forMatch = errorMessage.match(/for\s+([A-Z0-9.]+)/i);
  if (forMatch) {
    return forMatch[1];
  }
  return null;
}

/**
 * Check if a response indicates rate limiting and throw appropriate error
 */
async function handleResponseError(response: Response, symbol?: string): Promise<never> {
  const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
  const errorMessage = errorData.error || `HTTP ${response.status}`;
  
  // Check for rate limit indicators
  if (
    response.status === 429 ||
    errorMessage.toLowerCase().includes('rate limit') ||
    errorMessage.toLowerCase().includes('too many requests')
  ) {
    // Parse wait time from response (backend sends retry_after in seconds)
    const waitTime = errorData.retry_after || 
                     parseFloat(response.headers.get('Retry-After') || '0') ||
                     0;
    throw new RateLimitError(errorMessage, waitTime);
  }
  
  // Check for 522 Server Error (Cloudflare timeout)
  if (response.status === 522 || is522Error(errorMessage)) {
    throw new ServerTimeoutError(errorMessage);
  }
  
  // Check for empty history error (backend sends error_type: 'empty_history')
  // This is a non-retriable error - user should check back later
  if (errorData.error_type === 'empty_history' || errorData.no_retry) {
    const extractedSymbol = errorData.symbol || symbol || 'Unknown';
    throw new EmptyHistoryError(extractedSymbol, errorMessage);
  }
  
  // Check for delisted/not found symbol
  if (isDelistedError(errorMessage)) {
    const extractedSymbol = extractSymbolFromErrorMessage(errorMessage) || symbol || 'Unknown';
    throw new SymbolNotFoundError(extractedSymbol, errorMessage);
  }
  
  throw new Error(errorMessage);
}

/**
 * Generic fetch with retry logic for 522 errors
 * Silently retries up to MAX_RETRIES times with RETRY_DELAY_MS delay
 */
async function fetchWithRetry<T>(
  fetchFn: () => Promise<T>,
  context: string
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fetchFn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Don't retry for non-522 errors
      if (!(error instanceof ServerTimeoutError) && !is522Error(lastError.message)) {
        throw error;
      }
      
      // Log the retry attempt
      if (attempt < MAX_RETRIES) {
        console.log(
          `[522 Retry] ${context} - Attempt ${attempt + 1}/${MAX_RETRIES + 1} failed with 522 error. ` +
          `Retrying in ${RETRY_DELAY_MS / 1000}s...`
        );
        await sleep(RETRY_DELAY_MS);
      } else {
        console.log(
          `[522 Retry] ${context} - All ${MAX_RETRIES + 1} attempts failed with 522 error.`
        );
      }
    }
  }
  
  // All retries exhausted
  throw lastError;
}

/**
 * Extract the raw ID from our prefixed asset IDs
 * e.g., "crypto-bitcoin" -> "bitcoin", "stock-aapl" -> "AAPL", "stock-7203.t" -> "7203.T"
 */
function extractId(assetId: string, type: AssetType): string {
  const rawId = assetId.replace(`${type}-`, '');
  if (type === 'stock') {
    // Convert back to ticker format (uppercase, handle special cases like BRK-B)
    // Preserve dots for international tickers (e.g., 7203.T for Tokyo Stock Exchange)
    return rawId.toUpperCase().replace('BRKB', 'BRK-B');
  }
  return rawId;
}

/**
 * Extract symbol for metals (e.g., "metal-gold" -> we need to find XAU)
 */
const METAL_SYMBOL_MAP: Record<string, string> = {
  'gold': 'XAU',
  'silver': 'XAG',
  'platinum': 'XPT',
  'palladium': 'XPD',
  'copper': 'HG',
};

/**
 * Fetch asset history with TradingView-style candle intervals.
 * 
 * NEW API: Use candleInterval directly (e.g., '5m', '15m', '1h', '1d')
 * The days parameter is now computed from the interval to maximize available history.
 * 
 * LEGACY API: If days is provided as a number, use old behavior for backwards compatibility.
 */
export async function fetchAssetHistory(
  assetId: string,
  type: AssetType,
  daysOrInterval: TimeRange | CandleInterval = '1h',
  interval?: CandleInterval,
  nocache: boolean = false
): Promise<HistoryResponse> {
  let effectiveInterval: CandleInterval;
  let days: number;
  
  // Check if using new interval-based API or legacy days-based API
  if (typeof daysOrInterval === 'string') {
    // NEW: Using candle interval directly (TradingView style)
    effectiveInterval = daysOrInterval as CandleInterval;
    days = CANDLE_INTERVAL_DAYS[effectiveInterval];
  } else {
    // LEGACY: Using days with optional interval override
    days = daysOrInterval;
    effectiveInterval = interval || TIMEFRAME_INTERVALS[days as TimeRange];
  }
  
  // Build query parameters
  const params = new URLSearchParams({
    days: days.toString(),
    interval: effectiveInterval,
  });
  
  // Add nocache parameter for manual refresh to bypass server-side cache
  if (nocache) {
    params.append('nocache', '1');
  }
  
  let endpoint: string;
  let symbol: string;
  
  switch (type) {
    case 'crypto': {
      symbol = extractId(assetId, type);
      endpoint = `${API_URL}/api/crypto/${symbol}/history?${params}`;
      break;
    }
    case 'stock': {
      symbol = extractId(assetId, type);
      endpoint = `${API_URL}/api/stocks/${symbol}/history?${params}`;
      break;
    }
    case 'metal': {
      const metalName = assetId.replace('metal-', '');
      symbol = METAL_SYMBOL_MAP[metalName] || metalName.toUpperCase();
      endpoint = `${API_URL}/api/metals/${symbol}/history?${params}`;
      break;
    }
    default:
      throw new Error(`Unknown asset type: ${type}`);
  }
  
  // Use fetchWithRetry for automatic 522 error retry
  return fetchWithRetry(async () => {
    const response = await fetch(endpoint);
    
    if (!response.ok) {
      await handleResponseError(response, symbol);
    }
    
    return response.json();
  }, `fetchAssetHistory(${symbol})`);
}

export async function fetchCryptoDetails(cryptoId: string): Promise<CryptoDetails> {
  const rawId = cryptoId.replace('crypto-', '');
  const endpoint = `${API_URL}/api/crypto/${rawId}/details`;
  
  return fetchWithRetry(async () => {
    const response = await fetch(endpoint);
    
    if (!response.ok) {
      await handleResponseError(response, rawId);
    }
    
    return response.json();
  }, `fetchCryptoDetails(${rawId})`);
}

export async function fetchStockDetails(stockId: string): Promise<StockDetails> {
  const rawId = stockId.replace('stock-', '');
  // Convert to uppercase, preserve dots for international tickers (e.g., 7203.T)
  const symbol = rawId.toUpperCase().replace('BRKB', 'BRK-B');
  const endpoint = `${API_URL}/api/stocks/${symbol}/details`;
  
  return fetchWithRetry(async () => {
    const response = await fetch(endpoint);
    
    if (!response.ok) {
      await handleResponseError(response, symbol);
    }
    
    return response.json();
  }, `fetchStockDetails(${symbol})`);
}

export async function fetchMetalDetails(metalId: string): Promise<MetalDetails> {
  const metalName = metalId.replace('metal-', '');
  const symbol = METAL_SYMBOL_MAP[metalName] || metalName.toUpperCase();
  const endpoint = `${API_URL}/api/metals/${symbol}/details`;
  
  return fetchWithRetry(async () => {
    const response = await fetch(endpoint);
    
    if (!response.ok) {
      await handleResponseError(response, symbol);
    }
    
    return response.json();
  }, `fetchMetalDetails(${symbol})`);
}

export async function fetchAssetDetails(
  assetId: string,
  type: AssetType
): Promise<CryptoDetails | StockDetails | MetalDetails> {
  switch (type) {
    case 'crypto':
      return fetchCryptoDetails(assetId);
    case 'stock':
      return fetchStockDetails(assetId);
    case 'metal':
      return fetchMetalDetails(assetId);
    default:
      throw new Error(`Unknown asset type: ${type}`);
  }
}

/**
 * Fetch current price for an asset (lightweight endpoint for polling)
 * Uses 5-minute candles to get near-real-time prices
 */
export async function fetchCurrentPrice(
  assetId: string,
  type: AssetType
): Promise<CurrentPriceResponse> {
  let endpoint: string;
  let symbol: string;
  
  switch (type) {
    case 'crypto': {
      symbol = extractId(assetId, type);
      endpoint = `${API_URL}/api/crypto/${symbol}/price`;
      break;
    }
    case 'stock': {
      symbol = extractId(assetId, type);
      endpoint = `${API_URL}/api/stocks/${symbol}/price`;
      break;
    }
    case 'metal': {
      const metalName = assetId.replace('metal-', '');
      symbol = METAL_SYMBOL_MAP[metalName] || metalName.toUpperCase();
      endpoint = `${API_URL}/api/metals/${symbol}/price`;
      break;
    }
    default:
      throw new Error(`Unknown asset type: ${type}`);
  }
  
  return fetchWithRetry(async () => {
    const response = await fetch(endpoint);
    
    if (!response.ok) {
      await handleResponseError(response, symbol);
    }
    
    return response.json();
  }, `fetchCurrentPrice(${symbol})`);
}

/**
 * Response from the lightweight /refresh endpoints
 * Returns quote data + last few candles for efficient 3-minute auto-refresh
 */
export interface RefreshResponse {
  id: string;
  symbol: string;
  currency?: string;
  timestamp: number;
  source: string;
  interval: string;
  quote: {
    price: number;
    previous_close: number;
    change_24h: number;
    open?: number;
    high?: number;
    low?: number;
    volume?: number;
  } | null;
  candles: Array<{
    date: string;
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    price: number;
    volume: number;
  }>;
}

/**
 * Fetch lightweight refresh data for an asset.
 * Optimized for 3-minute auto-refresh cycle.
 * 
 * Returns:
 * - Quote data (current price, 24h change)
 * - Last few candles (to update chart without full history refetch)
 * 
 * This uses only 2 TwelveData credits instead of 3 for a full refresh (~33% savings).
 */
export async function fetchAssetRefresh(
  assetId: string,
  type: AssetType,
  interval: CandleInterval = '1h',
  numCandles: number = 3
): Promise<RefreshResponse> {
  const params = new URLSearchParams({
    interval,
    candles: numCandles.toString(),
  });
  
  let endpoint: string;
  let symbol: string;
  
  switch (type) {
    case 'crypto': {
      symbol = extractId(assetId, type);
      endpoint = `${API_URL}/api/crypto/${symbol}/refresh?${params}`;
      break;
    }
    case 'stock': {
      symbol = extractId(assetId, type);
      endpoint = `${API_URL}/api/stocks/${symbol}/refresh?${params}`;
      break;
    }
    case 'metal': {
      const metalName = assetId.replace('metal-', '');
      symbol = METAL_SYMBOL_MAP[metalName] || metalName.toUpperCase();
      endpoint = `${API_URL}/api/metals/${symbol}/refresh?${params}`;
      break;
    }
    default:
      throw new Error(`Unknown asset type: ${type}`);
  }
  
  return fetchWithRetry(async () => {
    const response = await fetch(endpoint);
    
    if (!response.ok) {
      await handleResponseError(response, symbol);
    }
    
    return response.json();
  }, `fetchAssetRefresh(${symbol})`);
}
