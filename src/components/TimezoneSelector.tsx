import { useTranslation } from 'react-i18next';
import { TIMEZONE_OPTIONS, getTimezoneLabel } from '../utils/timezone';
import './TimezoneSelector.css';

interface TimezoneSelectorProps {
  selected: string;
  onChange: (timezone: string) => void;
  exchangeTimezone?: string;  // If provided, shows as "Exchange Local" option
  disabled?: boolean;
}

export function TimezoneSelector({ 
  selected, 
  onChange, 
  exchangeTimezone,
  disabled 
}: TimezoneSelectorProps) {
  const { t } = useTranslation();
  
  // Find if the current selection is in our options
  const isKnownTimezone = TIMEZONE_OPTIONS.some(opt => opt.value === selected) || 
                          (exchangeTimezone && selected === exchangeTimezone);
  
  return (
    <div className="timezone-selector">
      <label className="timezone-label">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="2" y1="12" x2="22" y2="12"/>
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
        </svg>
        {t('timezone.label')}
      </label>
      <select
        value={selected}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="timezone-select"
        title={getTimezoneLabel(selected)}
      >
        {/* User's local timezone if it's current selection but not in list */}
        {!isKnownTimezone && (
          <option value={selected}>
            {getTimezoneLabel(selected)} ({t('timezone.local')})
          </option>
        )}
        
        {/* Exchange local time option */}
        {exchangeTimezone && (
          <optgroup label={t('timezone.exchangeTime')}>
            <option value={exchangeTimezone}>
              {getTimezoneLabel(exchangeTimezone)} ({t('timezone.exchange')})
            </option>
          </optgroup>
        )}
        
        {/* Americas */}
        <optgroup label={t('timezone.americas')}>
          {TIMEZONE_OPTIONS.filter(opt => opt.value.startsWith('America/')).map(opt => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </optgroup>
        
        {/* Europe */}
        <optgroup label={t('timezone.europe')}>
          {TIMEZONE_OPTIONS.filter(opt => opt.value.startsWith('Europe/')).map(opt => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </optgroup>
        
        {/* Asia/Pacific */}
        <optgroup label={t('timezone.asiaPacific')}>
          {TIMEZONE_OPTIONS.filter(opt => 
            opt.value.startsWith('Asia/') || opt.value.startsWith('Australia/')
          ).map(opt => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </optgroup>
        
        {/* UTC */}
        <optgroup label="UTC">
          <option value="UTC">UTC</option>
        </optgroup>
      </select>
    </div>
  );
}
