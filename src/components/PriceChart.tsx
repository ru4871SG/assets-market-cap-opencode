import { useTranslation } from 'react-i18next';
import { PricePoint, HistoricalEvent, ChartType, TechnicalIndicatorsConfig, EventCategory } from '../types/asset';
import { PriceWithInventory } from '../services/inventoryApi';
import { PriceWithIndicators } from '../utils/technicalIndicators';
import { EChartsPriceChart } from './EChartsPriceChart';
import './PriceChart.css';

// Map event categories to translation keys
const EVENT_TITLE_KEYS: Record<EventCategory, string> = {
  fed_rate_hike: 'eventTitles.fedRateHike',
  fed_rate_cut: 'eventTitles.fedRateCut',
  fed_rate_hold: 'eventTitles.fedRateHold',
  government_shutdown: 'eventTitles.governmentShutdown',
  recession: 'eventTitles.recession',
};

interface PriceChartProps {
  data: PricePoint[] | PriceWithInventory[] | PriceWithIndicators[];
  loading?: boolean;
  error?: string;
  events?: HistoricalEvent[];
  retryCountdown?: number | null;
  showInventoryOverlay?: boolean;
  chartType?: ChartType;
  indicatorsConfig?: TechnicalIndicatorsConfig;
  currency?: string;  // Currency code for price display (default: USD)
}

export function PriceChart({ 
  data, 
  loading, 
  error, 
  events = [], 
  retryCountdown, 
  showInventoryOverlay = false,
  chartType = 'line',
  indicatorsConfig,
  currency = 'USD'
}: PriceChartProps) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className="chart-container chart-loading">
        <div className="loading-spinner"></div>
        <p>{t('priceChart.loadingChart')}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="chart-container chart-error">
        <p>{error}</p>
        {retryCountdown !== null && retryCountdown !== undefined && retryCountdown > 0 && (
          <p className="retry-countdown">{t('priceChart.retryingIn', { seconds: retryCountdown })}</p>
        )}
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="chart-container chart-error">
        <p>{t('priceChart.noData')}</p>
      </div>
    );
  }

  // Check if we have OHLC data
  const hasOHLCData = data.some(d => d.open !== undefined && d.high !== undefined && d.low !== undefined);
  const effectiveChartType = hasOHLCData ? chartType : 'line';

  // Check if we have any indicators to render
  const hasIndicators = indicatorsConfig && (
    indicatorsConfig.movingAverage1.enabled ||
    indicatorsConfig.movingAverage2.enabled ||
    indicatorsConfig.bollingerBands.enabled
  );

  // Process events to find overlapping date ranges with chart data
  const processedEvents = events.map(event => {
    // Find the data points that fall within the event range
    const eventStart = new Date(event.start_date).getTime();
    const eventEnd = new Date(event.end_date).getTime() + 86400000; // Add 1 day to include end date
    
    // Find the first and last data points that overlap with the event
    let x1: string | undefined;
    let x2: string | undefined;
    
    for (const point of data) {
      const pointDate = point.date.split(' ')[0]; // Handle "YYYY-MM-DD HH:MM" format
      const pointTime = new Date(pointDate).getTime();
      
      if (pointTime >= eventStart && pointTime <= eventEnd) {
        if (!x1) x1 = point.date;
        x2 = point.date;
      }
    }
    
    return { ...event, x1, x2 };
  }).filter(e => e.x1 && e.x2);

  // Check if data has inventory overlay
  const dataWithInventory = data as PriceWithInventory[];
  const hasInventoryData = showInventoryOverlay && dataWithInventory.some(d => d.inventoryTotal !== undefined);
  
  // Inventory line color
  const inventoryColor = '#9c27b0'; // Purple for inventory

  // Render indicator legend
  const renderIndicatorLegend = () => {
    if (!indicatorsConfig || !hasIndicators) return null;
    
    return (
      <div className="chart-indicators-legend">
        {indicatorsConfig.movingAverage1.enabled && (
          <div className="indicator-legend-item">
            <span 
              className="indicator-legend-line" 
              style={{ backgroundColor: indicatorsConfig.movingAverage1.color }}
            />
            <span className="indicator-legend-label">
              {indicatorsConfig.movingAverage1.type} {indicatorsConfig.movingAverage1.period}
            </span>
          </div>
        )}
        {indicatorsConfig.movingAverage2.enabled && (
          <div className="indicator-legend-item">
            <span 
              className="indicator-legend-line" 
              style={{ backgroundColor: indicatorsConfig.movingAverage2.color }}
            />
            <span className="indicator-legend-label">
              {indicatorsConfig.movingAverage2.type} {indicatorsConfig.movingAverage2.period}
            </span>
          </div>
        )}
        {indicatorsConfig.bollingerBands.enabled && (
          <div className="indicator-legend-item">
            <span 
              className="indicator-legend-band" 
              style={{ backgroundColor: indicatorsConfig.bollingerBands.color }}
            />
            <span className="indicator-legend-label">
              BB ({indicatorsConfig.bollingerBands.period}, {indicatorsConfig.bollingerBands.standardDeviations}σ)
            </span>
          </div>
        )}
      </div>
    );
  };

  // Helper function to get translated event title
  const getEventTitle = (event: HistoricalEvent): string => {
    const titleKey = EVENT_TITLE_KEYS[event.category];
    if (titleKey) {
      return t(titleKey);
    }
    return event.title; // Fallback to original title
  };

  return (
    <div className="chart-container">
      {/* Event legend */}
      {processedEvents.length > 0 && (
        <div className="chart-events-legend">
          {Array.from(
            new Map(processedEvents.map(e => [e.category, e])).values()
          ).map(event => (
            <div key={event.category} className="chart-event-legend-item">
              <span 
                className="chart-event-color" 
                style={{ backgroundColor: event.category_info.color }}
              />
              <span className="chart-event-title">{getEventTitle(event)}</span>
            </div>
          ))}
        </div>
      )}
      
      {/* Indicator legend */}
      {renderIndicatorLegend()}
      
      {/* Inventory legend when overlay is shown */}
      {hasInventoryData && (
        <div className="chart-inventory-legend">
          <span className="inventory-legend-bar" style={{ backgroundColor: inventoryColor }} />
          <span className="inventory-legend-label">{t('priceChart.inventoryLabel')}</span>
        </div>
      )}
      
      {/* Chart - now using ECharts for all chart types */}
      <div className="chart-wrapper">
        <EChartsPriceChart
          data={data}
          chartType={effectiveChartType}
          events={events}
          showInventoryOverlay={showInventoryOverlay}
          indicatorsConfig={indicatorsConfig}
          currency={currency}
        />
      </div>
    </div>
  );
}
