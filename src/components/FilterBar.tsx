import { useTranslation } from 'react-i18next';
import './FilterBar.css';

interface FilterBarProps {
  filter: string;
  onFilterChange: (filter: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onSearchSubmit: () => void;
  onRefresh: () => void;
  loading: boolean;
  assetCount: number;
  onShowNext50: () => void;
  searching: boolean;
  isRateLimited?: boolean;
  canShowMore?: boolean;
  onOpenColumnsConfig: () => void;
}

export function FilterBar({
  filter,
  onFilterChange,
  searchQuery,
  onSearchChange,
  onSearchSubmit,
  onRefresh,
  loading,
  assetCount,
  onShowNext50,
  searching,
  isRateLimited = false,
  canShowMore = true,
  onOpenColumnsConfig,
}: FilterBarProps) {
  const { t } = useTranslation();

  const filters = [
    { value: 'all', label: t('filter.allAssets') },
    { value: 'metal', label: t('filter.metals') },
    { value: 'stock', label: t('filter.stocks') },
    { value: 'crypto', label: t('filter.crypto') },
  ];

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      onSearchSubmit();
    }
  };

  return (
    <div className="filter-bar">
      <div className="filter-controls">
        <div className="filter-buttons">
          {filters.map((f) => (
            <button
              key={f.value}
              className={`filter-btn ${filter === f.value ? 'active' : ''}`}
              onClick={() => onFilterChange(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="search-container">
          <input
            type="text"
            className="search-input"
            placeholder={t('filter.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          {searching && (
            <span className="search-spinner" title={t('filter.searching')}></span>
          )}
          {searchQuery && !searching && (
            <button
              className="clear-search"
              onClick={() => onSearchChange('')}
              title={t('filter.clearSearch')}
            >
              ✕
            </button>
          )}
        </div>
      </div>
      <div className="filter-info">
        <span className="asset-count">
          {t('filter.assetCount', { count: assetCount })}
        </span>
        {canShowMore && (
          <button
            className="show-next-btn"
            onClick={onShowNext50}
            disabled={loading}
            title={t('filter.loadMore')}
          >
            {t('filter.showNext30')}
          </button>
        )}
        <button
          className={`refresh-btn ${isRateLimited ? 'rate-limited' : ''}`}
          onClick={onRefresh}
          disabled={loading || isRateLimited}
          title={isRateLimited ? t('filter.rateLimited') : t('filter.refresh')}
        >
          {loading ? (
            <span className="spinner"></span>
          ) : (
            <span className="refresh-icon">&#8635;</span>
          )}
        </button>
        <button
          className="config-btn"
          onClick={onOpenColumnsConfig}
          title={t('filter.configureColumns')}
        >
          <svg
            className="config-icon"
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c0 .68.27 1.32.75 1.8.48.48 1.13.75 1.8.75H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
