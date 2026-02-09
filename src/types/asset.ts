export type AssetType = 'crypto' | 'stock' | 'metal' | 'etf';

export interface Asset {
  id: string;
  rank: number;
  name: string;
  symbol: string;
  marketCap: number;
  price: number;
  change24h: number;
  change7d?: number;
  change30d?: number;
  change60d?: number;
  change90d?: number;
  change180d?: number;
  changeYtd?: number;
  type: AssetType;
  image?: string;
  error?: string; // Error message if data failed to load
}

export type SortField = 'rank' | 'name' | 'marketCap' | 'price' | 'change24h' | 'change7d' | 'change30d' | 'change60d' | 'change90d' | 'change180d' | 'changeYtd';

// Change column configuration
export type ChangeColumn = 'change7d' | 'change30d' | 'change60d' | 'change90d' | 'change180d' | 'changeYtd';

export const DEFAULT_VISIBLE_COLUMNS: ChangeColumn[] = ['change7d', 'change30d'];
export const ALL_CHANGE_COLUMNS: ChangeColumn[] = ['change7d', 'change30d', 'change60d', 'change90d', 'changeYtd', 'change180d'];
export type SortDirection = 'asc' | 'desc';

export interface SortConfig {
  field: SortField;
  direction: SortDirection;
}

// Historical price data point
export interface PricePoint {
  date: string;
  timestamp: number;
  price: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
}

export interface HistoryResponse {
  id: string;
  symbol?: string;
  days: number;
  interval?: CandleInterval;
  currency?: string;  // Currency code for price data (USD, HKD, JPY, etc.)
  exchange_timezone?: string;  // IANA timezone of the exchange (e.g., 'Asia/Hong_Kong')
  history: PricePoint[];
}

// Extended details for crypto assets
export interface CryptoDetails {
  id: string;
  name: string;
  symbol: string;
  image?: string;
  description?: string;
  market_data: {
    current_price?: number;
    market_cap?: number;
    market_cap_rank?: number;
    fully_diluted_valuation?: number;
    total_volume?: number;
    volume?: number;  // Daily volume from TwelveData
    high_24h?: number;
    low_24h?: number;
    price_change_24h?: number;
    price_change_percentage_24h?: number;
    market_cap_change_24h?: number;
    market_cap_change_percentage_24h?: number;
    circulating_supply?: number;
    total_supply?: number;
    max_supply?: number;
    ath?: number;
    ath_change_percentage?: number;
    ath_date?: string;
    atl?: number;
    atl_change_percentage?: number;
    atl_date?: string;
    // Trading data from TwelveData
    previous_close?: number;
    open?: number;
    day_high?: number;
    day_low?: number;
    fifty_two_week_high?: number;
    fifty_two_week_low?: number;
  };
  links?: {
    homepage?: string;
    blockchain_site?: string;
  };
}

// Extended details for stock assets
export interface StockDetails {
  id: string;
  name: string;
  symbol: string;
  image?: string;
  currency?: string;  // Currency code (USD, HKD, JPY, etc.)
  market_data: {
    current_price?: number;  // Always in USD for header display
    current_price_native?: number;  // Native currency price for dual display
    market_cap?: number;  // Always in USD
    previous_close?: number;  // Native currency
    open?: number;  // Native currency
    day_high?: number;  // Native currency
    day_low?: number;  // Native currency
    volume?: number;
    average_volume?: number;
    fifty_two_week_high?: number;  // Native currency
    fifty_two_week_low?: number;  // Native currency
    fifty_day_average?: number;  // Native currency
    two_hundred_day_average?: number;  // Native currency
    trailing_pe?: number;
    forward_pe?: number;
    dividend_yield?: number;
    beta?: number;
    shares_outstanding?: number;
  };
  company_info?: {
    sector?: string;
    industry?: string;
    website?: string;
    description?: string;
    employees?: number;
    headquarters?: string;
  };
  exchange_info?: {
    exchange?: string;
    exchange_timezone?: string;
    exchange_timezone_short?: string;
  };
}

// Extended details for metal assets
export interface MetalDetails {
  id: string;
  name: string;
  symbol: string;
  image?: string;
  futures_ticker?: string;
  market_data: {
    current_price?: number;
    market_cap?: number;
    previous_close?: number;
    open?: number;
    day_high?: number;
    day_low?: number;
    volume?: number;
    fifty_two_week_high?: number;
    fifty_two_week_low?: number;
    above_ground_supply?: number;
    supply_unit?: string;
  };
}

export type AssetDetails = CryptoDetails | StockDetails | MetalDetails;

// OLD: TimeRange was number of days (7, 30, 90, 365)
// NEW: CandleInterval is the candle duration, like TradingView
// Users scroll to see more history instead of selecting days

export type TimeRange = 7 | 30 | 90 | 365;

// Candle intervals for chart display (TradingView-style)
// Each option defines how much time one candle represents
// Note on data availability from yfinance:
// - 1m: only last 7 days
// - 5m: only last 60 days
// - 15m: only last 60 days
// - 1h: only last 730 days (~2 years)
// - 1d: full history
export type CandleInterval = '5m' | '15m' | '1h' | '1d';

// Mapping from CandleInterval to display label
export const CANDLE_INTERVAL_LABELS: Record<CandleInterval, string> = {
  '5m': '5m',
  '15m': '15m',
  '1h': '1H',
  '1d': 'D',
};

// How many candles to fetch initially for each interval (provides good scroll range)
// This determines how much history the user can scroll through
export const CANDLE_FETCH_COUNT: Record<CandleInterval, number> = {
  '5m': 500,   // ~500 candles = ~4-5 trading days at 5m
  '15m': 400,  // ~400 candles = ~12-15 trading days at 15m
  '1h': 500,   // ~500 candles = ~70+ trading days at 1h  
  '1d': 365,   // ~365 candles = ~1 year+ of daily data
};

// How many days of history to request from API for each interval
// yfinance needs a period, so we map interval to appropriate period
export const CANDLE_INTERVAL_DAYS: Record<CandleInterval, number> = {
  '5m': 7,     // 5m data only available for last 7 days (yfinance limit)
  '15m': 30,   // 15m data for ~1 month
  '1h': 90,    // 1h data for ~3 months
  '1d': 365,   // Daily data for 1 year
};

// DEPRECATED: Old mapping for backwards compatibility
// Recommended intervals for each timeframe (old system)
export const TIMEFRAME_INTERVALS: Record<TimeRange, CandleInterval> = {
  7: '5m',   // 7 days: use 5-minute candles
  30: '1h',  // 1 month: use hourly candles
  90: '1h',  // 3 months: use hourly candles
  365: '1d', // 1 year: use daily candles
};

// Current price response (lightweight for polling)
export interface CurrentPriceResponse {
  id: string;
  symbol?: string;
  price: number;
  change24h: number;
  timestamp: number;
}

// ============= HISTORICAL EVENTS TYPES =============

export type EventCategory = 
  | 'government_shutdown' 
  | 'recession' 
  | 'fed_rate_hike' 
  | 'fed_rate_cut'
  | 'fed_rate_hold';

export type EventImpact = 'low' | 'medium' | 'high';

export interface EventCategoryInfo {
  name: string;
  description: string;
  color: string;
  icon: string;
}

export interface HistoricalEvent {
  id: string;
  category: EventCategory;
  start_date: string;  // YYYY-MM-DD format
  end_date: string;    // YYYY-MM-DD format
  title: string;
  description: string;
  impact: EventImpact;
  category_info: EventCategoryInfo;
}

export interface EventsResponse {
  start_date: string;
  end_date: string;
  categories: EventCategory[] | null;
  events: HistoricalEvent[];
  count: number;
}

export interface EventCategoriesResponse {
  [key: string]: EventCategoryInfo;
}

// ============= COMEX INVENTORY TYPES =============

export interface InventoryDataPoint {
  date: string;
  total: number;
  dailyChange?: number;  // Daily change in inventory (current - previous)
  dailyChangePercent?: number;  // Daily change as percentage
}

export interface InventoryMetadata {
  name: string;
  symbol: string;
  unit: string;
  source: string;
  description: string;
  last_updated: string;
  notes: string;
}

export interface InventoryResponse {
  symbol: string;
  metadata: InventoryMetadata;
  data: InventoryDataPoint[];
  count: number;
}

// ============= CHART TYPES =============

export type ChartType = 'line' | 'ohlc' | 'candlestick';

// ============= TECHNICAL INDICATORS TYPES =============

export type MovingAverageType = 'SMA' | 'EMA';

export interface MovingAverageConfig {
  enabled: boolean;
  type: MovingAverageType;
  period: number;
  color: string;
}

export interface BollingerBandsConfig {
  enabled: boolean;
  period: number;
  standardDeviations: number;
  color: string;
}

export interface TechnicalIndicatorsConfig {
  movingAverage1: MovingAverageConfig;
  movingAverage2: MovingAverageConfig;
  bollingerBands: BollingerBandsConfig;
}

// Default configurations
export const DEFAULT_MA1_CONFIG: MovingAverageConfig = {
  enabled: false,
  type: 'EMA',
  period: 20,
  color: '#2196f3', // Blue
};

export const DEFAULT_MA2_CONFIG: MovingAverageConfig = {
  enabled: false,
  type: 'EMA',
  period: 50,
  color: '#ff9800', // Orange
};

export const DEFAULT_BOLLINGER_CONFIG: BollingerBandsConfig = {
  enabled: false,
  period: 20,
  standardDeviations: 2,
  color: '#9c27b0', // Purple
};

export const DEFAULT_INDICATORS_CONFIG: TechnicalIndicatorsConfig = {
  movingAverage1: DEFAULT_MA1_CONFIG,
  movingAverage2: DEFAULT_MA2_CONFIG,
  bollingerBands: DEFAULT_BOLLINGER_CONFIG,
};

// Common MA periods for dropdown
export const MA_PERIODS = [5, 10, 20, 50, 100, 200];

// ============= CALCULATED INDICATOR DATA =============

export interface IndicatorDataPoint {
  date: string;
  timestamp: number;
  ma1?: number;
  ma2?: number;
  bbUpper?: number;
  bbMiddle?: number;
  bbLower?: number;
}
