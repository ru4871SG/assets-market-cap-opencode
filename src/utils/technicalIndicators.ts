import { PricePoint, MovingAverageType, TechnicalIndicatorsConfig, IndicatorDataPoint } from '../types/asset';

/**
 * Calculate Simple Moving Average (SMA)
 * SMA = Sum of closing prices over N periods / N
 */
export function calculateSMA(prices: number[], period: number): (number | undefined)[] {
  const result: (number | undefined)[] = [];
  
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      // Not enough data points yet
      result.push(undefined);
    } else {
      // Calculate average of last 'period' prices
      let sum = 0;
      for (let j = 0; j < period; j++) {
        sum += prices[i - j];
      }
      result.push(sum / period);
    }
  }
  
  return result;
}

/**
 * Calculate Exponential Moving Average (EMA)
 * EMA = Price(t) × k + EMA(y) × (1 − k)
 * where k = 2 / (N + 1), and EMA(y) is the EMA of yesterday
 * 
 * The first EMA value is typically seeded with the SMA of the first 'period' prices
 */
export function calculateEMA(prices: number[], period: number): (number | undefined)[] {
  const result: (number | undefined)[] = [];
  const multiplier = 2 / (period + 1);
  
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      // Not enough data points yet
      result.push(undefined);
    } else if (i === period - 1) {
      // First EMA is seeded with SMA
      let sum = 0;
      for (let j = 0; j < period; j++) {
        sum += prices[i - j];
      }
      result.push(sum / period);
    } else {
      // EMA = Price(t) × k + EMA(y) × (1 − k)
      const previousEMA = result[i - 1];
      if (previousEMA !== undefined) {
        const ema = prices[i] * multiplier + previousEMA * (1 - multiplier);
        result.push(ema);
      } else {
        result.push(undefined);
      }
    }
  }
  
  return result;
}

/**
 * Calculate Moving Average based on type
 */
export function calculateMA(prices: number[], period: number, type: MovingAverageType): (number | undefined)[] {
  if (type === 'SMA') {
    return calculateSMA(prices, period);
  }
  return calculateEMA(prices, period);
}

/**
 * Calculate Standard Deviation for a set of values
 */
function calculateStandardDeviation(values: number[]): number {
  const n = values.length;
  if (n === 0) return 0;
  
  const mean = values.reduce((sum, val) => sum + val, 0) / n;
  const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
  const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / n;
  
  return Math.sqrt(variance);
}

/**
 * Calculate Bollinger Bands
 * - Middle Band = SMA(period)
 * - Upper Band = SMA + (Standard Deviation × multiplier)
 * - Lower Band = SMA - (Standard Deviation × multiplier)
 */
export function calculateBollingerBands(
  prices: number[], 
  period: number, 
  standardDeviations: number
): { upper: (number | undefined)[]; middle: (number | undefined)[]; lower: (number | undefined)[] } {
  const middle = calculateSMA(prices, period);
  const upper: (number | undefined)[] = [];
  const lower: (number | undefined)[] = [];
  
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1 || middle[i] === undefined) {
      upper.push(undefined);
      lower.push(undefined);
    } else {
      // Get the last 'period' prices for standard deviation calculation
      const slice = prices.slice(i - period + 1, i + 1);
      const stdDev = calculateStandardDeviation(slice);
      const middleValue = middle[i] as number;
      
      upper.push(middleValue + stdDev * standardDeviations);
      lower.push(middleValue - stdDev * standardDeviations);
    }
  }
  
  return { upper, middle, lower };
}

/**
 * Calculate all enabled technical indicators and merge with price data
 */
export function calculateIndicators(
  data: PricePoint[],
  config: TechnicalIndicatorsConfig
): IndicatorDataPoint[] {
  if (!data || data.length === 0) {
    return [];
  }
  
  const prices = data.map(d => d.price);
  
  // Calculate Moving Averages
  let ma1Values: (number | undefined)[] = [];
  let ma2Values: (number | undefined)[] = [];
  
  if (config.movingAverage1.enabled) {
    ma1Values = calculateMA(prices, config.movingAverage1.period, config.movingAverage1.type);
  }
  
  if (config.movingAverage2.enabled) {
    ma2Values = calculateMA(prices, config.movingAverage2.period, config.movingAverage2.type);
  }
  
  // Calculate Bollinger Bands
  let bbValues: { upper: (number | undefined)[]; middle: (number | undefined)[]; lower: (number | undefined)[] } = {
    upper: [],
    middle: [],
    lower: [],
  };
  
  if (config.bollingerBands.enabled) {
    bbValues = calculateBollingerBands(
      prices,
      config.bollingerBands.period,
      config.bollingerBands.standardDeviations
    );
  }
  
  // Merge all indicator data
  return data.map((point, i) => ({
    date: point.date,
    timestamp: point.timestamp,
    ma1: ma1Values[i],
    ma2: ma2Values[i],
    bbUpper: bbValues.upper[i],
    bbMiddle: bbValues.middle[i],
    bbLower: bbValues.lower[i],
  }));
}

/**
 * Merge indicator data with price data for charting
 */
export interface PriceWithIndicators extends PricePoint {
  ma1?: number;
  ma2?: number;
  bbUpper?: number;
  bbMiddle?: number;
  bbLower?: number;
}

export function mergeIndicatorsWithPriceData(
  priceData: PricePoint[],
  indicators: IndicatorDataPoint[]
): PriceWithIndicators[] {
  return priceData.map((point, i) => ({
    ...point,
    ma1: indicators[i]?.ma1,
    ma2: indicators[i]?.ma2,
    bbUpper: indicators[i]?.bbUpper,
    bbMiddle: indicators[i]?.bbMiddle,
    bbLower: indicators[i]?.bbLower,
  }));
}
