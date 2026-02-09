import { useState, useEffect, useMemo } from 'react';
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
} from 'recharts';
import { useTranslation } from 'react-i18next';
import { InventoryDataPoint, InventoryMetadata } from '../types/asset';
import { fetchMetalInventory, hasInventoryData } from '../services/inventoryApi';
import './InventoryChart.css';

interface InventoryChartProps {
  symbol: string;
  metalName: string;
}

// 0 means "All" - no filtering, return all data
type TimeRangeOption = 30 | 90 | 180 | 365 | 0;

function formatNumber(value: number): string {
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(2)}B`;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return value.toLocaleString();
}

function formatFullNumber(value: number): string {
  return value.toLocaleString('en-US');
}

function formatDateTick(dateStr: string, locale: string = 'en-US'): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    value: number;
    dataKey: string;
    color: string;
    payload: InventoryDataPoint;
  }>;
  label?: string;
  unit: string;
}

function CustomTooltip({ active, payload, unit }: CustomTooltipProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'es' ? 'es-ES' : i18n.language === 'pt' ? 'pt-BR' : 'en-US';

  if (active && payload && payload.length > 0) {
    const data = payload[0].payload;
    const date = new Date(data.date);

    return (
      <div className="inventory-tooltip">
        <p className="tooltip-date">
          {date.toLocaleDateString(locale, {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}
        </p>
        <div className="tooltip-values">
          <p className="tooltip-total">
            <span className="tooltip-label">{t('inventory.total')}:</span>
            <span className="tooltip-value">{formatFullNumber(data.total)} {unit}</span>
          </p>
        </div>
      </div>
    );
  }
  return null;
}

export function InventoryChart({ symbol, metalName }: InventoryChartProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'es' ? 'es-ES' : i18n.language === 'pt' ? 'pt-BR' : 'en-US';

  const [data, setData] = useState<InventoryDataPoint[]>([]);
  const [metadata, setMetadata] = useState<InventoryMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRangeOption>(0); // Default to "All"

  // Check if this metal supports inventory data
  const supportsInventory = hasInventoryData(symbol);

  useEffect(() => {
    if (!supportsInventory) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    fetchMetalInventory(symbol, timeRange)
      .then((response) => {
        setData(response.data);
        setMetadata(response.metadata);
      })
      .catch((err) => {
        console.error('Error fetching inventory data:', err);
        setError(err.message || 'Failed to load inventory data');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [symbol, timeRange, supportsInventory]);

  // Calculate change metrics
  const changeMetrics = useMemo(() => {
    if (data.length < 2) return null;

    const firstPoint = data[0];
    const lastPoint = data[data.length - 1];
    const change = lastPoint.total - firstPoint.total;
    const changePercent = (change / firstPoint.total) * 100;

    return {
      change,
      changePercent,
      isPositive: change >= 0,
    };
  }, [data]);

  // Don't render if metal doesn't support inventory
  if (!supportsInventory) {
    return null;
  }

  if (loading) {
    return (
      <div className="inventory-chart-container">
        <div className="inventory-chart-header">
          <h3>{t('inventory.title', { metal: metalName })}</h3>
        </div>
        <div className="inventory-chart-loading">
          <div className="loading-spinner"></div>
          <p>{t('inventory.loading')}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="inventory-chart-container">
        <div className="inventory-chart-header">
          <h3>{t('inventory.title', { metal: metalName })}</h3>
        </div>
        <div className="inventory-chart-error">
          <p>{t('inventory.error')}</p>
          <p className="error-detail">{error}</p>
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="inventory-chart-container">
        <div className="inventory-chart-header">
          <h3>{t('inventory.title', { metal: metalName })}</h3>
        </div>
        <div className="inventory-chart-error">
          <p>{t('inventory.noData')}</p>
        </div>
      </div>
    );
  }

  // Calculate Y-axis domain
  const allValues = data.map((d) => d.total);
  const minValue = Math.min(...allValues);
  const maxValue = Math.max(...allValues);
  const padding = (maxValue - minValue) * 0.1;

  // Determine chart colors based on trend
  const trendColor = changeMetrics?.isPositive ? '#00c853' : '#ff5252';

  const unit = metadata?.unit === 'troy_ounces' ? 'oz' : metadata?.unit || 'oz';

  return (
    <div className="inventory-chart-container">
      <div className="inventory-chart-header">
        <div className="inventory-title-row">
          <h3>{t('inventory.title', { metal: metalName })}</h3>
          {changeMetrics && (
            <div className={`inventory-change ${changeMetrics.isPositive ? 'positive' : 'negative'}`}>
              {changeMetrics.isPositive ? '+' : ''}
              {formatNumber(changeMetrics.change)} oz ({changeMetrics.changePercent.toFixed(2)}%)
            </div>
          )}
        </div>
        <div className="inventory-time-range">
          {([30, 90, 180, 365, 0] as TimeRangeOption[]).map((range) => (
            <button
              key={range}
              className={`time-range-btn ${timeRange === range ? 'active' : ''}`}
              onClick={() => setTimeRange(range)}
            >
              {range === 0 ? 'All' : range === 365 ? '1Y' : `${range}D`}
            </button>
          ))}
        </div>
      </div>

      {metadata && (
        <div className="inventory-metadata">
          <p className="inventory-source">
            {t('inventory.source')}: {metadata.source}
          </p>
          <p className="inventory-updated">
            {t('inventory.lastUpdated')}: {new Date(metadata.last_updated).toLocaleDateString(locale, {
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            })}
          </p>
        </div>
      )}

      <div className="inventory-chart-wrapper">
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={data} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
            <defs>
              <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={trendColor} stopOpacity={0.3} />
                <stop offset="95%" stopColor={trendColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(value) => formatDateTick(value, locale)}
              tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
              axisLine={{ stroke: 'var(--border-color)' }}
              tickLine={{ stroke: 'var(--border-color)' }}
              interval="preserveStartEnd"
              minTickGap={50}
            />
            <YAxis
              domain={[minValue - padding, maxValue + padding]}
              tickFormatter={(value) => formatNumber(value)}
              tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
              axisLine={{ stroke: 'var(--border-color)' }}
              tickLine={{ stroke: 'var(--border-color)' }}
              width={70}
            />
            <Tooltip content={<CustomTooltip unit={unit} />} />
            <Area
              type="monotone"
              dataKey="total"
              name={t('inventory.total')}
              stroke={trendColor}
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#colorTotal)"
              dot={false}
              activeDot={{ r: 5, strokeWidth: 2, stroke: trendColor, fill: 'var(--card-bg)' }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {metadata && (
        <div className="inventory-description">
          <p>{metadata.description}</p>
          <p className="inventory-notes">{metadata.notes}</p>
        </div>
      )}
    </div>
  );
}
