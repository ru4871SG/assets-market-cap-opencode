import { useState, useEffect, useCallback } from 'react';
import { Asset, SortConfig, SortField } from '../types/asset';
import { fetchCryptoAssets } from '../services/cryptoApi';
import { fetchStockAssets } from '../services/stockApi';
import { fetchMetalAssets } from '../services/metalApi';
import { searchAssets } from '../services/searchApi';
import { isRateLimitError } from '../services/errors';
import { useRateLimitRetry, formatSecondsRemaining } from './useRateLimitRetry';
import { useAutoRefreshCountdown } from './useAutoRefreshCountdown';

// Default: 4 crypto + 30 stocks + 5 metals = 39 assets
// Each "Show Next 30" adds 30 more stocks (ranked by market cap from SlickCharts)
const DEFAULT_STOCK_LIMIT = 30;
const INCREMENT_SIZE = 30; // Stocks only
const MAX_STOCKS = 503; // S&P 500 total

// Session storage keys for persisting state across navigation
const SEARCH_QUERY_KEY = 'assets_search_query';
const ADDED_ASSETS_KEY = 'assets_added_from_search';

// Helper functions for session storage
function getSessionSearchQuery(): string {
  try {
    return sessionStorage.getItem(SEARCH_QUERY_KEY) || '';
  } catch {
    return '';
  }
}

function setSessionSearchQuery(query: string): void {
  try {
    if (query) {
      sessionStorage.setItem(SEARCH_QUERY_KEY, query);
    } else {
      sessionStorage.removeItem(SEARCH_QUERY_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

// Assets added via search - these persist in the main list for the session
function getSessionAddedAssets(): Asset[] {
  try {
    const stored = sessionStorage.getItem(ADDED_ASSETS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function setSessionAddedAssets(assets: Asset[]): void {
  try {
    if (assets.length > 0) {
      sessionStorage.setItem(ADDED_ASSETS_KEY, JSON.stringify(assets));
    } else {
      sessionStorage.removeItem(ADDED_ASSETS_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

export function useAssets() {
  const [assets, setAssets] = useState<Asset[]>([]);
  // Assets added from search API - these become part of the main list for the session
  const [addedAssets, setAddedAssets] = useState<Asset[]>(getSessionAddedAssets);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortConfig, setSortConfig] = useState<SortConfig>({
    field: 'marketCap',
    direction: 'desc',
  });
  const [filter, setFilter] = useState<string>('all');
  // Initialize search query from session storage to persist across navigation
  const [searchQuery, setSearchQuery] = useState<string>(getSessionSearchQuery);
  
  // Track current stock limit for incremental loading (crypto is always just BTC/ETH)
  const [stockLimit, setStockLimit] = useState(DEFAULT_STOCK_LIMIT);

  // Rate limit retry state
  const [rateLimitTriggered, setRateLimitTriggered] = useState(false);
  
  // Auto-refresh is always enabled
  const autoRefreshEnabled = true;
  const [lastRefreshTime, setLastRefreshTime] = useState<Date | null>(null);

const fetchAllAssets = useCallback(async (stockCount: number) => {
    setLoading(true);
    setError(null);
    
    try {
      // Fetch data - crypto is always just BTC/ETH, stocks vary based on limit
      const [cryptoAssets, stockAssets, metalAssets] = await Promise.all([
        fetchCryptoAssets(),
        fetchStockAssets(stockCount),
        fetchMetalAssets(),  // Always fetch all metals (only ~6)
      ]);

      const allAssets = [...cryptoAssets, ...stockAssets, ...metalAssets];
      setAssets(allAssets);
      setRateLimitTriggered(false); // Clear rate limit flag on success
      setLastRefreshTime(new Date()); // Track when we last refreshed
    } catch (err) {
      // Check if this is a rate limit error
      if (isRateLimitError(err)) {
        setError('Too Many Requests. Rate limited.');
        setRateLimitTriggered(true);
      } else {
        setError('Failed to fetch asset data. Please try again later.');
        setRateLimitTriggered(false);
      }
      console.error('Error fetching assets:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Rate limit retry hook - callback to retry fetching assets
  const handleRetry = useCallback(() => {
    fetchAllAssets(stockLimit);
  }, [fetchAllAssets, stockLimit]);

  const {
    isRateLimited,
    secondsRemaining,
    startRetryCountdown,
    resetRateLimit,
  } = useRateLimitRetry(handleRetry);

  // Start countdown when rate limit is triggered
  useEffect(() => {
    if (rateLimitTriggered && !isRateLimited) {
      startRetryCountdown();
    }
  }, [rateLimitTriggered, isRateLimited, startRetryCountdown]);

  // Reset rate limit state when successful data fetch occurs
  useEffect(() => {
    if (!rateLimitTriggered && isRateLimited) {
      resetRateLimit();
    }
  }, [rateLimitTriggered, isRateLimited, resetRateLimit]);

useEffect(() => {
    fetchAllAssets(stockLimit);
  }, [fetchAllAssets, stockLimit]);

  // Auto-refresh countdown hook
  const handleAutoRefresh = useCallback(() => {
    fetchAllAssets(stockLimit);
  }, [fetchAllAssets, stockLimit]);

  const {
    formattedCountdown: autoRefreshCountdown,
    isRefreshing: isAutoRefreshing,
    resetCountdown: resetAutoRefreshCountdown,
  } = useAutoRefreshCountdown({
    enabled: autoRefreshEnabled,
    onRefresh: handleAutoRefresh,
    isLoading: loading,
    isPaused: rateLimitTriggered,
  });

  // Reset countdown when user manually refreshes
  const handleManualRefresh = useCallback(() => {
    fetchAllAssets(stockLimit);
    resetAutoRefreshCountdown();
  }, [fetchAllAssets, stockLimit, resetAutoRefreshCountdown]);

  // Wrapper for setSearchQuery that also persists to session storage
  const updateSearchQuery = useCallback((query: string) => {
    setSearchQuery(query);
    setSessionSearchQuery(query);
  }, []);

  // Search API on demand (called when user presses Enter)
  // Results are added to the main asset list permanently for the session
  const handleSearchSubmit = useCallback(async () => {
    const query = searchQuery.trim();
    
    if (!query || query.length < 2) {
      return;
    }
    
    // Check if we have local matches first (including already added assets)
    const allCurrentAssets = [...assets, ...addedAssets];
    const localMatches = allCurrentAssets.filter((asset) => {
      const q = query.toLowerCase();
      return asset.name.toLowerCase().includes(q) || 
             asset.symbol.toLowerCase().includes(q);
    });
    
    // If we have local matches, don't search API
    if (localMatches.length > 0) {
      return;
    }
    
    // Search API
    setSearching(true);
    try {
      const results = await searchAssets(query);
      // Filter out any assets we already have (in default list or already added)
      const existingIds = new Set([...assets.map(a => a.id), ...addedAssets.map(a => a.id)]);
      const newResults = results.filter(r => !existingIds.has(r.id));
      
      if (newResults.length > 0) {
        // Add new results to the addedAssets list (persists for the session)
        const updatedAddedAssets = [...addedAssets, ...newResults];
        setAddedAssets(updatedAddedAssets);
        setSessionAddedAssets(updatedAddedAssets);
      }
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setSearching(false);
    }
  }, [searchQuery, assets, addedAssets]);

  const handleShowNext30 = useCallback(() => {
    // Add 30 more stocks (ranked by market cap from SlickCharts)
    setStockLimit(prev => Math.min(prev + INCREMENT_SIZE, MAX_STOCKS));
  }, []);

  // Check if we can show more assets (only stocks, crypto is fixed at 4: BTC/ETH/BNB/SOL)
  const canShowMore = stockLimit < MAX_STOCKS;

  const sortAssets = useCallback((assetsToSort: Asset[]): Asset[] => {
    return [...assetsToSort].sort((a, b) => {
      let comparison = 0;
      
      switch (sortConfig.field) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'marketCap':
          comparison = a.marketCap - b.marketCap;
          break;
        case 'price':
          comparison = a.price - b.price;
          break;
        case 'change24h':
          comparison = a.change24h - b.change24h;
          break;
        case 'change7d':
          comparison = (a.change7d ?? -Infinity) - (b.change7d ?? -Infinity);
          break;
        case 'change30d':
          comparison = (a.change30d ?? -Infinity) - (b.change30d ?? -Infinity);
          break;
        case 'change60d':
          comparison = (a.change60d ?? -Infinity) - (b.change60d ?? -Infinity);
          break;
        case 'change90d':
          comparison = (a.change90d ?? -Infinity) - (b.change90d ?? -Infinity);
          break;
        case 'change180d':
          comparison = (a.change180d ?? -Infinity) - (b.change180d ?? -Infinity);
          break;
        case 'changeYtd':
          comparison = (a.changeYtd ?? -Infinity) - (b.changeYtd ?? -Infinity);
          break;
        case 'rank':
        default:
          comparison = a.marketCap - b.marketCap;
          break;
      }
      
      return sortConfig.direction === 'asc' ? comparison : -comparison;
    });
  }, [sortConfig]);

  const handleSort = useCallback((field: SortField) => {
    setSortConfig((prevConfig) => ({
      field,
      direction:
        prevConfig.field === field && prevConfig.direction === 'desc'
          ? 'asc'
          : 'desc',
    }));
  }, []);

  // Combine default assets with assets added from search
  // Added assets are part of the main list for the entire session
  const allAssets = [...assets, ...addedAssets];

  const filteredAssets = allAssets.filter((asset) => {
    // Filter by type
    if (filter !== 'all' && asset.type !== filter) {
      return false;
    }
    
    // Filter by search query
    if (searchQuery.trim() !== '') {
      const query = searchQuery.toLowerCase();
      const matchesName = asset.name.toLowerCase().includes(query);
      const matchesSymbol = asset.symbol.toLowerCase().includes(query);
      return matchesName || matchesSymbol;
    }
    
    return true;
  });

  const sortedAssets = sortAssets(filteredAssets);

  // Assign ranks based on sorted position
  const rankedAssets = sortedAssets.map((asset, index) => ({
    ...asset,
    rank: index + 1,
  }));

return {
    assets: rankedAssets,
    loading,
    searching,
    error,
    sortConfig,
    handleSort,
    filter,
    setFilter,
    searchQuery,
    setSearchQuery: updateSearchQuery,
    handleSearchSubmit,
    refresh: handleManualRefresh,
    handleShowNext30,
    canShowMore,
    currentAssetCount: 4 + stockLimit + 5, // 4 crypto (BTC/ETH/BNB/SOL) + stocks + 5 metals
    // Rate limit retry state
    isRateLimited,
    secondsRemaining,
    rateLimitMessage: isRateLimited 
      ? `Too Many Requests. Rate limited. Trying automatically in ${formatSecondsRemaining(secondsRemaining)}`
      : null,
    // Auto-refresh state
    autoRefreshEnabled,
    lastRefreshTime,
    // Auto-refresh countdown
    autoRefreshCountdown,
    isAutoRefreshing,
  };
}
