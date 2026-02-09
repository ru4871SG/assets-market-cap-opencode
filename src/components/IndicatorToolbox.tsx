import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  TechnicalIndicatorsConfig, 
  MovingAverageType, 
  MovingAverageConfig,
  BollingerBandsConfig,
  MA_PERIODS,
  DEFAULT_INDICATORS_CONFIG 
} from '../types/asset';
import './IndicatorToolbox.css';

interface IndicatorToolboxProps {
  config: TechnicalIndicatorsConfig;
  onChange: (config: TechnicalIndicatorsConfig) => void;
  disabled?: boolean;
}

interface MAConfigPanelProps {
  label: string;
  config: MovingAverageConfig;
  onChange: (config: MovingAverageConfig) => void;
  disabled?: boolean;
}

function MAConfigPanel({ label, config, onChange, disabled }: MAConfigPanelProps) {
  const { t } = useTranslation();
  
  return (
    <div className={`indicator-config-panel ${config.enabled ? 'enabled' : ''}`}>
      <div className="indicator-header">
        <label className="indicator-toggle">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => onChange({ ...config, enabled: e.target.checked })}
            disabled={disabled}
          />
          <span className="indicator-label">{label}</span>
        </label>
        {config.enabled && (
          <div 
            className="indicator-color-dot" 
            style={{ backgroundColor: config.color }}
          />
        )}
      </div>
      
      {config.enabled && (
        <div className="indicator-options">
          <div className="indicator-option">
            <label>{t('indicators.type')}</label>
            <select
              value={config.type}
              onChange={(e) => onChange({ ...config, type: e.target.value as MovingAverageType })}
              disabled={disabled}
            >
              <option value="SMA">SMA</option>
              <option value="EMA">EMA</option>
            </select>
          </div>
          <div className="indicator-option">
            <label>{t('indicators.period')}</label>
            <select
              value={config.period}
              onChange={(e) => onChange({ ...config, period: parseInt(e.target.value) })}
              disabled={disabled}
            >
              {MA_PERIODS.map(period => (
                <option key={period} value={period}>{period}</option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}

interface BBConfigPanelProps {
  config: BollingerBandsConfig;
  onChange: (config: BollingerBandsConfig) => void;
  disabled?: boolean;
}

function BBConfigPanel({ config, onChange, disabled }: BBConfigPanelProps) {
  const { t } = useTranslation();
  
  return (
    <div className={`indicator-config-panel ${config.enabled ? 'enabled' : ''}`}>
      <div className="indicator-header">
        <label className="indicator-toggle">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => onChange({ ...config, enabled: e.target.checked })}
            disabled={disabled}
          />
          <span className="indicator-label">{t('indicators.bollingerBands')}</span>
        </label>
        {config.enabled && (
          <div 
            className="indicator-color-dot" 
            style={{ backgroundColor: config.color }}
          />
        )}
      </div>
      
      {config.enabled && (
        <div className="indicator-options">
          <div className="indicator-option">
            <label>{t('indicators.period')}</label>
            <select
              value={config.period}
              onChange={(e) => onChange({ ...config, period: parseInt(e.target.value) })}
              disabled={disabled}
            >
              {[10, 20, 50].map(period => (
                <option key={period} value={period}>{period}</option>
              ))}
            </select>
          </div>
          <div className="indicator-option">
            <label>{t('indicators.stdDev')}</label>
            <select
              value={config.standardDeviations}
              onChange={(e) => onChange({ ...config, standardDeviations: parseFloat(e.target.value) })}
              disabled={disabled}
            >
              <option value={1}>1σ</option>
              <option value={1.5}>1.5σ</option>
              <option value={2}>2σ</option>
              <option value={2.5}>2.5σ</option>
              <option value={3}>3σ</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
}

export function IndicatorToolbox({ config, onChange, disabled }: IndicatorToolboxProps) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  
  // Count active indicators
  const activeCount = [
    config.movingAverage1.enabled,
    config.movingAverage2.enabled,
    config.bollingerBands.enabled,
  ].filter(Boolean).length;
  
  const handleMA1Change = (ma1: MovingAverageConfig) => {
    onChange({ ...config, movingAverage1: ma1 });
  };
  
  const handleMA2Change = (ma2: MovingAverageConfig) => {
    onChange({ ...config, movingAverage2: ma2 });
  };
  
  const handleBBChange = (bb: BollingerBandsConfig) => {
    onChange({ ...config, bollingerBands: bb });
  };
  
  const handleReset = () => {
    onChange(DEFAULT_INDICATORS_CONFIG);
  };

  return (
    <div className="indicator-toolbox">
      <button 
        className={`indicator-toolbox-toggle ${isExpanded ? 'expanded' : ''} ${activeCount > 0 ? 'has-active' : ''}`}
        onClick={() => setIsExpanded(!isExpanded)}
        disabled={disabled}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 3v18h18" />
          <path d="M18 17V9" />
          <path d="M13 17V5" />
          <path d="M8 17v-3" />
        </svg>
        <span>{t('indicators.title')}</span>
        {activeCount > 0 && (
          <span className="indicator-count">{activeCount}</span>
        )}
        <svg 
          className="chevron" 
          width="12" 
          height="12" 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor" 
          strokeWidth="2"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      
      {isExpanded && (
        <div className="indicator-toolbox-content">
          <MAConfigPanel
            label={t('indicators.movingAverage1')}
            config={config.movingAverage1}
            onChange={handleMA1Change}
            disabled={disabled}
          />
          
          <MAConfigPanel
            label={t('indicators.movingAverage2')}
            config={config.movingAverage2}
            onChange={handleMA2Change}
            disabled={disabled}
          />
          
          <BBConfigPanel
            config={config.bollingerBands}
            onChange={handleBBChange}
            disabled={disabled}
          />
          
          {activeCount > 0 && (
            <button 
              className="indicator-reset-btn"
              onClick={handleReset}
              disabled={disabled}
            >
              {t('indicators.reset')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
