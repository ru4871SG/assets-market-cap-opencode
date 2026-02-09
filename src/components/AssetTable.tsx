import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Asset, SortConfig, SortField, ChangeColumn } from '../types/asset';
import './AssetTable.css';

interface AssetTableProps {
  assets: Asset[];
  sortConfig: SortConfig;
  onSort: (field: SortField) => void;
  visibleColumns: ChangeColumn[];
}

function formatMarketCap(value: number): string {
  if (value >= 1e12) {
    return `$${(value / 1e12).toFixed(2)}T`;
  }
  if (value >= 1e9) {
    return `$${(value / 1e9).toFixed(2)}B`;
  }
  if (value >= 1e6) {
    return `$${(value / 1e6).toFixed(2)}M`;
  }
  return `$${value.toFixed(2)}`;
}

function formatPrice(value: number): string {
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

function getTypeLabel(type: string, t: (key: string) => string): string {
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

function getTypeColor(type: string): string {
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

function SortIcon({ field, sortConfig }: { field: SortField; sortConfig: SortConfig }) {
  const isActive = sortConfig.field === field;
  const direction = isActive ? sortConfig.direction : null;

  return (
    <span className="sort-icon">
      {direction === 'asc' ? ' \u25B2' : direction === 'desc' ? ' \u25BC' : ' \u21C5'}
    </span>
  );
}

// Column configuration for change columns
const CHANGE_COLUMN_CONFIG: Record<ChangeColumn, { label: string; field: SortField }> = {
  change7d: { label: 'table.change7d', field: 'change7d' },
  change30d: { label: 'table.change30d', field: 'change30d' },
  change60d: { label: 'table.change60d', field: 'change60d' },
  change90d: { label: 'table.change90d', field: 'change90d' },
  changeYtd: { label: 'table.changeYtd', field: 'changeYtd' },
  change180d: { label: 'table.change180d', field: 'change180d' },
};

/**
 * Extract the raw ID from asset.id for routing
 * e.g., "crypto-bitcoin" -> "bitcoin", "stock-aapl" -> "aapl"
 */
function getAssetSlug(assetId: string, type: string): string {
  return assetId.replace(`${type}-`, '');
}

export function AssetTable({ assets, sortConfig, onSort, visibleColumns }: AssetTableProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const handleRowClick = (asset: Asset) => {
    // Don't navigate if there's an error
    if (asset.error) return;
    
    const slug = getAssetSlug(asset.id, asset.type);
    navigate(`/asset/${asset.type}/${slug}`);
  };

  // Function to get translated asset name
  const getAssetName = (name: string) => {
    // Check if the name is a known commodity
    const translationKey = `assetNames.${name}`;
    const translated = t(translationKey);
    // If translation key doesn't exist, return original name
    return translated === translationKey ? name : translated;
  };

  // Helper to render a change cell
  const renderChangeCell = (value: number | undefined | null) => {
    if (value === undefined || value === null) {
      return <td className="change-col">-</td>;
    }
    return (
      <td className={`change-col ${value >= 0 ? 'positive' : 'negative'}`}>
        {value >= 0 ? '+' : ''}{value.toFixed(2)}%
      </td>
    );
  };

  // Calculate colspan for error cells (includes visible change columns)
  const errorColspan = 3 + visibleColumns.length;

  return (
    <div className="table-container">
      <table className="asset-table">
        <thead>
          <tr>
            <th className="rank-col" onClick={() => onSort('rank')}>
              {t('table.rank')}<SortIcon field="rank" sortConfig={sortConfig} />
            </th>
            <th className="name-col" onClick={() => onSort('name')}>
              {t('table.name')}<SortIcon field="name" sortConfig={sortConfig} />
            </th>
            <th className="type-col">{t('table.type')}</th>
            <th className="price-col" onClick={() => onSort('price')}>
              {t('table.price')}<SortIcon field="price" sortConfig={sortConfig} />
            </th>
            <th className="marketcap-col" onClick={() => onSort('marketCap')}>
              {t('table.marketCap')}<SortIcon field="marketCap" sortConfig={sortConfig} />
            </th>
            <th className="change-col" onClick={() => onSort('change24h')}>
              {t('table.change24h')}<SortIcon field="change24h" sortConfig={sortConfig} />
            </th>
            {visibleColumns.map((column) => (
              <th 
                key={column}
                className="change-col" 
                onClick={() => onSort(CHANGE_COLUMN_CONFIG[column].field)}
              >
                {t(CHANGE_COLUMN_CONFIG[column].label)}
                <SortIcon field={CHANGE_COLUMN_CONFIG[column].field} sortConfig={sortConfig} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {assets.map((asset) => (
            <tr 
              key={asset.id} 
              className={`${asset.error ? 'error-row' : 'clickable-row'}`}
              onClick={() => handleRowClick(asset)}
            >
              <td className="rank-col">{asset.error ? '-' : asset.rank}</td>
              <td className="name-col">
                <div className="asset-name">
                  {asset.image && !asset.error && (
                    <img
                      src={asset.image}
                      alt={asset.name}
                      className="asset-logo"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  )}
                  <div className="name-details">
                    <span className="name">{getAssetName(asset.name)}</span>
                    <span className="symbol">{asset.symbol}</span>
                  </div>
                </div>
              </td>
              <td className="type-col">
                <span
                  className="type-badge"
                  style={{ backgroundColor: getTypeColor(asset.type) }}
                >
                  {getTypeLabel(asset.type, t)}
                </span>
              </td>
              {asset.error ? (
                <td colSpan={errorColspan} className="error-cell">
                  {asset.error}
                </td>
              ) : (
                <>
                  <td className="price-col">{formatPrice(asset.price)}</td>
                  <td className="marketcap-col">{formatMarketCap(asset.marketCap)}</td>
                  <td
                    className={`change-col ${
                      asset.change24h >= 0 ? 'positive' : 'negative'
                    }`}
                  >
                    {asset.change24h >= 0 ? '+' : ''}
                    {asset.change24h.toFixed(2)}%
                  </td>
                  {visibleColumns.map((column) => (
                    <React.Fragment key={column}>
                      {renderChangeCell(asset[column])}
                    </React.Fragment>
                  ))}
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
