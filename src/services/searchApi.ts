import { Asset } from '../types/asset';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

interface SearchResponse {
  query: string;
  results: Asset[];
  count: number;
}

export async function searchAssets(query: string): Promise<Asset[]> {
  if (!query || query.length < 2) {
    return [];
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/search?q=${encodeURIComponent(query)}`);
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    
    const data: SearchResponse = await response.json();
    return data.results;
  } catch (error) {
    console.error('Error searching assets:', error);
    return [];
  }
}
