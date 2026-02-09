import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../hooks/useTheme';
import { useAutoRefreshCountdown } from '../hooks/useAutoRefreshCountdown';
import { LanguageSelector } from '../components/LanguageSelector';
import { SearchBar } from '../components/SearchBar';
import { PriceChart } from '../components/PriceChart';
import { TimeRangeSelector } from '../components/TimeRangeSelector';
import { ChartTypeSelector } from '../components/ChartTypeSelector';
import { IndicatorToolbox } from '../components/IndicatorToolbox';
import { AssetDetails } from '../components/AssetDetails';
import { EventSelector } from '../components/EventSelector';
import { InventoryChart } from '../components/InventoryChart';
import { InventoryOverlayToggle } from '../components/InventoryOverlayToggle';
// import { PremiumPrices } from '../components/PremiumPrices';
import { TimezoneSelector } from '../components/TimezoneSelector';
import { fetchAssetHistory, fetchAssetDetails, fetchAssetRefresh, RefreshResponse } from '../services/historyApi';
import { fetchEventsForChart } from '../services/eventsApi';
import { fetchMetalInventory, hasInventoryData, mergeInventoryWithPriceData, PriceWithInventory } from '../services/inventoryApi';
// import { hasPremiumData } from '../services/premiumApi';
import { isRateLimitError, isSymbolNotFoundError, isEmptyHistoryError, extractSymbolFromError, RateLimitError, EmptyHistoryError } from '../services/errors';
import { useRateLimitRetry, formatSecondsRemaining } from '../hooks/useRateLimitRetry';
import { calculateIndicators, mergeIndicatorsWithPriceData, PriceWithIndicators } from '../utils/technicalIndicators';
import { getUserTimezone, convertTimezone } from '../utils/timezone';
import { 
  AssetType, 
  CandleInterval,
  CANDLE_INTERVAL_DAYS,
  PricePoint, 
  CryptoDetails, 
  StockDetails, 
  MetalDetails,
  EventCategory,
  HistoricalEvent,
  InventoryDataPoint,
  ChartType,
  TechnicalIndicatorsConfig,
  DEFAULT_INDICATORS_CONFIG
} from '../types/asset';
import './AssetDetailPage.css';

function getTypeColor(type: AssetType): string {
  switch (type) {
    case 'crypto':
      return '#f7931a';
    case 'stock':
      return '#4caf50';
    case 'metal':
      return '#ffd700';
    case 'etf':
      return '#2196f3';
    default:
      return '#666';
  }
}

function getTypeLabel(type: AssetType, t: (key: string) => string): string {
  switch (type) {
    case 'crypto':
      return t('assetTypes.crypto');
    case 'stock':
      return t('assetTypes.stock');
    case 'metal':
      return t('assetTypes.metal');
    case 'etf':
      return t('assetTypes.etf');
    default:
      return type;
  }
}

function formatPrice(value: number | undefined | null): string {
  if (value === undefined || value === null) return '$0.00';
  if (value >= 1000) {
    return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (value >= 1) {
    return `$${value.toFixed(2)}`;
  }
  if (value >= 0.01) {
    return `$${value.toFixed(4)}`;
  }
  return `$${value.toFixed(8)}`;
}

// Format price with currency code (e.g., "38.60 HKD" or "1,234.56 JPY")
function formatPriceWithCurrency(value: number | undefined | null, currency: string): string {
  if (value === undefined || value === null) return `0.00 ${currency}`;
  if (value >= 1000) {
    return `${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
  }
  if (value >= 1) {
    return `${value.toFixed(2)} ${currency}`;
  }
  if (value >= 0.01) {
    return `${value.toFixed(4)} ${currency}`;
  }
  return `${value.toFixed(8)} ${currency}`;
}

function formatPercentage(value: number | undefined | null): string {
  if (value === undefined || value === null) return '+0.00%';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

export function AssetDetailPage() {
  const { type, id } = useParams<{ type: string; id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { theme, toggleTheme } = useTheme();
  
  // Candle interval selector (TradingView style: 5m, 15m, 1h, D)
  const [candleInterval, setCandleInterval] = useState<CandleInterval>('1h');
  const [historyData, setHistoryData] = useState<PricePoint[]>([]);
  const [historyCurrency, setHistoryCurrency] = useState<string>('USD');  // Currency for chart prices
  const [exchangeTimezone, setExchangeTimezone] = useState<string>('America/New_York');  // Exchange timezone from API
  const [displayTimezone, setDisplayTimezone] = useState<string>(() => getUserTimezone());  // User's selected display timezone
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  
  const [details, setDetails] = useState<CryptoDetails | StockDetails | MetalDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(true);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  
  // Events state
  const [selectedEventCategories, setSelectedEventCategories] = useState<EventCategory[]>([]);
  const [events, setEvents] = useState<HistoricalEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  
  // Inventory overlay state (for gold and silver)
  const [showInventoryOverlay, setShowInventoryOverlay] = useState(false);
  const [inventoryData, setInventoryData] = useState<InventoryDataPoint[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  
  // Chart type state (line vs OHLC)
  const [chartType, setChartType] = useState<ChartType>('line');
  
  // Technical indicators state
  const [indicatorsConfig, setIndicatorsConfig] = useState<TechnicalIndicatorsConfig>(DEFAULT_INDICATORS_CONFIG);
  
// Refresh trigger - increment to force refetch
  const [refreshKey, setRefreshKey] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isManualRefresh, setIsManualRefresh] = useState(false);  // Track if refresh was manual
  const [autoRefreshKey, setAutoRefreshKey] = useState(0);  // Separate key for lightweight auto-refresh
  
  // Auto-refresh is always enabled (3 minutes for detail page)
  const autoRefreshEnabled = true;
  
  // Auto-retry countdown state
  const [retryCountdown, setRetryCountdown] = useState<number | null>(null);
  const RETRY_DELAY = 5; // seconds
  
  // Track if we can go back within the app
  const [canGoBack, setCanGoBack] = useState(false);

  const assetType = type as AssetType;
  const assetId = `${type}-${id}`;
  
  // Check if we have history to go back to within the app
  useEffect(() => {
    // If window.history.length > 1, there might be history, but it could be external
    // We use a more reliable approach: check if document.referrer is from our origin
    const referrer = document.referrer;
    const currentOrigin = window.location.origin;
    
    // If referrer is from same origin, we can safely go back
    if (referrer && referrer.startsWith(currentOrigin)) {
      setCanGoBack(true);
    } else {
      setCanGoBack(false);
    }
  }, []);
  
// Handle back navigation - go to homepage if no internal history
  const handleBack = useCallback(() => {
    if (canGoBack) {
      navigate(-1);
    } else {
      navigate('/');
    }
  }, [canGoBack, navigate]);

  // Rate limit retry hook - defined early so resetRateLimit is available for handleRefresh
  // The callback is updated via ref after handleRefresh is defined
  const {
    isRateLimited,
    secondsRemaining,
    startRetryCountdown,
    resetRateLimit,
  } = useRateLimitRetry(() => {
    // This callback is called when rate limit countdown finishes
    // If we don't have history data yet, do a full refresh (initial load failed)
    // Otherwise use lightweight auto-refresh
    const needsFullRefresh = !historyData || historyData.length === 0;
    console.log(`[Rate Limit Retry] needsFullRefresh=${needsFullRefresh}, historyDataLength=${historyData?.length || 0}`);
    if (needsFullRefresh) {
      // Full refresh: trigger both history and details effects
      setIsRefreshing(true);
      setIsManualRefresh(false);  // Not a manual refresh (no cache bypass)
      setRetryCountdown(null);
      setRefreshKey(prev => prev + 1);
    } else {
      // Lightweight refresh: only update latest candles
      setAutoRefreshKey(prev => prev + 1);
    }
  });

  // Refresh function to refetch price data
  // manual=true: Full refresh with loading spinner (history + details)
  // manual=false: Lightweight auto-refresh (only quote + last candles, no spinner)
  const handleRefresh = useCallback((manual: boolean = true) => {
    if (manual) {
      // Manual refresh: Full refetch with loading spinner
      setIsRefreshing(true);
      setIsManualRefresh(true);
      setRetryCountdown(null);
      resetRateLimit();  // Clear rate limit on manual refresh
      setRefreshKey(prev => prev + 1);
    } else {
      // Auto-refresh: Use lightweight endpoint, no loading spinner
      setAutoRefreshKey(prev => prev + 1);
    }
  }, [resetRateLimit]);
  
  // Countdown timer effect
  useEffect(() => {
    if (retryCountdown === null || retryCountdown <= 0) return;
    
    const timer = setTimeout(() => {
      setRetryCountdown(prev => (prev !== null ? prev - 1 : null));
    }, 1000);
    
    return () => clearTimeout(timer);
  }, [retryCountdown]);
  
  // Auto-refresh when countdown reaches 0
  useEffect(() => {
    if (retryCountdown === 0) {
      handleRefresh(false);  // Retry doesn't bypass cache
    }
  }, [retryCountdown, handleRefresh]);

  // Auto-refresh countdown hook
  const isLoading = historyLoading || detailsLoading || isRefreshing;
  const {
    formattedCountdown: autoRefreshCountdown,
    isRefreshing: isAutoRefreshing,
    resetCountdown: resetAutoRefreshCountdown,
  } = useAutoRefreshCountdown({
    enabled: autoRefreshEnabled && !!type && !!id,
    onRefresh: () => handleRefresh(false),  // Auto-refresh doesn't bypass cache
    isLoading,
    isPaused: isRateLimited,
  });

  // Wrap handleRefresh to also reset auto-refresh countdown on manual refresh
  const handleManualRefresh = useCallback(() => {
    handleRefresh(true);
    resetAutoRefreshCountdown();
  }, [handleRefresh, resetAutoRefreshCountdown]);



  // Generate rate limit message
  const rateLimitMessage = isRateLimited 
    ? t('detailPage.retryingIn', { time: formatSecondsRemaining(secondsRemaining) })
    : null;

  // Fetch history data
  useEffect(() => {
    if (!type || !id) return;

    setHistoryLoading(true);
    setHistoryError(null);

    // Pass nocache=true for manual refresh to bypass server-side cache
    // Use candle interval directly (e.g., '1h', '5m', '1d')
    fetchAssetHistory(assetId, assetType, candleInterval, undefined, isManualRefresh)
      .then((response) => {
        setHistoryData(response.history);
        setHistoryCurrency(response.currency || 'USD');  // Store currency for chart display
        setExchangeTimezone(response.exchange_timezone || 'America/New_York');  // Store exchange timezone
        setRetryCountdown(null); // Clear countdown on success
        // Note: Don't call resetRateLimit() here - it can race with parallel details request
        // Rate limit is reset on manual refresh or when auto-retry countdown finishes
      })
      .catch((err) => {
        console.error('Error fetching history:', err);
        
        // Handle symbol not found error - show user-friendly message, no retry
        if (isSymbolNotFoundError(err)) {
          const symbol = extractSymbolFromError(err) || id?.toUpperCase() || 'Unknown';
          setHistoryError(`No price data found for $${symbol}. The symbol may be invalid or delisted.`);
          return; // Don't retry for invalid symbols
        }
        
        // Handle empty history error - show user-friendly message, no auto-retry
        // This happens commonly with international stocks outside trading hours
        if (isEmptyHistoryError(err)) {
          const userMessage = err instanceof EmptyHistoryError 
            ? err.userMessage 
            : err.message;
          setHistoryError(userMessage);
          return; // Don't auto-retry - user should check back when market reopens
        }
        
        setHistoryError(err.message || 'Failed to load price history');
        // Start appropriate retry countdown based on error type
        if (isRateLimitError(err)) {
          // Pass the wait time from the error if available
          const waitTime = err instanceof RateLimitError ? err.waitTime : undefined;
          startRetryCountdown(waitTime);
        } else {
          setRetryCountdown(RETRY_DELAY);
        }
      })
      .finally(() => {
        setHistoryLoading(false);
        setIsRefreshing(false);
        setIsManualRefresh(false);  // Reset after fetch completes
      });
  }, [assetId, assetType, candleInterval, type, id, refreshKey, isManualRefresh, startRetryCountdown]);

  // Fetch details
  useEffect(() => {
    if (!type || !id) return;

    setDetailsLoading(true);
    setDetailsError(null);

    fetchAssetDetails(assetId, assetType)
      .then((data) => {
        setDetails(data);
        setRetryCountdown(null); // Clear countdown on success
        // Note: Don't call resetRateLimit() here - it can race with parallel history request
        // Rate limit is reset on manual refresh or when auto-retry countdown finishes
      })
      .catch((err) => {
        console.error('Error fetching details:', err);
        
        // Handle symbol not found error - show user-friendly message, no retry
        if (isSymbolNotFoundError(err)) {
          const symbol = extractSymbolFromError(err) || id?.toUpperCase() || 'Unknown';
          setDetailsError(`No data found for $${symbol}. The symbol may be invalid or delisted.`);
          return; // Don't retry for invalid symbols
        }
        
        setDetailsError(err.message || 'Failed to load asset details');
        // Start appropriate retry countdown based on error type
        if (isRateLimitError(err)) {
          // Pass the wait time from the error if available
          const waitTime = err instanceof RateLimitError ? err.waitTime : undefined;
          startRetryCountdown(waitTime);
        } else {
          setRetryCountdown(RETRY_DELAY);
        }
      })
      .finally(() => {
        setDetailsLoading(false);
        setIsRefreshing(false);
      });
  }, [assetId, assetType, type, id, refreshKey, startRetryCountdown]);

  // Lightweight auto-refresh effect
  // Uses the /refresh endpoint to get just quote + last candles (2 TwelveData credits instead of 3)
  // No loading spinner - shows old data until new data arrives, then instantly updates
  useEffect(() => {
    // Skip on initial render (autoRefreshKey starts at 0)
    if (autoRefreshKey === 0) return;
    if (!type || !id) return;
    
    console.log('[Auto-refresh] Using lightweight refresh endpoint, interval:', candleInterval);
    
    fetchAssetRefresh(assetId, assetType, candleInterval, 5)  // Get 5 candles to ensure overlap
      .then((response: RefreshResponse) => {
        console.log('[Auto-refresh] Response:', {
          quote: response.quote?.price,
          candlesCount: response.candles?.length,
          interval: response.interval,
          candles: response.candles?.map(c => ({ date: c.date, price: c.price }))
        });
        
        // Update current price and change from quote
        if (response.quote) {
          // Update details with new price data (without full refetch)
          setDetails(prev => {
            if (!prev) return prev;
            return {
              ...prev,
              market_data: {
                ...prev.market_data,
                current_price: response.quote!.price,
                current_price_native: response.quote!.price,  // For stocks
              },
            } as typeof prev;
          });
        }
        
        // Merge new candles into existing history data
        if (response.candles && response.candles.length > 0) {
          setHistoryData(prev => {
            if (!prev || prev.length === 0) return prev;
            
            // Convert new candles to PricePoint format
            const newCandles = response.candles.map(c => ({
              date: c.date,
              timestamp: c.timestamp,
              price: c.price,
              open: c.open,
              high: c.high,
              low: c.low,
              volume: c.volume,
            }));
            
            // Create a map of existing candles by timestamp for fast lookup
            const existingByTimestamp = new Map(prev.map(p => [p.timestamp, p]));
            
            // Update or add new candles
            for (const candle of newCandles) {
              existingByTimestamp.set(candle.timestamp, candle);
            }
            
            // Convert back to array and sort by timestamp
            const merged = Array.from(existingByTimestamp.values())
              .sort((a, b) => a.timestamp - b.timestamp);
            
            const addedCount = merged.length - prev.length;
            const updatedCount = newCandles.length - Math.max(0, addedCount);
            
            console.log(`[Auto-refresh] Merged: ${addedCount} new candles added, ${updatedCount} existing updated. Total: ${merged.length}`);
            
            return merged;
          });
        }
        
        setRetryCountdown(null);
        // Note: Don't call resetRateLimit() here - the rate limit hook automatically
        // clears its state when the countdown finishes and retry callback executes
      })
      .catch((err) => {
        console.error('[Auto-refresh] Lightweight refresh failed:', err);
        // On failure, fall back to full refresh
        if (isRateLimitError(err)) {
          // Pass the wait time from the error if available
          const waitTime = err instanceof RateLimitError ? err.waitTime : undefined;
          startRetryCountdown(waitTime);
        }
        // Don't show error for auto-refresh failures - the old data is still valid
      });
  }, [autoRefreshKey, assetId, assetType, candleInterval, type, id, startRetryCountdown]);

  // Fetch events when history data or selected categories change
  useEffect(() => {
    if (!historyData || historyData.length === 0 || selectedEventCategories.length === 0) {
      setEvents([]);
      return;
    }

    setEventsLoading(true);

    fetchEventsForChart(historyData, selectedEventCategories)
      .then((fetchedEvents) => {
        setEvents(fetchedEvents);
      })
      .catch((err) => {
        console.error('Error fetching events:', err);
        setEvents([]);
      })
      .finally(() => {
        setEventsLoading(false);
      });
  }, [historyData, selectedEventCategories]);

  // Fetch inventory data when overlay is enabled (for gold/silver)
  useEffect(() => {
    if (!showInventoryOverlay || !details?.symbol || !hasInventoryData(details.symbol)) {
      setInventoryData([]);
      return;
    }

    setInventoryLoading(true);

    // Fetch inventory data for the same timeframe as the price chart
    // Convert candle interval to days for inventory API
    const inventoryDays = CANDLE_INTERVAL_DAYS[candleInterval] || 30;
    fetchMetalInventory(details.symbol, inventoryDays)
      .then((response) => {
        setInventoryData(response.data);
      })
      .catch((err) => {
        console.error('Error fetching inventory data for overlay:', err);
        setInventoryData([]);
      })
      .finally(() => {
        setInventoryLoading(false);
      });
  }, [showInventoryOverlay, details?.symbol, candleInterval]);

  // Check if this metal supports inventory data
  const supportsInventoryOverlay = assetType === 'metal' && details?.symbol && hasInventoryData(details.symbol);

  // Get current price and change from details
  // current_price is in USD (for header display)
  // current_price_native is in native currency (for chart sync)
  const currentPrice = details?.market_data?.current_price;
  const currentPriceNative = (details as StockDetails | null)?.market_data?.current_price_native;
  const detailsCurrency = (details as StockDetails | null)?.currency || 'USD';
  
  // Determine if this is a foreign stock (non-USD currency)
  const isForeignStock = assetType === 'stock' && detailsCurrency !== 'USD';
  
  // Calculate price change - crypto has it directly, stocks/metals need calculation
  // For stocks, use native currency prices for accurate % change calculation
  let priceChange: number | null = null;
  if (details) {
    if ('price_change_percentage_24h' in details.market_data && details.market_data.price_change_percentage_24h != null) {
      priceChange = details.market_data.price_change_percentage_24h;
    } else if ('previous_close' in details.market_data) {
      // For stocks, previous_close is now in native currency
      // Use native price for accurate % change
      const nativePrice = currentPriceNative || currentPrice;
      const md = details.market_data as { previous_close?: number };
      if (nativePrice && md.previous_close) {
        priceChange = ((nativePrice - md.previous_close) / md.previous_close) * 100;
      }
    }
  }

  // Sync the last candle with current price from details API
  // This ensures the rightmost point on the chart always shows the most recent price,
  // regardless of the interval (5m, 1h, 1d) which might have a stale last candle
  // IMPORTANT: Use native currency price for syncing, not USD price
  const syncedHistoryData = useMemo(() => {
    if (!historyData.length) {
      return historyData;
    }
    
    // For foreign stocks, use native price; otherwise use current price
    // Chart prices are always in native currency
    const priceToSync = isForeignStock ? currentPriceNative : currentPrice;
    
    if (!priceToSync) {
      return historyData;
    }
    
    // Clone the array and update the last point with current price
    const synced = [...historyData];
    const lastPoint = synced[synced.length - 1];
    
    // Only update if the current price differs from the last candle
    if (lastPoint && lastPoint.price !== priceToSync) {
      synced[synced.length - 1] = {
        ...lastPoint,
        price: priceToSync,
        // Update high/low if current price exceeds them (for OHLC charts)
        high: lastPoint.high ? Math.max(lastPoint.high, priceToSync) : priceToSync,
        low: lastPoint.low ? Math.min(lastPoint.low, priceToSync) : priceToSync,
      };
    }
    
    return synced;
  }, [historyData, currentPrice, currentPriceNative, isForeignStock]);

  // Merge price data with inventory data for overlay, and convert timezones
  const chartData: PricePoint[] | PriceWithInventory[] | PriceWithIndicators[] = useMemo(() => {
    let data: PricePoint[] | PriceWithInventory[] | PriceWithIndicators[] = syncedHistoryData;
    
    // Merge inventory data if overlay is enabled
    if (showInventoryOverlay && inventoryData.length > 0) {
      data = mergeInventoryWithPriceData(syncedHistoryData, inventoryData);
    }
    
    // Calculate and merge technical indicators
    const hasIndicators = indicatorsConfig.movingAverage1.enabled ||
                          indicatorsConfig.movingAverage2.enabled ||
                          indicatorsConfig.bollingerBands.enabled;
    
    if (hasIndicators && syncedHistoryData.length > 0) {
      const indicators = calculateIndicators(syncedHistoryData, indicatorsConfig);
      data = mergeIndicatorsWithPriceData(data as PricePoint[], indicators);
    }
    
    // Convert timestamps from exchange timezone to display timezone
    // For all asset types with intraday data (date includes time component)
    // For stocks, use exchange timezone; for crypto/metals, use UTC as default source
    const sourceTimezone = assetType === 'stock' ? exchangeTimezone : 'UTC';
    if (sourceTimezone !== displayTimezone) {
      data = data.map(point => {
        const hasTime = point.date.includes(' ') && point.date.split(' ').length > 1;
        if (!hasTime) return point;  // Daily data doesn't need conversion
        
        return {
          ...point,
          date: convertTimezone(point.date, sourceTimezone, displayTimezone),
        };
      });
    }
    
    return data;
  }, [syncedHistoryData, inventoryData, showInventoryOverlay, indicatorsConfig, assetType, exchangeTimezone, displayTimezone]);

  if (!type || !id) {
    return (
      <div className="app">
        <div className="detail-page">
          <div className="error-message">
            <p>{t('detailPage.invalidUrl')}</p>
            <Link to="/" className="back-btn">{t('detailPage.goBack')}</Link>
          </div>
        </div>
      </div>
    );
  }

  // Function to get translated asset name
  const getAssetName = (name: string | undefined) => {
    if (!name) return id;
    // Check if the name is a known commodity
    const translationKey = `assetNames.${name}`;
    const translated = t(translationKey);
    // If translation key doesn't exist, return original name
    return translated === translationKey ? name : translated;
  };

  return (
    <div className="app">
      <div className="detail-page">
        {/* Header */}
        <header className="detail-header">
          <button className="back-btn" onClick={handleBack}>
            <span className="back-arrow">←</span> {t('detailPage.back')}
          </button>
          
          <div className="asset-header-info">
            {details?.image && (
              <img 
                src={details.image} 
                alt={details.name} 
                className="asset-header-logo"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            )}
            <div className="asset-header-text">
              <div className="asset-header-title">
                <h1>{getAssetName(details?.name)}</h1>
                <span 
                  className="type-badge" 
                  style={{ backgroundColor: getTypeColor(assetType) }}
                >
                  {getTypeLabel(assetType, t)}
                </span>
              </div>
              <span className="asset-symbol">{details?.symbol || id.toUpperCase()}</span>
            </div>
            <div className="asset-header-controls">
              <LanguageSelector />
              <button 
                className="theme-toggle" 
                onClick={toggleTheme}
                title={t(theme === 'dark' ? 'header.themeDark' : 'header.themeLight')}
                aria-label={t(theme === 'dark' ? 'header.themeDark' : 'header.themeLight')}
              >
                {theme === 'dark' ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="5"/>
                    <line x1="12" y1="1" x2="12" y2="3"/>
                    <line x1="12" y1="21" x2="12" y2="23"/>
                    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
                    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                    <line x1="1" y1="12" x2="3" y2="12"/>
                    <line x1="21" y1="12" x2="23" y2="12"/>
                    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
                    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                  </svg>
                )}
              </button>
              <SearchBar compact />
            </div>
          </div>
          
          <div className="asset-header-price">
            <button 
              className={`refresh-price-btn ${isRateLimited ? 'rate-limited' : ''}`}
              onClick={handleManualRefresh}
              disabled={isRefreshing || detailsLoading || isRateLimited}
              title={isRateLimited ? t('detailPage.rateLimitedRetry') : t('detailPage.refreshPrice')}
            >
              {isRefreshing ? (
                <span className="refresh-spinner"></span>
              ) : (
                <span className="refresh-icon">↻</span>
              )}
            </button>
            <div className="current-price">
              {formatPrice(currentPrice)}
              {/* Show native currency price for foreign stocks */}
              {isForeignStock && currentPriceNative && (
                <span className="native-price"> / {formatPriceWithCurrency(currentPriceNative, detailsCurrency)}</span>
              )}
            </div>
            {priceChange !== null && priceChange !== undefined && (
              <div className={`price-change ${priceChange >= 0 ? 'positive' : 'negative'}`}>
                {formatPercentage(priceChange)}
              </div>
            )}
            {/* SearchBar shown here only on mobile/tablet (rightmost in price row) */}
            <div className="search-mobile-only">
              <SearchBar compact />
            </div>
          </div>
        </header>

        {/* Rate limit countdown message */}
        {isRateLimited && rateLimitMessage && (
          <div className="error-message rate-limited">
            <p>{rateLimitMessage}</p>
          </div>
        )}

        {/* Main content */}
        <div className="detail-content">
          {/* Chart section */}
          <div className="chart-section">
            <div className="chart-header">
              <h2>{t('detailPage.priceHistory')}</h2>
              <TimeRangeSelector 
                selected={candleInterval} 
                onChange={setCandleInterval}
                loading={historyLoading}
              />
            </div>
            
            {/* Event selector */}
            <EventSelector
              selectedCategories={selectedEventCategories}
              onChange={setSelectedEventCategories}
              loading={eventsLoading}
            />
            
            {/* Chart controls row: Inventory toggle, Chart type, Indicators, Timezone */}
            <div className="chart-controls-row">
              {supportsInventoryOverlay && (
                <InventoryOverlayToggle
                  checked={showInventoryOverlay}
                  onChange={setShowInventoryOverlay}
                  loading={inventoryLoading}
                />
              )}
              <ChartTypeSelector
                selected={chartType}
                onChange={setChartType}
                disabled={historyLoading}
              />
              <IndicatorToolbox
                config={indicatorsConfig}
                onChange={setIndicatorsConfig}
                disabled={historyLoading}
              />
              {/* Timezone selector - show for all asset types with intraday data */}
              {candleInterval !== '1d' && (
                <TimezoneSelector
                  selected={displayTimezone}
                  onChange={setDisplayTimezone}
                  exchangeTimezone={assetType === 'stock' ? exchangeTimezone : undefined}
                  disabled={historyLoading}
                />
              )}
            </div>
            
            <PriceChart 
              data={chartData} 
              loading={historyLoading}
              error={isRateLimited ? rateLimitMessage || undefined : historyError || undefined}
              events={events}
              retryCountdown={retryCountdown}
              showInventoryOverlay={showInventoryOverlay}
              chartType={chartType}
              indicatorsConfig={indicatorsConfig}
              currency={historyCurrency}
            />

            {/* COMEX Inventory Chart - only shows for gold and silver */}
            {assetType === 'metal' && details?.symbol && (
              <InventoryChart 
                symbol={details.symbol} 
                metalName={details.name || id} 
              />
            )}

            {/* Shanghai & India Premium Prices - only shows for gold and silver */}
            {/* COMMENTED OUT - To re-enable, uncomment lines below - and don't forget to uncomment the import statements at the top (hasPremiumData and PremiumPrices) */}
            {/* {assetType === 'metal' && details?.symbol && hasPremiumData(details.symbol) && (
              <PremiumPrices 
                symbol={details.symbol} 
                metalName={details.name || id}
                westernPrice={currentPrice}
              />
            )} */}
          </div>
          
          {/* Details sidebar */}
          <aside className="details-section">
            <h2>{t('detailPage.details')}</h2>
            <AssetDetails 
              details={details} 
              type={assetType}
              loading={detailsLoading}
              error={detailsError || undefined}
              retryCountdown={retryCountdown}
            />
          </aside>
        </div>

{/* Footer */}
        <footer className="detail-footer">
          <p>
            {t('detailPage.dataSource')}
          </p>
          <p className="auto-refresh-status">
            {isAutoRefreshing ? (
              t('footer.refreshingNow', { defaultValue: 'Refreshing data...' })
            ) : (
              t('footer.refreshingIn', { countdown: autoRefreshCountdown, defaultValue: `Refreshing in ${autoRefreshCountdown}` })
            )}
          </p>
        </footer>
      </div>
    </div>
  );
}
