import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { searchAssets } from '../services/searchApi';
import { Asset } from '../types/asset';
import './SearchBar.css';

// Session storage key for assets added from search (shared with useAssets hook)
const ADDED_ASSETS_KEY = 'assets_added_from_search';

// Helper to get/set session storage for added assets
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

interface SearchBarProps {
  /** Optional: show in compact mode for detail pages (icon on mobile) */
  compact?: boolean;
  /** Optional: placeholder override */
  placeholder?: string;
}

export function SearchBar({ compact = false, placeholder }: SearchBarProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<Asset[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsExpanded(false);
        setSearchResults([]);
        setHasSearched(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus input when expanding
  useEffect(() => {
    if (isExpanded && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isExpanded]);

  const handleSearch = useCallback(async () => {
    const trimmedQuery = query.trim().toUpperCase();
    
    if (!trimmedQuery || trimmedQuery.length < 2) {
      return;
    }

    setSearching(true);
    setHasSearched(true);

    try {
      const results = await searchAssets(trimmedQuery);
      setSearchResults(results);
      
      if (results.length > 0) {
        // Add to session storage so it persists in homepage list
        const existingAssets = getSessionAddedAssets();
        const existingIds = new Set(existingAssets.map(a => a.id));
        const newAssets = results.filter(a => !existingIds.has(a.id));
        
        if (newAssets.length > 0) {
          const updatedAssets = [...existingAssets, ...newAssets];
          setSessionAddedAssets(updatedAssets);
        }
      }
    } catch (err) {
      console.error('Search error:', err);
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
    if (e.key === 'Escape') {
      setIsExpanded(false);
      setSearchResults([]);
      setHasSearched(false);
    }
  };

  const handleClear = () => {
    setQuery('');
    setSearchResults([]);
    setHasSearched(false);
    inputRef.current?.focus();
  };

  const handleResultClick = (asset: Asset) => {
    // Navigate to the asset detail page (route is /asset/:type/:id)
    navigate(`/asset/${asset.type}/${asset.id.replace(`${asset.type}-`, '')}`);
    // Clear state
    setQuery('');
    setSearchResults([]);
    setHasSearched(false);
    setIsExpanded(false);
  };

  const handleToggle = () => {
    setIsExpanded(!isExpanded);
    if (isExpanded) {
      setSearchResults([]);
      setHasSearched(false);
    }
  };

  const formatPrice = (price: number) => {
    if (price >= 1000) {
      return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    if (price >= 1) {
      return `$${price.toFixed(2)}`;
    }
    return `$${price.toFixed(4)}`;
  };

  const formatMarketCap = (marketCap: number) => {
    if (marketCap >= 1e12) {
      return `$${(marketCap / 1e12).toFixed(2)}T`;
    }
    if (marketCap >= 1e9) {
      return `$${(marketCap / 1e9).toFixed(2)}B`;
    }
    if (marketCap >= 1e6) {
      return `$${(marketCap / 1e6).toFixed(2)}M`;
    }
    return `$${marketCap.toLocaleString()}`;
  };

  const formatChange = (change: number) => {
    const sign = change >= 0 ? '+' : '';
    return `${sign}${change.toFixed(2)}%`;
  };

  // Render search input and results
  const renderSearchContent = () => (
    <>
      <div className="search-bar-input-wrapper">
        <input
          ref={inputRef}
          type="text"
          className="search-bar-input"
          placeholder={placeholder || t('filter.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        {searching && (
          <span className="search-bar-spinner" title={t('filter.searching')}></span>
        )}
        {query && !searching && (
          <button
            className="search-bar-clear"
            onClick={handleClear}
            title={t('filter.clearSearch')}
          >
            ×
          </button>
        )}
      </div>
      
      {/* Search results dropdown */}
      {hasSearched && (
        <div className="search-bar-results">
          {searchResults.length > 0 ? (
            searchResults.map((asset) => (
              <button
                key={asset.id}
                className="search-bar-result-item"
                onClick={() => handleResultClick(asset)}
              >
                {asset.image && (
                  <img
                    src={asset.image}
                    alt={asset.name}
                    className="search-bar-result-image"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                )}
                <div className="search-bar-result-info">
                  <span className="search-bar-result-name">{asset.name}</span>
                  <span className="search-bar-result-symbol">{asset.symbol}</span>
                </div>
                <div className="search-bar-result-data">
                  <span className="search-bar-result-price">{formatPrice(asset.price)}</span>
                  <span className={`search-bar-result-change ${asset.change24h >= 0 ? 'positive' : 'negative'}`}>
                    {formatChange(asset.change24h)}
                  </span>
                  <span className="search-bar-result-mcap">{formatMarketCap(asset.marketCap)}</span>
                </div>
              </button>
            ))
          ) : !searching ? (
            <div className="search-bar-no-results">
              {t('errors.noResults', { query: query })}
            </div>
          ) : null}
        </div>
      )}
    </>
  );

  // Compact mode: icon button that expands on mobile, full bar on desktop
  if (compact) {
    return (
      <div className="search-bar search-bar-compact" ref={containerRef}>
        {/* Desktop: always show search bar */}
        <div className="search-bar-desktop">
          <div className="search-bar-container">
            {renderSearchContent()}
          </div>
        </div>
        
        {/* Mobile: icon toggle with dropdown */}
        <div className="search-bar-mobile">
          <button
            className="search-bar-toggle"
            onClick={handleToggle}
            aria-label={t('filter.searchPlaceholder')}
            title={t('filter.searchPlaceholder')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </button>
          
          {isExpanded && (
            <div className="search-bar-dropdown">
              {renderSearchContent()}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Full mode: always visible search bar
  return (
    <div className="search-bar" ref={containerRef}>
      <div className="search-bar-container">
        {renderSearchContent()}
      </div>
    </div>
  );
}
