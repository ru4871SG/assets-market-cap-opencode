import { InventoryResponse, InventoryDataPoint, PricePoint } from '../types/asset';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

/**
 * Fetch COMEX inventory data for a metal (gold or silver)
 * @param symbol Metal symbol (XAU for gold, XAG for silver)
 * @param days Number of days of history (default: 0 = all data)
 */
export async function fetchMetalInventory(symbol: string, days: number = 0): Promise<InventoryResponse> {
  // If days is 0 or negative, don't include the days parameter to get all data
  const url = days > 0 
    ? `${API_BASE_URL}/api/metals/${symbol}/inventory?days=${days}`
    : `${API_BASE_URL}/api/metals/${symbol}/inventory`;
  
  const response = await fetch(url);
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `Failed to fetch inventory data: ${response.status}`);
  }
  
  return response.json();
}

/**
 * Check if a metal has COMEX inventory data available
 * @param symbol Metal symbol to check
 */
export function hasInventoryData(symbol: string): boolean {
  // Only gold and silver have COMEX inventory data
  return symbol === 'XAU' || symbol === 'XAG';
}

/**
 * Calculate daily change for inventory data points
 * @param data Raw inventory data points
 * @returns Inventory data points with daily change calculated
 */
export function calculateInventoryDailyChange(data: InventoryDataPoint[]): InventoryDataPoint[] {
  if (data.length < 2) return data;
  
  return data.map((point, index) => {
    if (index === 0) {
      return { ...point, dailyChange: 0, dailyChangePercent: 0 };
    }
    
    const prevTotal = data[index - 1].total;
    const dailyChange = point.total - prevTotal;
    const dailyChangePercent = prevTotal !== 0 ? (dailyChange / prevTotal) * 100 : 0;
    
    return {
      ...point,
      dailyChange,
      dailyChangePercent,
    };
  });
}

/**
 * Helper to normalize date strings for comparison (YYYY-MM-DD format)
 */
function normalizeDate(dateStr: string): string {
  // Handle various date formats and extract YYYY-MM-DD
  const date = new Date(dateStr);
  return date.toISOString().split('T')[0];
}

/**
 * Merge inventory data with price data for overlay on price chart
 * Maps inventory daily changes to corresponding price data dates
 * @param priceData Price history data points
 * @param inventoryData Inventory data points with daily changes
 * @returns Price data points with optional inventory change field
 */
export interface PriceWithInventory extends PricePoint {
  inventoryChange?: number;
  inventoryTotal?: number;
}

export function mergeInventoryWithPriceData(
  priceData: PricePoint[],
  inventoryData: InventoryDataPoint[]
): PriceWithInventory[] {
  if (!inventoryData || inventoryData.length === 0) {
    return priceData;
  }
  
  // Calculate daily changes for inventory data
  const inventoryWithChanges = calculateInventoryDailyChange(inventoryData);
  
  // Create a map of date -> inventory data for quick lookup
  const inventoryMap = new Map<string, InventoryDataPoint>();
  inventoryWithChanges.forEach(point => {
    const normalizedDate = normalizeDate(point.date);
    inventoryMap.set(normalizedDate, point);
  });
  
  // Merge with price data
  return priceData.map(pricePoint => {
    const normalizedDate = normalizeDate(pricePoint.date);
    const inventoryPoint = inventoryMap.get(normalizedDate);
    
    if (inventoryPoint) {
      return {
        ...pricePoint,
        inventoryChange: inventoryPoint.dailyChange,
        inventoryTotal: inventoryPoint.total,
      };
    }
    
    return pricePoint;
  });
}
