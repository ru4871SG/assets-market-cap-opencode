import { CandleInterval, CANDLE_INTERVAL_LABELS } from '../types/asset';
import './TimeRangeSelector.css';

interface TimeRangeSelectorProps {
  selected: CandleInterval;
  onChange: (interval: CandleInterval) => void;
  loading?: boolean;
}

// TradingView-style candle intervals
const CANDLE_INTERVALS: { value: CandleInterval; label: string }[] = [
  { value: '5m', label: CANDLE_INTERVAL_LABELS['5m'] },
  { value: '15m', label: CANDLE_INTERVAL_LABELS['15m'] },
  { value: '1h', label: CANDLE_INTERVAL_LABELS['1h'] },
  { value: '1d', label: CANDLE_INTERVAL_LABELS['1d'] },
];

export function TimeRangeSelector({ selected, onChange, loading }: TimeRangeSelectorProps) {
  return (
    <div className="time-range-selector">
      {CANDLE_INTERVALS.map(({ value, label }) => (
        <button
          key={value}
          className={`time-range-btn ${selected === value ? 'active' : ''}`}
          onClick={() => onChange(value)}
          disabled={loading}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
