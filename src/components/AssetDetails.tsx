import { CryptoDetails, StockDetails, MetalDetails, AssetType } from '../types/asset';
import { useTranslation } from 'react-i18next';
import { MarketStatus } from './MarketStatus';
import './AssetDetails.css';

interface AssetDetailsProps {
  details: CryptoDetails | StockDetails | MetalDetails | null;
  type: AssetType;
  loading?: boolean;
  error?: string;
  retryCountdown?: number | null;
}

function formatNumber(value: number | undefined | null, decimals: number = 2): string {
  if (value === undefined || value === null) return 'N/A';
  return value.toLocaleString('en-US', { 
    minimumFractionDigits: decimals, 
    maximumFractionDigits: decimals 
  });
}

function formatLargeNumber(value: number | undefined | null): string {
  if (value === undefined || value === null) return 'N/A';
  if (value >= 1e12) {
    return `$${(value / 1e12).toFixed(2)}T`;
  }
  if (value >= 1e9) {
    return `$${(value / 1e9).toFixed(2)}B`;
  }
  if (value >= 1e6) {
    return `$${(value / 1e6).toFixed(2)}M`;
  }
  return `$${formatNumber(value)}`;
}

function formatPrice(value: number | undefined | null): string {
  if (value === undefined || value === null) return 'N/A';
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

// Format price with currency code (e.g., "38.60 HKD" for non-USD currencies)
function formatPriceWithCurrency(value: number | undefined | null, currency: string): string {
  if (value === undefined || value === null) return 'N/A';
  if (currency === 'USD') {
    return formatPrice(value);
  }
  // Non-USD currencies: show number followed by currency code
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
  if (value === undefined || value === null) return 'N/A';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function formatSupply(value: number | undefined | null): string {
  if (value === undefined || value === null) return 'N/A';
  if (value >= 1e12) {
    return `${(value / 1e12).toFixed(2)}T`;
  }
  if (value >= 1e9) {
    return `${(value / 1e9).toFixed(2)}B`;
  }
  if (value >= 1e6) {
    return `${(value / 1e6).toFixed(2)}M`;
  }
  return formatNumber(value, 0);
}

interface DetailRowProps {
  label: string;
  value: string;
  valueClass?: string;
}

function DetailRow({ label, value, valueClass }: DetailRowProps) {
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className={`detail-value ${valueClass || ''}`}>{value}</span>
    </div>
  );
}

function CryptoDetailsPanel({ details }: { details: CryptoDetails }) {
  const { t } = useTranslation();
  const md = details.market_data;
  const priceChange = md.price_change_percentage_24h;
  
  // Check if we have market cap data (TwelveData free tier doesn't provide this)
  const hasMarketCap = md.market_cap !== null && md.market_cap !== undefined && md.market_cap > 0;
  const hasSupplyData = (md.circulating_supply !== null && md.circulating_supply !== undefined) ||
                        (md.total_supply !== null && md.total_supply !== undefined) ||
                        (md.max_supply !== null && md.max_supply !== undefined);
  const hasTradingData = (md.open !== null && md.open !== undefined) ||
                         (md.day_high !== null && md.day_high !== undefined) ||
                         (md.day_low !== null && md.day_low !== undefined);
  const has52WeekData = (md.fifty_two_week_high !== null && md.fifty_two_week_high !== undefined) ||
                        (md.fifty_two_week_low !== null && md.fifty_two_week_low !== undefined);
  
  return (
    <>
      {/* Always show 24h change */}
      <div className="detail-section">
        <h3>{t('assetDetails.priceChange')}</h3>
        <DetailRow 
          label={t('assetDetails.change24h')} 
          value={formatPercentage(priceChange)} 
          valueClass={priceChange && priceChange >= 0 ? 'positive' : 'negative'}
        />
        {md.price_change_24h !== null && md.price_change_24h !== undefined && (
          <DetailRow 
            label={t('assetDetails.changeValue')} 
            value={formatPrice(md.price_change_24h)} 
          />
        )}
      </div>
      
      {/* Show market statistics only if we have market cap */}
      {hasMarketCap && (
        <div className="detail-section">
          <h3>{t('assetDetails.marketStatistics')}</h3>
          <DetailRow label={t('assetDetails.marketCap')} value={formatLargeNumber(md.market_cap)} />
          {md.volume !== null && md.volume !== undefined && (
            <DetailRow label={t('assetDetails.volume')} value={formatNumber(md.volume, 0)} />
          )}
        </div>
      )}
      
      {/* Show today's trading data if available */}
      {hasTradingData && (
        <div className="detail-section">
          <h3>{t('assetDetails.todaysTrading')}</h3>
          {md.open !== null && md.open !== undefined && (
            <DetailRow label={t('assetDetails.open')} value={formatPrice(md.open)} />
          )}
          {md.day_high !== null && md.day_high !== undefined && (
            <DetailRow label={t('assetDetails.dayHigh')} value={formatPrice(md.day_high)} />
          )}
          {md.day_low !== null && md.day_low !== undefined && (
            <DetailRow label={t('assetDetails.dayLow')} value={formatPrice(md.day_low)} />
          )}
          {md.previous_close !== null && md.previous_close !== undefined && (
            <DetailRow label={t('assetDetails.prevClose')} value={formatPrice(md.previous_close)} />
          )}
        </div>
      )}
      
      {/* Show 52-week range if available */}
      {has52WeekData && (
        <div className="detail-section">
          <h3>{t('assetDetails.fiftyTwoWeekRange')}</h3>
          {md.fifty_two_week_high !== null && md.fifty_two_week_high !== undefined && (
            <DetailRow label={t('assetDetails.fiftyTwoWeekHigh')} value={formatPrice(md.fifty_two_week_high)} />
          )}
          {md.fifty_two_week_low !== null && md.fifty_two_week_low !== undefined && (
            <DetailRow label={t('assetDetails.fiftyTwoWeekLow')} value={formatPrice(md.fifty_two_week_low)} />
          )}
        </div>
      )}
      
      {/* Show supply data only if available */}
      {hasSupplyData && (
        <div className="detail-section">
          <h3>{t('assetDetails.supply')}</h3>
          {md.circulating_supply !== null && md.circulating_supply !== undefined && (
            <DetailRow label={t('assetDetails.circulating')} value={formatSupply(md.circulating_supply)} />
          )}
          {md.total_supply !== null && md.total_supply !== undefined && (
            <DetailRow label={t('assetDetails.totalSupply')} value={formatSupply(md.total_supply)} />
          )}
          <DetailRow label={t('assetDetails.maxSupply')} value={md.max_supply ? formatSupply(md.max_supply) : t('assetDetails.unlimited')} />
        </div>
      )}
      
      {details.links?.homepage && (
        <div className="detail-section">
          <h3>{t('assetDetails.links')}</h3>
          <a href={details.links.homepage} target="_blank" rel="noopener noreferrer" className="detail-link">
            {t('assetDetails.officialWebsite')}
          </a>
        </div>
      )}
    </>
  );
}

function StockDetailsPanel({ details }: { details: StockDetails }) {
  const { t } = useTranslation();
  const md = details.market_data;
  const ci = details.company_info;
  const ei = details.exchange_info;
  const currency = details.currency || 'USD';
  
  // Helper to format price with the stock's native currency
  const fmtPrice = (value: number | undefined | null) => formatPriceWithCurrency(value, currency);
  
  return (
    <>
      {ei && (ei.exchange || ei.exchange_timezone) && (
        <MarketStatus 
          exchange={ei.exchange}
          exchangeTimezone={ei.exchange_timezone}
          exchangeTimezoneShort={ei.exchange_timezone_short}
        />
      )}
      
      <div className="detail-section">
        <h3>{t('assetDetails.marketStatistics')}</h3>
        <DetailRow label={t('assetDetails.marketCap')} value={formatLargeNumber(md.market_cap)} />
        <DetailRow label={t('assetDetails.volume')} value={md.volume ? formatNumber(md.volume, 0) : 'N/A'} />
        <DetailRow label={t('assetDetails.avgVolume')} value={md.average_volume ? formatNumber(md.average_volume, 0) : 'N/A'} />
        <DetailRow label={t('assetDetails.sharesOut')} value={formatSupply(md.shares_outstanding)} />
      </div>
      
      <div className="detail-section">
        <h3>{t('assetDetails.todaysTrading')}</h3>
        <DetailRow label={t('assetDetails.open')} value={fmtPrice(md.open)} />
        <DetailRow label={t('assetDetails.dayHigh')} value={fmtPrice(md.day_high)} />
        <DetailRow label={t('assetDetails.dayLow')} value={fmtPrice(md.day_low)} />
        <DetailRow label={t('assetDetails.prevClose')} value={fmtPrice(md.previous_close)} />
      </div>
      
      <div className="detail-section">
        <h3>{t('assetDetails.fiftyTwoWeekRange')}</h3>
        <DetailRow label={t('assetDetails.fiftyTwoWeekHigh')} value={fmtPrice(md.fifty_two_week_high)} />
        <DetailRow label={t('assetDetails.fiftyTwoWeekLow')} value={fmtPrice(md.fifty_two_week_low)} />
        <DetailRow label={t('assetDetails.fiftyDayAvg')} value={fmtPrice(md.fifty_day_average)} />
        <DetailRow label={t('assetDetails.twoHundredDayAvg')} value={fmtPrice(md.two_hundred_day_average)} />
      </div>
      
      <div className="detail-section">
        <h3>{t('assetDetails.valuation')}</h3>
        <DetailRow label={t('assetDetails.peRatioTTM')} value={md.trailing_pe ? formatNumber(md.trailing_pe) : 'N/A'} />
        <DetailRow label={t('assetDetails.peRatioFWD')} value={md.forward_pe ? formatNumber(md.forward_pe) : 'N/A'} />
        <DetailRow label={t('assetDetails.divYield')} value={md.dividend_yield ? `${(md.dividend_yield * 100).toFixed(2)}%` : 'N/A'} />
        <DetailRow label={t('assetDetails.beta')} value={md.beta ? formatNumber(md.beta) : 'N/A'} />
      </div>
      
      {ci && (
        <div className="detail-section">
          <h3>{t('assetDetails.companyInfo')}</h3>
          <DetailRow label={t('assetDetails.sector')} value={ci.sector || 'N/A'} />
          <DetailRow label={t('assetDetails.industry')} value={ci.industry || 'N/A'} />
          <DetailRow label={t('assetDetails.employees')} value={ci.employees ? formatNumber(ci.employees, 0) : 'N/A'} />
          {ci.headquarters && ci.headquarters !== ', ' && (
            <DetailRow label={t('assetDetails.headquarters')} value={ci.headquarters} />
          )}
          {ci.website && (
            <a href={ci.website} target="_blank" rel="noopener noreferrer" className="detail-link">
              {t('assetDetails.companyWebsite')}
            </a>
          )}
        </div>
      )}
    </>
  );
}

function MetalDetailsPanel({ details }: { details: MetalDetails }) {
  const { t } = useTranslation();
  const md = details.market_data;
  
  return (
    <>
      <div className="detail-section">
        <h3>{t('assetDetails.marketStatistics')}</h3>
        <DetailRow label={t('assetDetails.marketCap')} value={formatLargeNumber(md.market_cap)} />
        <DetailRow label={t('assetDetails.volume')} value={md.volume ? formatNumber(md.volume, 0) : 'N/A'} />
        <DetailRow label={t('assetDetails.futures')} value={details.futures_ticker || 'N/A'} />
      </div>
      
      <div className="detail-section">
        <h3>{t('assetDetails.todaysTrading')}</h3>
        <DetailRow label={t('assetDetails.open')} value={formatPrice(md.open)} />
        <DetailRow label={t('assetDetails.dayHigh')} value={formatPrice(md.day_high)} />
        <DetailRow label={t('assetDetails.dayLow')} value={formatPrice(md.day_low)} />
        <DetailRow label={t('assetDetails.prevClose')} value={formatPrice(md.previous_close)} />
      </div>
      
      <div className="detail-section">
        <h3>{t('assetDetails.fiftyTwoWeekRange')}</h3>
        <DetailRow label={t('assetDetails.fiftyTwoWeekHigh')} value={formatPrice(md.fifty_two_week_high)} />
        <DetailRow label={t('assetDetails.fiftyTwoWeekLow')} value={formatPrice(md.fifty_two_week_low)} />
      </div>
      
      <div className="detail-section">
        <h3>{t('assetDetails.supply')}</h3>
        <DetailRow 
          label={t('assetDetails.aboveGround')} 
          value={md.above_ground_supply ? `${formatSupply(md.above_ground_supply)} ${md.supply_unit || ''}` : 'N/A'} 
        />
      </div>
    </>
  );
}

export function AssetDetails({ details, type, loading, error, retryCountdown }: AssetDetailsProps) {
  const { t } = useTranslation();
  
  if (loading) {
    return (
      <div className="asset-details asset-details-loading">
        <div className="loading-spinner"></div>
        <p>{t('assetDetails.loadingDetails')}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="asset-details asset-details-error">
        <p>{error}</p>
        {retryCountdown !== null && retryCountdown !== undefined && retryCountdown > 0 && (
          <p className="retry-countdown">{t('assetDetails.retryingIn', { seconds: retryCountdown })}</p>
        )}
      </div>
    );
  }

  if (!details) {
    return null;
  }

  return (
    <div className="asset-details">
      {type === 'crypto' && <CryptoDetailsPanel details={details as CryptoDetails} />}
      {type === 'stock' && <StockDetailsPanel details={details as StockDetails} />}
      {type === 'metal' && <MetalDetailsPanel details={details as MetalDetails} />}
    </div>
  );
}
