import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  fetchMetalPremium, 
  hasPremiumData, 
  formatPremium, 
  getPremiumClass,
  PremiumData,
  PremiumRegionData 
} from '../services/premiumApi';
import './PremiumPrices.css';

interface PremiumPricesProps {
  symbol: string;
  metalName: string;
  westernPrice?: number;  // yfinance price to use instead of metalcharts western price
}

interface PremiumCardProps {
  region: 'shanghai' | 'india';
  data: PremiumRegionData | null;
  loading: boolean;
  error: string | null;
  westernPrice?: number;  // Override western price from yfinance
}

function PremiumCard({ region, data, loading, error, westernPrice }: PremiumCardProps) {
  const { t } = useTranslation();
  
  const regionTitle = region === 'shanghai' 
    ? t('premium.shanghai.title', 'Shanghai Premium')
    : t('premium.india.title', 'India Premium');
    
  const spotLabel = region === 'shanghai'
    ? t('premium.shanghai.spot', 'SGE Spot')
    : t('premium.india.spot', 'MCX Spot');

  if (loading) {
    return (
      <div className="premium-card">
        <h4 className="premium-card-title">{regionTitle}</h4>
        <div className="premium-card-loading">
          <div className="loading-spinner-small"></div>
          <span>{t('premium.loading', 'Loading...')}</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="premium-card premium-card-error">
        <h4 className="premium-card-title">{regionTitle}</h4>
        <p className="premium-error-message">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="premium-card premium-card-unavailable">
        <h4 className="premium-card-title">{regionTitle}</h4>
        <p className="premium-unavailable-message">
          {t('premium.unavailable', 'Data unavailable')}
        </p>
      </div>
    );
  }

  // Get the local spot price
  const localSpot = region === 'shanghai' ? data.shanghai_spot : data.india_spot;
  
  // Use westernPrice from yfinance if provided, otherwise fall back to metalcharts data
  const displayWesternPrice = westernPrice ?? data.western_spot;
  
  // Recalculate premium if we have a westernPrice override
  let spotPremium = data.spot_premium;
  let spotPremiumPct = data.spot_premium_pct;
  
  if (westernPrice && localSpot) {
    spotPremium = localSpot - westernPrice;
    spotPremiumPct = (spotPremium / westernPrice) * 100;
  }

  return (
    <div className="premium-card">
      <h4 className="premium-card-title">{regionTitle}</h4>
      
      <div className="premium-prices-grid">
        {/* Local Spot Price */}
        <div className="premium-price-row">
          <span className="premium-label">{spotLabel}</span>
          <span className="premium-value">
            {localSpot ? `$${localSpot.toFixed(2)}` : '--'}
          </span>
        </div>
        
        {/* Western Price (reference) - use yfinance price if available */}
        <div className="premium-price-row premium-western">
          <span className="premium-label">{t('premium.westernPrice', 'Western')}</span>
          <span className="premium-value">
            {displayWesternPrice ? `$${displayWesternPrice.toFixed(2)}` : '--'}
          </span>
        </div>
      </div>

      {/* Premium Display */}
      <div className="premium-difference-section">
        <div className="premium-difference-header">
          {t('premium.premiumDiscount', 'Premium/Discount')}
        </div>
        
        {/* Spot Premium - use recalculated values */}
        {spotPremium !== null && (
          <div className={`premium-diff-row ${getPremiumClass(spotPremium)}`}>
            <div className="premium-diff-values">
              <span className="premium-diff-absolute">
                {formatPremium(spotPremium)}
              </span>
              <span className="premium-diff-percent">
                ({formatPremium(spotPremiumPct, true)})
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Source note if using proxy */}
      {data.note && (
        <div className="premium-note">
          {data.note}
        </div>
      )}
    </div>
  );
}

export function PremiumPrices({ symbol, metalName, westernPrice }: PremiumPricesProps) {
  const { t } = useTranslation();
  const [data, setData] = useState<PremiumData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const supportsPremium = hasPremiumData(symbol);
  // India premium only available for silver (XAG)
  const showIndiaPremium = symbol === 'XAG';

  useEffect(() => {
    if (!supportsPremium) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    fetchMetalPremium(symbol)
      .then((response) => {
        setData(response);
      })
      .catch((err) => {
        console.error('Error fetching premium data:', err);
        setError(err.message || 'Failed to load premium data');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [symbol, supportsPremium]);

  // Don't render if metal doesn't support premium data
  if (!supportsPremium) {
    return null;
  }

  return (
    <div className="premium-prices-container">
      <div className="premium-prices-header">
        <h3>{t('premium.title', 'Regional Premiums')}</h3>
        <span className="premium-metal-name">{metalName}</span>
      </div>
      
      <p className="premium-description">
        {t('premium.description', 'Price differences between local exchanges and Western spot prices.')}
      </p>

      <div className="premium-cards">
        <PremiumCard
          region="shanghai"
          data={data?.shanghai ?? null}
          loading={loading}
          error={data?.errors?.shanghai ?? (error && !data ? error : null)}
          westernPrice={westernPrice}
        />
        {showIndiaPremium && (
          <PremiumCard
            region="india"
            data={data?.india ?? null}
            loading={loading}
            error={data?.errors?.india ?? (error && !data ? error : null)}
            westernPrice={westernPrice}
          />
        )}
      </div>

      <div className="premium-footer">
        <p className="premium-source">
          {showIndiaPremium 
            ? t('premium.sources', 'Sources: SGE, MCX via metalcharts.org')
            : t('premium.sourcesShanghaiOnly', 'Source: SGE via metalcharts.org')
          }
        </p>
        {data?.timestamp && (
          <p className="premium-timestamp">
            {t('premium.lastUpdated', 'Updated')}: {new Date(data.timestamp).toLocaleTimeString()}
          </p>
        )}
      </div>
    </div>
  );
}
