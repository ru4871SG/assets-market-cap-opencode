/**
 * Premium API Service
 * Fetches Shanghai and India premium data for gold and silver.
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export interface PremiumRegionData {
  metal: string;
  region: string;
  timestamp: string;
  shanghai_spot?: number;
  india_spot?: number;
  western_spot: number | null;
  spot_premium: number | null;
  spot_premium_pct: number | null;
  unit: string;
  source?: string;
  note?: string;
}

export interface PremiumData {
  symbol: string;
  metal: string;
  timestamp: string;
  shanghai: PremiumRegionData | null;
  india: PremiumRegionData | null;
  errors?: {
    shanghai?: string;
    india?: string;
  };
}

/**
 * Check if a metal symbol supports premium data
 */
export function hasPremiumData(symbol: string): boolean {
  return symbol === 'XAU' || symbol === 'XAG';
}

/**
 * Fetch all premium data (Shanghai + India) for a metal
 * @param symbol Metal symbol (XAU for gold, XAG for silver)
 */
export async function fetchMetalPremium(symbol: string): Promise<PremiumData> {
  if (!hasPremiumData(symbol)) {
    throw new Error(`Premium data not available for ${symbol}`);
  }

  const response = await fetch(`${API_BASE_URL}/api/metals/${symbol}/premium`);
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to fetch premium data: ${response.status}`);
  }

  return response.json();
}

/**
 * Fetch Shanghai premium data only
 * @param symbol Metal symbol (XAU for gold, XAG for silver)
 */
export async function fetchShanghaiPremium(symbol: string): Promise<{ symbol: string; metal: string; shanghai: PremiumRegionData }> {
  if (!hasPremiumData(symbol)) {
    throw new Error(`Premium data not available for ${symbol}`);
  }

  const response = await fetch(`${API_BASE_URL}/api/metals/${symbol}/premium?region=shanghai`);
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to fetch Shanghai premium: ${response.status}`);
  }

  return response.json();
}

/**
 * Fetch India premium data only
 * @param symbol Metal symbol (XAU for gold, XAG for silver)
 */
export async function fetchIndiaPremium(symbol: string): Promise<{ symbol: string; metal: string; india: PremiumRegionData }> {
  if (!hasPremiumData(symbol)) {
    throw new Error(`Premium data not available for ${symbol}`);
  }

  const response = await fetch(`${API_BASE_URL}/api/metals/${symbol}/premium?region=india`);
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to fetch India premium: ${response.status}`);
  }

  return response.json();
}

/**
 * Format a premium value for display
 * @param value The premium value (absolute or percentage)
 * @param isPercentage Whether the value is a percentage
 */
export function formatPremium(value: number | null | undefined, isPercentage: boolean = false): string {
  if (value === null || value === undefined) {
    return '--';
  }
  
  const sign = value >= 0 ? '+' : '';
  
  if (isPercentage) {
    return `${sign}${value.toFixed(2)}%`;
  }
  
  // Format as currency
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

/**
 * Get CSS class for premium display (positive/negative styling)
 */
export function getPremiumClass(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return 'neutral';
  }
  return value >= 0 ? 'positive' : 'negative';
}
