import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import './MarketStatus.css';

// Exchange market hours configuration
// All times are in the exchange's local timezone
interface ExchangeConfig {
  name: string;
  timezone: string;
  openHour: number;
  openMinute: number;
  closeHour: number;
  closeMinute: number;
  tradingDays: number[]; // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
}

// Map yfinance exchange codes to our config
// Common exchange codes from yfinance:
// NMS = NASDAQ, NYQ = NYSE, PCX = NYSE Arca, NGM = NASDAQ Global Market
// HKG = Hong Kong, TYO = Tokyo, LON = London, etc.
const EXCHANGE_CONFIG: Record<string, ExchangeConfig> = {
  // US Exchanges (Eastern Time)
  'NMS': { name: 'NASDAQ', timezone: 'America/New_York', openHour: 9, openMinute: 30, closeHour: 16, closeMinute: 0, tradingDays: [1, 2, 3, 4, 5] },
  'NGM': { name: 'NASDAQ', timezone: 'America/New_York', openHour: 9, openMinute: 30, closeHour: 16, closeMinute: 0, tradingDays: [1, 2, 3, 4, 5] },
  'NCM': { name: 'NASDAQ', timezone: 'America/New_York', openHour: 9, openMinute: 30, closeHour: 16, closeMinute: 0, tradingDays: [1, 2, 3, 4, 5] },
  'NYQ': { name: 'NYSE', timezone: 'America/New_York', openHour: 9, openMinute: 30, closeHour: 16, closeMinute: 0, tradingDays: [1, 2, 3, 4, 5] },
  'PCX': { name: 'NYSE Arca', timezone: 'America/New_York', openHour: 9, openMinute: 30, closeHour: 16, closeMinute: 0, tradingDays: [1, 2, 3, 4, 5] },
  'BTS': { name: 'NYSE', timezone: 'America/New_York', openHour: 9, openMinute: 30, closeHour: 16, closeMinute: 0, tradingDays: [1, 2, 3, 4, 5] },
  'ASE': { name: 'NYSE American', timezone: 'America/New_York', openHour: 9, openMinute: 30, closeHour: 16, closeMinute: 0, tradingDays: [1, 2, 3, 4, 5] },
  
  // Hong Kong
  'HKG': { name: 'HKEX', timezone: 'Asia/Hong_Kong', openHour: 9, openMinute: 30, closeHour: 16, closeMinute: 0, tradingDays: [1, 2, 3, 4, 5] },
  
  // Tokyo
  'TYO': { name: 'TSE', timezone: 'Asia/Tokyo', openHour: 9, openMinute: 0, closeHour: 15, closeMinute: 0, tradingDays: [1, 2, 3, 4, 5] },
  'JPX': { name: 'TSE', timezone: 'Asia/Tokyo', openHour: 9, openMinute: 0, closeHour: 15, closeMinute: 0, tradingDays: [1, 2, 3, 4, 5] },
  
  // London
  'LON': { name: 'LSE', timezone: 'Europe/London', openHour: 8, openMinute: 0, closeHour: 16, closeMinute: 30, tradingDays: [1, 2, 3, 4, 5] },
  'LSE': { name: 'LSE', timezone: 'Europe/London', openHour: 8, openMinute: 0, closeHour: 16, closeMinute: 30, tradingDays: [1, 2, 3, 4, 5] },
  
  // Frankfurt / Germany
  'FRA': { name: 'Frankfurt', timezone: 'Europe/Berlin', openHour: 9, openMinute: 0, closeHour: 17, closeMinute: 30, tradingDays: [1, 2, 3, 4, 5] },
  'GER': { name: 'Xetra', timezone: 'Europe/Berlin', openHour: 9, openMinute: 0, closeHour: 17, closeMinute: 30, tradingDays: [1, 2, 3, 4, 5] },
  
  // Paris
  'PAR': { name: 'Euronext Paris', timezone: 'Europe/Paris', openHour: 9, openMinute: 0, closeHour: 17, closeMinute: 30, tradingDays: [1, 2, 3, 4, 5] },
  
  // Shanghai
  'SHH': { name: 'SSE', timezone: 'Asia/Shanghai', openHour: 9, openMinute: 30, closeHour: 15, closeMinute: 0, tradingDays: [1, 2, 3, 4, 5] },
  'SHA': { name: 'SSE', timezone: 'Asia/Shanghai', openHour: 9, openMinute: 30, closeHour: 15, closeMinute: 0, tradingDays: [1, 2, 3, 4, 5] },
  
  // Shenzhen
  'SHZ': { name: 'SZSE', timezone: 'Asia/Shenzhen', openHour: 9, openMinute: 30, closeHour: 15, closeMinute: 0, tradingDays: [1, 2, 3, 4, 5] },
  
  // Toronto
  'TOR': { name: 'TSX', timezone: 'America/Toronto', openHour: 9, openMinute: 30, closeHour: 16, closeMinute: 0, tradingDays: [1, 2, 3, 4, 5] },
  'TSX': { name: 'TSX', timezone: 'America/Toronto', openHour: 9, openMinute: 30, closeHour: 16, closeMinute: 0, tradingDays: [1, 2, 3, 4, 5] },
  
  // Sydney
  'ASX': { name: 'ASX', timezone: 'Australia/Sydney', openHour: 10, openMinute: 0, closeHour: 16, closeMinute: 0, tradingDays: [1, 2, 3, 4, 5] },
  'AX': { name: 'ASX', timezone: 'Australia/Sydney', openHour: 10, openMinute: 0, closeHour: 16, closeMinute: 0, tradingDays: [1, 2, 3, 4, 5] },
  
  // Mumbai
  'NSI': { name: 'NSE India', timezone: 'Asia/Kolkata', openHour: 9, openMinute: 15, closeHour: 15, closeMinute: 30, tradingDays: [1, 2, 3, 4, 5] },
  'BOM': { name: 'BSE India', timezone: 'Asia/Kolkata', openHour: 9, openMinute: 15, closeHour: 15, closeMinute: 30, tradingDays: [1, 2, 3, 4, 5] },
  
  // Seoul
  'KSC': { name: 'KRX', timezone: 'Asia/Seoul', openHour: 9, openMinute: 0, closeHour: 15, closeMinute: 30, tradingDays: [1, 2, 3, 4, 5] },
  'KOE': { name: 'KRX', timezone: 'Asia/Seoul', openHour: 9, openMinute: 0, closeHour: 15, closeMinute: 30, tradingDays: [1, 2, 3, 4, 5] },
  
  // Singapore
  'SES': { name: 'SGX', timezone: 'Asia/Singapore', openHour: 9, openMinute: 0, closeHour: 17, closeMinute: 0, tradingDays: [1, 2, 3, 4, 5] },
  
  // Taiwan
  'TAI': { name: 'TWSE', timezone: 'Asia/Taipei', openHour: 9, openMinute: 0, closeHour: 13, closeMinute: 30, tradingDays: [1, 2, 3, 4, 5] },
  'TWO': { name: 'TPEx', timezone: 'Asia/Taipei', openHour: 9, openMinute: 0, closeHour: 13, closeMinute: 30, tradingDays: [1, 2, 3, 4, 5] },
};

// Fallback: use timezone to guess exchange config
function getConfigFromTimezone(timezone: string): ExchangeConfig | null {
  const timezoneToConfig: Record<string, ExchangeConfig> = {
    'America/New_York': { name: 'US Market', timezone: 'America/New_York', openHour: 9, openMinute: 30, closeHour: 16, closeMinute: 0, tradingDays: [1, 2, 3, 4, 5] },
    'Asia/Hong_Kong': { name: 'HKEX', timezone: 'Asia/Hong_Kong', openHour: 9, openMinute: 30, closeHour: 16, closeMinute: 0, tradingDays: [1, 2, 3, 4, 5] },
    'Asia/Tokyo': { name: 'TSE', timezone: 'Asia/Tokyo', openHour: 9, openMinute: 0, closeHour: 15, closeMinute: 0, tradingDays: [1, 2, 3, 4, 5] },
    'Europe/London': { name: 'LSE', timezone: 'Europe/London', openHour: 8, openMinute: 0, closeHour: 16, closeMinute: 30, tradingDays: [1, 2, 3, 4, 5] },
    'Europe/Berlin': { name: 'Xetra', timezone: 'Europe/Berlin', openHour: 9, openMinute: 0, closeHour: 17, closeMinute: 30, tradingDays: [1, 2, 3, 4, 5] },
    'Europe/Paris': { name: 'Euronext', timezone: 'Europe/Paris', openHour: 9, openMinute: 0, closeHour: 17, closeMinute: 30, tradingDays: [1, 2, 3, 4, 5] },
    'Asia/Shanghai': { name: 'SSE', timezone: 'Asia/Shanghai', openHour: 9, openMinute: 30, closeHour: 15, closeMinute: 0, tradingDays: [1, 2, 3, 4, 5] },
    'America/Toronto': { name: 'TSX', timezone: 'America/Toronto', openHour: 9, openMinute: 30, closeHour: 16, closeMinute: 0, tradingDays: [1, 2, 3, 4, 5] },
    'Australia/Sydney': { name: 'ASX', timezone: 'Australia/Sydney', openHour: 10, openMinute: 0, closeHour: 16, closeMinute: 0, tradingDays: [1, 2, 3, 4, 5] },
    'Asia/Kolkata': { name: 'NSE India', timezone: 'Asia/Kolkata', openHour: 9, openMinute: 15, closeHour: 15, closeMinute: 30, tradingDays: [1, 2, 3, 4, 5] },
    'Asia/Seoul': { name: 'KRX', timezone: 'Asia/Seoul', openHour: 9, openMinute: 0, closeHour: 15, closeMinute: 30, tradingDays: [1, 2, 3, 4, 5] },
    'Asia/Singapore': { name: 'SGX', timezone: 'Asia/Singapore', openHour: 9, openMinute: 0, closeHour: 17, closeMinute: 0, tradingDays: [1, 2, 3, 4, 5] },
    'Asia/Taipei': { name: 'TWSE', timezone: 'Asia/Taipei', openHour: 9, openMinute: 0, closeHour: 13, closeMinute: 30, tradingDays: [1, 2, 3, 4, 5] },
  };
  return timezoneToConfig[timezone] || null;
}

interface MarketStatusProps {
  exchange?: string;
  exchangeTimezone?: string;
  exchangeTimezoneShort?: string;
}

interface TimeInfo {
  localTime: string;
  exchangeTime: string;
  marketOpenLocal: string;
  marketOpenExchange: string;
  marketCloseLocal: string;
  marketCloseExchange: string;
  isOpen: boolean;
  isTradingDay: boolean;
  countdown: string;
  countdownLabel: string;
  exchangeName: string;
}

function formatTime(date: Date, options?: Intl.DateTimeFormatOptions): string {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...options,
  });
}

function getExchangeConfig(exchange?: string, timezone?: string): ExchangeConfig | null {
  // Try to get config by exchange code first
  if (exchange && EXCHANGE_CONFIG[exchange]) {
    return EXCHANGE_CONFIG[exchange];
  }
  
  // Fallback: try to get config from timezone
  if (timezone) {
    return getConfigFromTimezone(timezone);
  }
  
  return null;
}

function calculateTimeInfo(config: ExchangeConfig): TimeInfo {
  const now = new Date();
  
  // Get current time in exchange timezone
  const exchangeTimeStr = now.toLocaleString('en-US', { 
    timeZone: config.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  
  // Parse exchange day of week (0 = Sunday)
  const exchangeDate = new Date(now.toLocaleString('en-US', { timeZone: config.timezone }));
  const exchangeDayOfWeek = exchangeDate.getDay();
  
  // Check if it's a trading day
  const isTradingDay = config.tradingDays.includes(exchangeDayOfWeek);
  
  // Create market open/close times in exchange timezone for today
  const exchangeYear = exchangeDate.getFullYear();
  const exchangeMonth = exchangeDate.getMonth();
  const exchangeDay = exchangeDate.getDate();
  
  // Create a date string in the exchange timezone
  const marketOpenExchangeDate = new Date(
    `${exchangeYear}-${String(exchangeMonth + 1).padStart(2, '0')}-${String(exchangeDay).padStart(2, '0')}T${String(config.openHour).padStart(2, '0')}:${String(config.openMinute).padStart(2, '0')}:00`
  );
  const marketCloseExchangeDate = new Date(
    `${exchangeYear}-${String(exchangeMonth + 1).padStart(2, '0')}-${String(exchangeDay).padStart(2, '0')}T${String(config.closeHour).padStart(2, '0')}:${String(config.closeMinute).padStart(2, '0')}:00`
  );
  
  // Get the UTC offset for exchange timezone
  const exchangeOffset = getTimezoneOffset(config.timezone, marketOpenExchangeDate);
  const localOffset = now.getTimezoneOffset();
  
  // Convert exchange times to UTC, then to local
  const marketOpenUTC = new Date(marketOpenExchangeDate.getTime() + exchangeOffset * 60000);
  const marketCloseUTC = new Date(marketCloseExchangeDate.getTime() + exchangeOffset * 60000);
  
  // Convert to local time
  const marketOpenLocal = new Date(marketOpenUTC.getTime() - localOffset * 60000);
  const marketCloseLocal = new Date(marketCloseUTC.getTime() - localOffset * 60000);
  
  // Format times
  const localTime = formatTime(now);
  const marketOpenLocalStr = formatTime(marketOpenLocal);
  const marketCloseLocalStr = formatTime(marketCloseLocal);
  const marketOpenExchangeStr = `${String(config.openHour).padStart(2, '0')}:${String(config.openMinute).padStart(2, '0')}`;
  const marketCloseExchangeStr = `${String(config.closeHour).padStart(2, '0')}:${String(config.closeMinute).padStart(2, '0')}`;
  
  // Get current exchange time components
  const exchangeHour = parseInt(exchangeTimeStr.split(':')[0]);
  const exchangeMinute = parseInt(exchangeTimeStr.split(':')[1]);
  const currentExchangeMinutes = exchangeHour * 60 + exchangeMinute;
  const openMinutes = config.openHour * 60 + config.openMinute;
  const closeMinutes = config.closeHour * 60 + config.closeMinute;
  
  // Determine if market is open
  const isOpen = isTradingDay && currentExchangeMinutes >= openMinutes && currentExchangeMinutes < closeMinutes;
  
  // Calculate countdown
  let countdown = '';
  let countdownLabel = '';
  
  if (!isTradingDay) {
    // Calculate time until next trading day opens
    let daysUntilOpen = 1;
    let nextDay = (exchangeDayOfWeek + 1) % 7;
    while (!config.tradingDays.includes(nextDay)) {
      daysUntilOpen++;
      nextDay = (nextDay + 1) % 7;
    }
    
    // Minutes until midnight + open time on next trading day
    const minutesUntilMidnight = 24 * 60 - currentExchangeMinutes;
    const totalMinutes = minutesUntilMidnight + (daysUntilOpen - 1) * 24 * 60 + openMinutes;
    countdown = formatCountdown(totalMinutes);
    countdownLabel = 'until market opens';
  } else if (isOpen) {
    // Time until close
    const minutesUntilClose = closeMinutes - currentExchangeMinutes;
    countdown = formatCountdown(minutesUntilClose);
    countdownLabel = 'until market closes';
  } else if (currentExchangeMinutes < openMinutes) {
    // Before market open today
    const minutesUntilOpen = openMinutes - currentExchangeMinutes;
    countdown = formatCountdown(minutesUntilOpen);
    countdownLabel = 'until market opens';
  } else {
    // After market close today - calculate until next trading day
    let daysUntilOpen = 1;
    let nextDay = (exchangeDayOfWeek + 1) % 7;
    while (!config.tradingDays.includes(nextDay)) {
      daysUntilOpen++;
      nextDay = (nextDay + 1) % 7;
    }
    
    const minutesUntilMidnight = 24 * 60 - currentExchangeMinutes;
    const totalMinutes = minutesUntilMidnight + (daysUntilOpen - 1) * 24 * 60 + openMinutes;
    countdown = formatCountdown(totalMinutes);
    countdownLabel = 'until market opens';
  }
  
  return {
    localTime,
    exchangeTime: exchangeTimeStr,
    marketOpenLocal: marketOpenLocalStr,
    marketOpenExchange: marketOpenExchangeStr,
    marketCloseLocal: marketCloseLocalStr,
    marketCloseExchange: marketCloseExchangeStr,
    isOpen,
    isTradingDay,
    countdown,
    countdownLabel,
    exchangeName: config.name,
  };
}

function getTimezoneOffset(timezone: string, date: Date): number {
  const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
  const tzDate = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
  return (utcDate.getTime() - tzDate.getTime()) / 60000;
}

function formatCountdown(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours}h ${minutes}m`;
  }
  
  return `${hours}h ${minutes}m`;
}

export function MarketStatus({ exchange, exchangeTimezone }: MarketStatusProps) {
  const [timeInfo, setTimeInfo] = useState<TimeInfo | null>(null);
  const { t } = useTranslation();
  
  const config = getExchangeConfig(exchange, exchangeTimezone);
  
  const updateTimeInfo = useCallback(() => {
    if (config) {
      setTimeInfo(calculateTimeInfo(config));
    }
  }, [config]);
  
  useEffect(() => {
    if (!config) return;
    
    // Initial calculation
    updateTimeInfo();
    
    // Update every minute
    const interval = setInterval(updateTimeInfo, 60000);
    
    return () => clearInterval(interval);
  }, [config, updateTimeInfo]);
  
  if (!config || !timeInfo) {
    return null;
  }
  
  return (
    <div className="market-status">
      <div className="market-status-header">
        <h3>{t('marketStatus.marketHours')}</h3>
        <span className={`market-status-badge ${timeInfo.isOpen ? 'open' : 'closed'}`}>
          {timeInfo.isOpen ? t('marketStatus.open') : t('marketStatus.closed')}
        </span>
      </div>
      
      <div className="market-status-exchange">
        <span className="exchange-name">{timeInfo.exchangeName}</span>
      </div>
      
      <div className="market-status-times">
        <div className="time-row">
          <span className="time-label">{t('marketStatus.exchangeTime')}</span>
          <span className="time-value">{timeInfo.exchangeTime}</span>
        </div>
        
        <div className="time-row">
          <span className="time-label">{t('marketStatus.marketOpen')}</span>
          <span className="time-value">{timeInfo.marketOpenExchange}</span>
        </div>
        
        <div className="time-row">
          <span className="time-label">{t('marketStatus.marketClose')}</span>
          <span className="time-value">{timeInfo.marketCloseExchange}</span>
        </div>
      </div>
      
      <div className="market-status-countdown">
        <span className="countdown-value">{timeInfo.countdown}</span>
        <span className="countdown-label">{t(`marketStatus.${timeInfo.countdownLabel === 'until market opens' ? 'untilMarketOpens' : 'untilMarketCloses'}`)}</span>
      </div>
    </div>
  );
}
