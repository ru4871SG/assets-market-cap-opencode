import { useRef, useEffect, useMemo, useCallback, useState } from 'react';
import * as echarts from 'echarts';
import { useTranslation } from 'react-i18next';
import { PricePoint, ChartType, TechnicalIndicatorsConfig, HistoricalEvent } from '../types/asset';
import { PriceWithInventory } from '../services/inventoryApi';
import { PriceWithIndicators } from '../utils/technicalIndicators';

interface EChartsPriceChartProps {
  data: PricePoint[] | PriceWithInventory[] | PriceWithIndicators[];
  chartType: ChartType;
  events?: HistoricalEvent[];
  showInventoryOverlay?: boolean;
  indicatorsConfig?: TechnicalIndicatorsConfig;
  currency?: string;
}

// Theme colors - matching the CSS variables
const THEME_COLORS = {
  dark: {
    textSecondary: '#94a3b8',  // --text-secondary in dark mode
    textPrimary: '#f1f5f9',    // --text-primary in dark mode
    borderColor: '#334155',    // --border-color in dark mode
    cardBg: '#1e293b',         // --card-bg in dark mode
    bgSecondary: 'rgba(0, 0, 0, 0.2)',
  },
  light: {
    textSecondary: '#64748b',  // --text-secondary in light mode
    textPrimary: '#1e293b',    // --text-primary in light mode
    borderColor: '#e2e8f0',    // --border-color in light mode
    cardBg: '#ffffff',         // --card-bg in light mode
    bgSecondary: 'rgba(0, 0, 0, 0.05)',
  },
};

// Default zoom: 278% means showing ~7.2% of data (20% / 2.78 ≈ 7.2%)
// So zoomEnd - zoomStart should be ~7.2, meaning start at ~92.8
const DEFAULT_ZOOM_START = 92.8;  // 100 - (20 / 2.78) ≈ 92.8
const DEFAULT_ZOOM_END = 100;
const DEFAULT_ZOOM_RANGE = DEFAULT_ZOOM_END - DEFAULT_ZOOM_START; // ~7.2%

// Format price with currency
function formatPriceWithCurrency(value: number, currency: string): string {
  if (currency === 'USD') {
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
  // Non-USD currencies
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

// Format inventory total
function formatInventoryTotal(value: number): string {
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(2)}B oz`;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M oz`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K oz`;
  }
  return `${value.toLocaleString()} oz`;
}

// Get current theme
function getThemeColors() {
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  return isDark ? THEME_COLORS.dark : THEME_COLORS.light;
}

export function EChartsPriceChart({
  data,
  chartType,
  events = [],
  showInventoryOverlay = false,
  indicatorsConfig,
  currency = 'USD',
}: EChartsPriceChartProps) {
  const { t, i18n } = useTranslation();
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<echarts.ECharts | null>(null);
  
  // Zoom state - default to 278% zoom (showing ~7.2% of data, anchored to right)
  const [zoomStart, setZoomStart] = useState(DEFAULT_ZOOM_START);
  const [zoomEnd, setZoomEnd] = useState(DEFAULT_ZOOM_END);
  
  // Theme state
  const [themeColors, setThemeColors] = useState(getThemeColors);

  // Get locale for date formatting
  const locale = useMemo(() => {
    return i18n.language === 'es' ? 'es-ES' : i18n.language === 'pt' ? 'pt-BR' : 'en-US';
  }, [i18n.language]);

  // Determine chart color based on price trend
  const chartColor = useMemo(() => {
    if (!data || data.length < 2) return '#00c853';
    const firstPrice = data[0]?.price || 0;
    const lastPrice = data[data.length - 1]?.price || 0;
    return lastPrice >= firstPrice ? '#00c853' : '#ff5252';
  }, [data]);

  // Process data for ECharts
  const { categoryData, priceData, ohlcData, inventoryData, ma1Data, ma2Data, bbUpperData, bbMiddleData, bbLowerData } = useMemo(() => {
    const categories: string[] = [];
    const prices: number[] = [];
    const ohlc: number[][] = []; // [open, close, low, high] - ECharts candlestick format
    const inventory: (number | null)[] = [];
    const ma1: (number | null)[] = [];
    const ma2: (number | null)[] = [];
    const bbUpper: (number | null)[] = [];
    const bbMiddle: (number | null)[] = [];
    const bbLower: (number | null)[] = [];

    data.forEach((point) => {
      // Format date for display
      const hasTime = point.date.includes(' ') && point.date.split(' ').length > 1;
      let dateLabel: string;
      if (hasTime) {
        const date = new Date(point.date);
        dateLabel = date.toLocaleDateString(locale, { month: 'short', day: 'numeric' }) +
          ' ' + date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
      } else {
        const [year, month, day] = point.date.split('-').map(Number);
        const date = new Date(year, month - 1, day);
        dateLabel = date.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' });
      }
      categories.push(dateLabel);

      // Price data for line chart
      prices.push(point.price);

      // OHLC data - ECharts candlestick format: [open, close, low, high]
      const open = point.open ?? point.price;
      const close = point.price;
      const low = point.low ?? point.price;
      const high = point.high ?? point.price;
      ohlc.push([open, close, low, high]);

      // Inventory data
      const pointWithInventory = point as PriceWithInventory;
      inventory.push(pointWithInventory.inventoryTotal ?? null);

      // Technical indicators
      const pointWithIndicators = point as PriceWithIndicators;
      ma1.push(pointWithIndicators.ma1 ?? null);
      ma2.push(pointWithIndicators.ma2 ?? null);
      bbUpper.push(pointWithIndicators.bbUpper ?? null);
      bbMiddle.push(pointWithIndicators.bbMiddle ?? null);
      bbLower.push(pointWithIndicators.bbLower ?? null);
    });

    return {
      categoryData: categories,
      priceData: prices,
      ohlcData: ohlc,
      inventoryData: inventory,
      ma1Data: ma1,
      ma2Data: ma2,
      bbUpperData: bbUpper,
      bbMiddleData: bbMiddle,
      bbLowerData: bbLower,
    };
  }, [data, locale]);

  // Check if we have inventory data to show
  const hasInventoryData = useMemo(() => {
    return showInventoryOverlay && inventoryData.some((v) => v !== null);
  }, [showInventoryOverlay, inventoryData]);

  // Check if we have OHLC data
  const hasOHLCData = useMemo(() => {
    return data.some(d => d.open !== undefined && d.high !== undefined && d.low !== undefined);
  }, [data]);

  // Effective chart type (fallback to line if no OHLC data)
  const effectiveChartType = hasOHLCData ? chartType : 'line';

  // Process events for mark areas
  const markAreaData = useMemo(() => {
    if (!events.length || !categoryData.length) return [];

    return events
      .map((event) => {
        const eventStart = new Date(event.start_date).getTime();
        const eventEnd = new Date(event.end_date).getTime() + 86400000;

        // Find indices that fall within the event range
        let startIdx = -1;
        let endIdx = -1;

        data.forEach((point, idx) => {
          const pointDate = point.date.split(' ')[0];
          const pointTime = new Date(pointDate).getTime();

          if (pointTime >= eventStart && pointTime <= eventEnd) {
            if (startIdx === -1) startIdx = idx;
            endIdx = idx;
          }
        });

        if (startIdx === -1 || endIdx === -1) return null;

        return [
          {
            name: event.title,
            xAxis: categoryData[startIdx],
            itemStyle: {
              color: event.category_info.color,
              opacity: 0.15,
            },
            label: {
              show: false,
            },
          },
          {
            xAxis: categoryData[endIdx],
          },
        ];
      })
      .filter(Boolean);
  }, [events, categoryData, data]);

  // Build ECharts option
  const getOption = useCallback((): echarts.EChartsOption => {
    const series: echarts.SeriesOption[] = [];
    const yAxisConfigs: echarts.YAXisComponentOption[] = [];
    const colors = themeColors;

    // Colors
    const upColor = '#00c853';
    const downColor = '#ff5252';
    const inventoryColor = '#9c27b0';

    // Price Y-axis
    yAxisConfigs.push({
      type: 'value',
      position: 'left',
      scale: true,
      splitLine: {
        show: true,
        lineStyle: {
          color: colors.borderColor,
          type: 'dashed',
        },
      },
      axisLine: {
        show: true,
        lineStyle: {
          color: colors.borderColor,
        },
      },
      axisLabel: {
        color: colors.textSecondary,
        fontSize: 11,
        formatter: (value: number) => formatPriceWithCurrency(value, currency),
      },
      axisTick: {
        show: true,
        lineStyle: {
          color: colors.borderColor,
        },
      },
    });

    // Main price series based on chart type
    if (effectiveChartType === 'line') {
      // Line chart with area fill
      series.push({
        name: 'Price',
        type: 'line',
        data: priceData,
        yAxisIndex: 0,
        smooth: false,
        symbol: 'none',
        lineStyle: {
          color: chartColor,
          width: 2,
        },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: chartColor + '4D' },  // 30% opacity
            { offset: 1, color: chartColor + '00' },  // 0% opacity
          ]),
        },
        markArea: markAreaData.length > 0 ? {
          silent: true,
          data: markAreaData as any,
        } : undefined,
      });
    } else {
      // OHLC or Candlestick
      const isOHLC = effectiveChartType === 'ohlc';
      
      series.push({
        name: 'Price',
        type: 'candlestick',
        data: ohlcData,
        yAxisIndex: 0,
        itemStyle: {
          color: isOHLC ? 'transparent' : upColor,
          color0: isOHLC ? 'transparent' : downColor,
          borderColor: upColor,
          borderColor0: downColor,
          borderWidth: isOHLC ? 2 : 1,
        },
        barWidth: isOHLC ? '20%' : '60%',
        barMinWidth: isOHLC ? 1 : 4,
        barMaxWidth: isOHLC ? 4 : 30,
        markArea: markAreaData.length > 0 ? {
          silent: true,
          data: markAreaData as any,
        } : undefined,
      });
    }

    // Moving Average 1
    if (indicatorsConfig?.movingAverage1.enabled) {
      series.push({
        name: `${indicatorsConfig.movingAverage1.type} ${indicatorsConfig.movingAverage1.period}`,
        type: 'line',
        data: ma1Data,
        yAxisIndex: 0,
        smooth: true,
        symbol: 'none',
        lineStyle: {
          color: indicatorsConfig.movingAverage1.color,
          width: 1.5,
        },
      });
    }

    // Moving Average 2
    if (indicatorsConfig?.movingAverage2.enabled) {
      series.push({
        name: `${indicatorsConfig.movingAverage2.type} ${indicatorsConfig.movingAverage2.period}`,
        type: 'line',
        data: ma2Data,
        yAxisIndex: 0,
        smooth: true,
        symbol: 'none',
        lineStyle: {
          color: indicatorsConfig.movingAverage2.color,
          width: 1.5,
        },
      });
    }

    // Bollinger Bands
    if (indicatorsConfig?.bollingerBands.enabled) {
      series.push({
        name: 'BB Upper',
        type: 'line',
        data: bbUpperData,
        yAxisIndex: 0,
        smooth: true,
        symbol: 'none',
        lineStyle: {
          color: indicatorsConfig.bollingerBands.color,
          width: 1,
          type: 'dashed',
        },
      });
      series.push({
        name: 'BB Middle',
        type: 'line',
        data: bbMiddleData,
        yAxisIndex: 0,
        smooth: true,
        symbol: 'none',
        lineStyle: {
          color: indicatorsConfig.bollingerBands.color,
          width: 1,
          opacity: 0.5,
        },
      });
      series.push({
        name: 'BB Lower',
        type: 'line',
        data: bbLowerData,
        yAxisIndex: 0,
        smooth: true,
        symbol: 'none',
        lineStyle: {
          color: indicatorsConfig.bollingerBands.color,
          width: 1,
          type: 'dashed',
        },
      });
    }

    // Inventory overlay
    if (hasInventoryData) {
      yAxisConfigs.push({
        type: 'value',
        position: 'right',
        scale: true,
        splitLine: {
          show: false,
        },
        axisLine: {
          show: true,
          lineStyle: {
            color: inventoryColor,
          },
        },
        axisLabel: {
          color: inventoryColor,
          fontSize: 10,
          formatter: (value: number) => {
            if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
            if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
            return value.toLocaleString();
          },
        },
        axisTick: {
          show: true,
          lineStyle: {
            color: inventoryColor,
          },
        },
      });

      series.push({
        name: t('priceChart.inventoryLabel'),
        type: 'line',
        data: inventoryData,
        yAxisIndex: 1,
        smooth: true,
        symbol: 'none',
        lineStyle: {
          color: inventoryColor,
          width: 2,
        },
        connectNulls: true,
      });
    }

    return {
      backgroundColor: 'transparent',
      animation: false,
      grid: {
        left: 80,
        right: hasInventoryData ? 70 : 20,
        top: 20,
        bottom: 80,
        containLabel: false,
      },
      xAxis: {
        type: 'category',
        data: categoryData,
        axisLine: {
          lineStyle: {
            color: colors.borderColor,
          },
        },
        axisLabel: {
          color: colors.textSecondary,
          fontSize: 11,
          rotate: 0,
          hideOverlap: true,
        },
        axisTick: {
          lineStyle: {
            color: colors.borderColor,
          },
        },
        splitLine: {
          show: false,
        },
      },
      yAxis: yAxisConfigs,
      series,
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'cross',
          crossStyle: {
            color: colors.textSecondary,
          },
          lineStyle: {
            color: colors.textSecondary,
            type: 'dashed',
          },
        },
        backgroundColor: colors.cardBg,
        borderColor: colors.borderColor,
        textStyle: {
          color: colors.textPrimary,
          fontSize: 12,
        },
        formatter: (params: any) => {
          if (!Array.isArray(params) || params.length === 0) return '';

          const idx = params[0].dataIndex;
          const point = data[idx];
          const dateStr = categoryData[idx];

          let html = `<div style="font-family: system-ui, -apple-system, sans-serif;">`;
          html += `<div style="color: ${colors.textSecondary}; font-size: 12px; margin-bottom: 8px;">${dateStr}</div>`;

          if (effectiveChartType === 'line') {
            // Line chart tooltip - simple price display
            html += `<div style="font-family: 'SF Mono', Monaco, monospace; font-size: 16px; font-weight: 600; color: ${colors.textPrimary};">`;
            html += formatPriceWithCurrency(point.price, currency);
            html += `</div>`;
            
            // Show high/low if available
            if (point.high && point.low) {
              html += `<div style="font-size: 11px; color: ${colors.textSecondary}; margin-top: 4px; font-family: 'SF Mono', Monaco, monospace;">`;
              html += `${t('priceChart.high')}: ${formatPriceWithCurrency(point.high, currency)} / ${t('priceChart.low')}: ${formatPriceWithCurrency(point.low, currency)}`;
              html += `</div>`;
            }
          } else {
            // OHLC/Candlestick tooltip
            const ohlc = ohlcData[idx];
            const open = ohlc[0];
            const close = ohlc[1];
            const low = ohlc[2];
            const high = ohlc[3];

            html += `<div style="display: grid; grid-template-columns: 50px 1fr; gap: 4px; font-family: 'SF Mono', Monaco, monospace;">`;
            html += `<span style="color: ${colors.textSecondary};">${t('priceChart.open')}:</span><span style="color: ${colors.textPrimary};">${formatPriceWithCurrency(open, currency)}</span>`;
            html += `<span style="color: ${colors.textSecondary};">${t('priceChart.high')}:</span><span style="color: ${upColor};">${formatPriceWithCurrency(high, currency)}</span>`;
            html += `<span style="color: ${colors.textSecondary};">${t('priceChart.low')}:</span><span style="color: ${downColor};">${formatPriceWithCurrency(low, currency)}</span>`;
            html += `<span style="color: ${colors.textSecondary};">${t('priceChart.close')}:</span><span style="color: ${colors.textPrimary};">${formatPriceWithCurrency(close, currency)}</span>`;
            html += `</div>`;
          }

          // Technical indicators
          if (indicatorsConfig) {
            const pointWithIndicators = point as PriceWithIndicators;
            let hasIndicator = false;
            let indicatorHtml = `<div style="margin-top: 8px; padding-top: 8px; border-top: 1px dashed ${colors.borderColor}; font-size: 11px;">`;

            if (indicatorsConfig.movingAverage1.enabled && pointWithIndicators.ma1 !== undefined) {
              hasIndicator = true;
              indicatorHtml += `<div style="display: flex; align-items: center; gap: 6px; margin-bottom: 2px;">`;
              indicatorHtml += `<span style="width: 8px; height: 8px; border-radius: 50%; background: ${indicatorsConfig.movingAverage1.color};"></span>`;
              indicatorHtml += `<span style="color: ${colors.textSecondary};">${indicatorsConfig.movingAverage1.type} ${indicatorsConfig.movingAverage1.period}:</span>`;
              indicatorHtml += `<span style="margin-left: auto; font-family: 'SF Mono', Monaco, monospace; color: ${colors.textPrimary};">${formatPriceWithCurrency(pointWithIndicators.ma1, currency)}</span>`;
              indicatorHtml += `</div>`;
            }

            if (indicatorsConfig.movingAverage2.enabled && pointWithIndicators.ma2 !== undefined) {
              hasIndicator = true;
              indicatorHtml += `<div style="display: flex; align-items: center; gap: 6px; margin-bottom: 2px;">`;
              indicatorHtml += `<span style="width: 8px; height: 8px; border-radius: 50%; background: ${indicatorsConfig.movingAverage2.color};"></span>`;
              indicatorHtml += `<span style="color: ${colors.textSecondary};">${indicatorsConfig.movingAverage2.type} ${indicatorsConfig.movingAverage2.period}:</span>`;
              indicatorHtml += `<span style="margin-left: auto; font-family: 'SF Mono', Monaco, monospace; color: ${colors.textPrimary};">${formatPriceWithCurrency(pointWithIndicators.ma2, currency)}</span>`;
              indicatorHtml += `</div>`;
            }

            if (indicatorsConfig.bollingerBands.enabled && pointWithIndicators.bbMiddle !== undefined) {
              hasIndicator = true;
              indicatorHtml += `<div style="display: flex; align-items: center; gap: 6px;">`;
              indicatorHtml += `<span style="width: 8px; height: 8px; border-radius: 2px; background: ${indicatorsConfig.bollingerBands.color}; opacity: 0.6;"></span>`;
              indicatorHtml += `<span style="color: ${colors.textSecondary};">BB (${indicatorsConfig.bollingerBands.period}, ${indicatorsConfig.bollingerBands.standardDeviations}):</span>`;
              indicatorHtml += `</div>`;
              if (pointWithIndicators.bbUpper !== undefined) {
                indicatorHtml += `<div style="margin-left: 14px; font-size: 10px; color: ${colors.textSecondary}; font-family: 'SF Mono', Monaco, monospace;">Upper: ${formatPriceWithCurrency(pointWithIndicators.bbUpper, currency)}</div>`;
              }
              indicatorHtml += `<div style="margin-left: 14px; font-size: 10px; color: ${colors.textSecondary}; font-family: 'SF Mono', Monaco, monospace;">Middle: ${formatPriceWithCurrency(pointWithIndicators.bbMiddle, currency)}</div>`;
              if (pointWithIndicators.bbLower !== undefined) {
                indicatorHtml += `<div style="margin-left: 14px; font-size: 10px; color: ${colors.textSecondary}; font-family: 'SF Mono', Monaco, monospace;">Lower: ${formatPriceWithCurrency(pointWithIndicators.bbLower, currency)}</div>`;
              }
            }

            indicatorHtml += `</div>`;
            if (hasIndicator) html += indicatorHtml;
          }

          // Inventory
          if (hasInventoryData) {
            const pointWithInventory = point as PriceWithInventory;
            if (pointWithInventory.inventoryTotal !== undefined) {
              html += `<div style="margin-top: 6px; padding-top: 6px; border-top: 1px dashed ${colors.borderColor}; font-size: 12px; font-family: 'SF Mono', Monaco, monospace; color: ${colors.textPrimary};">`;
              html += `${t('priceChart.inventoryTotal')}: ${formatInventoryTotal(pointWithInventory.inventoryTotal)}`;
              html += `</div>`;
            }
          }

          html += `</div>`;
          return html;
        },
      },
      dataZoom: [
        {
          type: 'inside',
          xAxisIndex: 0,
          start: zoomStart,
          end: zoomEnd,
          minSpan: 2,
        },
        {
          type: 'slider',
          xAxisIndex: 0,
          start: zoomStart,
          end: zoomEnd,
          height: 20,
          bottom: 30,
          borderColor: colors.borderColor,
          backgroundColor: colors.bgSecondary,
          fillerColor: 'rgba(100, 100, 100, 0.2)',
          handleStyle: {
            color: colors.textSecondary,
          },
          textStyle: {
            color: colors.textSecondary,
            fontSize: 10,
          },
          dataBackground: {
            lineStyle: {
              color: colors.textSecondary,
              opacity: 0.3,
            },
            areaStyle: {
              color: colors.textSecondary,
              opacity: 0.1,
            },
          },
          brushSelect: false,
        },
      ],
    };
  }, [
    categoryData,
    priceData,
    ohlcData,
    inventoryData,
    ma1Data,
    ma2Data,
    bbUpperData,
    bbMiddleData,
    bbLowerData,
    hasInventoryData,
    indicatorsConfig,
    markAreaData,
    effectiveChartType,
    chartColor,
    currency,
    t,
    data,
    zoomStart,
    zoomEnd,
    themeColors,
  ]);

  // Zoom handlers - always anchor to the right (most recent data)
  const handleZoomIn = useCallback(() => {
    const range = zoomEnd - zoomStart;
    const newRange = Math.max(range * 0.7, 2); // Zoom in by 30%, min 2% range
    // Anchor to right - keep zoomEnd at 100
    const newStart = Math.max(0, 100 - newRange);
    setZoomStart(newStart);
    setZoomEnd(100);
  }, [zoomStart, zoomEnd]);

  const handleZoomOut = useCallback(() => {
    const range = zoomEnd - zoomStart;
    const newRange = Math.min(range * 1.5, 100); // Zoom out by 50%, max 100% range
    // Anchor to right - keep zoomEnd at 100
    const newStart = Math.max(0, 100 - newRange);
    setZoomStart(newStart);
    setZoomEnd(100);
  }, [zoomStart, zoomEnd]);

  const handleResetZoom = useCallback(() => {
    setZoomStart(DEFAULT_ZOOM_START);
    setZoomEnd(DEFAULT_ZOOM_END);
  }, []);

  // Calculate zoom percentage for display
  // Default is 278% (showing ~7.2% of data)
  const zoomPercentage = useMemo(() => {
    const currentRange = zoomEnd - zoomStart;
    // 278% corresponds to DEFAULT_ZOOM_RANGE (~7.2%)
    return Math.round((DEFAULT_ZOOM_RANGE / currentRange) * 278);
  }, [zoomStart, zoomEnd]);

  // Initialize chart
  useEffect(() => {
    if (!chartRef.current) return;

    chartInstance.current = echarts.init(chartRef.current);
    chartInstance.current.setOption(getOption());

    // Handle resize
    const handleResize = () => {
      chartInstance.current?.resize();
    };
    window.addEventListener('resize', handleResize);

    // Handle zoom events from chart interaction
    chartInstance.current.on('dataZoom', (params: any) => {
      if (params.start !== undefined && params.end !== undefined) {
        setZoomStart(params.start);
        setZoomEnd(params.end);
      } else if (params.batch?.[0]) {
        setZoomStart(params.batch[0].start);
        setZoomEnd(params.batch[0].end);
      }
    });

    // Watch for theme changes
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme') {
          setThemeColors(getThemeColors());
        }
      });
    });
    
    observer.observe(document.documentElement, { attributes: true });

    return () => {
      window.removeEventListener('resize', handleResize);
      observer.disconnect();
      chartInstance.current?.dispose();
      chartInstance.current = null;
    };
  }, []);

  // Update chart when options change
  useEffect(() => {
    if (chartInstance.current) {
      chartInstance.current.setOption(getOption(), true);
    }
  }, [getOption]);

  // Reset zoom when data changes significantly - anchor to right
  useEffect(() => {
    setZoomStart(DEFAULT_ZOOM_START);
    setZoomEnd(DEFAULT_ZOOM_END);
  }, [data.length]);

  return (
    <div style={{ position: 'relative' }}>
      <div
        ref={chartRef}
        style={{
          width: '100%',
          height: '350px',
        }}
      />
      
      {/* Zoom controls */}
      <div className="chart-zoom-controls">
        <button
          className="chart-zoom-btn"
          onClick={handleZoomOut}
          disabled={zoomEnd - zoomStart >= 95}
          title={t('priceChart.zoomOut')}
          aria-label={t('priceChart.zoomOut')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
            <line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </button>
        
        {/* Show zoom percentage when not at default (278%) */}
        {zoomPercentage !== 278 && (
          <button
            className="chart-zoom-btn chart-zoom-reset"
            onClick={handleResetZoom}
            title={t('priceChart.resetZoom')}
            aria-label={t('priceChart.resetZoom')}
          >
            <span className="zoom-level">{zoomPercentage}%</span>
          </button>
        )}
        
        <button
          className="chart-zoom-btn"
          onClick={handleZoomIn}
          disabled={zoomEnd - zoomStart <= 2}
          title={t('priceChart.zoomIn')}
          aria-label={t('priceChart.zoomIn')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
            <line x1="11" y1="8" x2="11" y2="14" />
            <line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </button>
      </div>
    </div>
  );
}
