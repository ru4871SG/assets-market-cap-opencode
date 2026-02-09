import { Asset } from '../types/asset';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

// Metal info for error fallback display
const METALS = [
  { id: 'metal-gold', name: 'Gold', symbol: 'XAU' },
  { id: 'metal-silver', name: 'Silver', symbol: 'XAG' },
  { id: 'metal-platinum', name: 'Platinum', symbol: 'XPT' },
  { id: 'metal-palladium', name: 'Palladium', symbol: 'XPD' },
  { id: 'metal-copper', name: 'Copper', symbol: 'HG' },
];

export async function fetchMetalAssets(): Promise<Asset[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/metals`);
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    
    const data: Asset[] = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching metal data:', error);
    // Return error placeholder assets so user sees what failed to load
    return METALS.map((metal, index) => ({
      id: metal.id,
      rank: index + 1,
      name: metal.name,
      symbol: metal.symbol,
      marketCap: 0,
      price: 0,
      change24h: 0,
      type: 'metal' as const,
      error: `Unable to load ${metal.name} data`,
    }));
  }
}
