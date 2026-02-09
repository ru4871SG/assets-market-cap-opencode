import { useTranslation } from 'react-i18next';
import { ChartType } from '../types/asset';
import './ChartTypeSelector.css';

interface ChartTypeSelectorProps {
  selected: ChartType;
  onChange: (type: ChartType) => void;
  disabled?: boolean;
}

export function ChartTypeSelector({ selected, onChange, disabled }: ChartTypeSelectorProps) {
  const { t } = useTranslation();

  return (
    <div className="chart-type-selector">
      <button
        className={`chart-type-btn ${selected === 'line' ? 'active' : ''}`}
        onClick={() => onChange('line')}
        disabled={disabled}
        title={t('chartType.lineTooltip')}
        aria-label={t('chartType.line')}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
      </button>
      <button
        className={`chart-type-btn ${selected === 'ohlc' ? 'active' : ''}`}
        onClick={() => onChange('ohlc')}
        disabled={disabled}
        title={t('chartType.ohlcTooltip')}
        aria-label={t('chartType.ohlc')}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="6" y1="4" x2="6" y2="20" />
          <line x1="4" y1="8" x2="6" y2="8" />
          <line x1="6" y1="16" x2="8" y2="16" />
          <line x1="12" y1="6" x2="12" y2="18" />
          <line x1="10" y1="10" x2="12" y2="10" />
          <line x1="12" y1="14" x2="14" y2="14" />
          <line x1="18" y1="3" x2="18" y2="21" />
          <line x1="16" y1="7" x2="18" y2="7" />
          <line x1="18" y1="17" x2="20" y2="17" />
        </svg>
      </button>
      <button
        className={`chart-type-btn ${selected === 'candlestick' ? 'active' : ''}`}
        onClick={() => onChange('candlestick')}
        disabled={disabled}
        title={t('chartType.candlestickTooltip')}
        aria-label={t('chartType.candlestick')}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {/* Green candle (bullish) */}
          <line x1="5" y1="3" x2="5" y2="7" />
          <rect x="3" y="7" width="4" height="8" fill="currentColor" />
          <line x1="5" y1="15" x2="5" y2="18" />
          {/* Red candle (bearish) */}
          <line x1="12" y1="5" x2="12" y2="9" />
          <rect x="10" y="9" width="4" height="7" fill="none" />
          <line x1="12" y1="16" x2="12" y2="20" />
          {/* Green candle (bullish) */}
          <line x1="19" y1="4" x2="19" y2="8" />
          <rect x="17" y="8" width="4" height="6" fill="currentColor" />
          <line x1="19" y1="14" x2="19" y2="19" />
        </svg>
      </button>
    </div>
  );
}
