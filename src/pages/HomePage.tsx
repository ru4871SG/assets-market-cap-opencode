import { useAssets } from '../hooks/useAssets';
import { useColumnsConfig } from '../hooks/useColumnsConfig';
import { useTranslation } from 'react-i18next';
import { Header } from '../components/Header';
import { FilterBar } from '../components/FilterBar';
import { AssetTable } from '../components/AssetTable';
import { ColumnsConfigModal } from '../components/ColumnsConfigModal';

export function HomePage() {
  const { t } = useTranslation();
  const {
    assets,
    loading,
    searching,
    error,
    sortConfig,
    handleSort,
    filter,
    setFilter,
    searchQuery,
    setSearchQuery,
    handleSearchSubmit,
    refresh,
    handleShowNext30,
    canShowMore,
    isRateLimited,
    rateLimitMessage,
    autoRefreshCountdown,
    isAutoRefreshing,
  } = useAssets();

  const {
    visibleColumns,
    updateColumns,
    isModalOpen,
    openModal,
    closeModal,
  } = useColumnsConfig();

  const isLoading = loading || searching;
  const hasSearchQuery = searchQuery.trim().length > 0;
  const noResults = hasSearchQuery && assets.length === 0 && !searching;

  // Determine loading message
  const getLoadingMessage = () => {
    if (searching) {
      return t('loading.searching');
    }
    return t('loading.assets');
  };

  // Display rate limit countdown message if rate limited
  const displayError = isRateLimited ? rateLimitMessage : error;

  return (
    <div className="app">
      <Header />
      
      <main className="main-content">
        <FilterBar
          filter={filter}
          onFilterChange={setFilter}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSearchSubmit={handleSearchSubmit}
          onRefresh={refresh}
          loading={isLoading}
          assetCount={assets.length}
          onShowNext50={handleShowNext30}
          searching={searching}
          isRateLimited={isRateLimited}
          canShowMore={canShowMore}
          onOpenColumnsConfig={openModal}
        />

        {displayError && (
          <div className={`error-message ${isRateLimited ? 'rate-limited' : ''}`}>
            <p>{displayError}</p>
            {!isRateLimited && <button onClick={refresh}>{t('errors.tryAgain')}</button>}
          </div>
        )}

        {isLoading && assets.length === 0 ? (
          <div className="loading">
            <div className="loading-spinner"></div>
            <p>{getLoadingMessage()}</p>
          </div>
        ) : noResults ? (
          <div className="no-results">
            <p>{t('errors.noResults', { query: searchQuery })}</p>
            <p className="no-results-hint">{t('errors.noResultsHint')}</p>
          </div>
        ) : (
          <AssetTable
            assets={assets}
            sortConfig={sortConfig}
            onSort={handleSort}
            visibleColumns={visibleColumns}
          />
        )}

        <footer className="footer">
          <p>
            {t('footer.clickRow')}
          </p>
          <p className="auto-refresh-status">
            {isAutoRefreshing ? (
              t('footer.refreshingNow', { defaultValue: 'Refreshing data...' })
            ) : (
              t('footer.refreshingIn', { countdown: autoRefreshCountdown, defaultValue: `Refreshing in ${autoRefreshCountdown}` })
            )}
          </p>
        </footer>
      </main>

      <ColumnsConfigModal
        isOpen={isModalOpen}
        onClose={closeModal}
        visibleColumns={visibleColumns}
        onColumnsChange={updateColumns}
      />
    </div>
  );
}
