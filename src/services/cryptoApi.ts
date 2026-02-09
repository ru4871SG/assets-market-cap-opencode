import { Asset } from '../types/asset';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000';

// Supported cryptocurrencies (8 major cryptos via TwelveData)
const SUPPORTED_CRYPTO = [
  { id: 'bitcoin', name: 'Bitcoin', symbol: 'BTC' },
  { id: 'ethereum', name: 'Ethereum', symbol: 'ETH' },
  { id: 'binancecoin', name: 'BNB', symbol: 'BNB' },
  { id: 'cardano', name: 'Cardano', symbol: 'ADA' },
  { id: 'ripple', name: 'XRP', symbol: 'XRP' },
  { id: 'solana', name: 'Solana', symbol: 'SOL' },
  { id: 'tron', name: 'TRON', symbol: 'TRX' },
  { id: 'dogecoin', name: 'Dogecoin', symbol: 'DOGE' },
];

/**
 * Fetches crypto assets from the backend API (using TwelveData).
 * The limit parameter is ignored - we return all supported cryptos.
 */
export async function fetchCryptoAssets(_limit: number = 8): Promise<Asset[]> {
  try {
    const response = await fetch(`${API_BASE}/api/crypto`);
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    
    const data: Asset[] = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching crypto data:', error);
    // Return error placeholder assets so user sees what failed to load
    return SUPPORTED_CRYPTO.map((crypto, index) => ({
      id: `crypto-${crypto.id}`,
      rank: index + 1,
      name: crypto.name,
      symbol: crypto.symbol,
      marketCap: 0,
      price: 0,
      change24h: 0,
      type: 'crypto' as const,
      error: `Unable to load ${crypto.name} data`,
    }));
  }
}

// Static crypto images (well-known, reliable CDN)
function getCryptoImage(symbol: string): string {
  const images: Record<string, string> = {
    btc: 'https://assets.coingecko.com/coins/images/1/large/bitcoin.png',
    eth: 'https://assets.coingecko.com/coins/images/279/large/ethereum.png',
    bnb: 'https://assets.coingecko.com/coins/images/825/large/bnb-icon2_2x.png',
    ada: 'https://assets.coingecko.com/coins/images/975/large/cardano.png',
    xrp: 'https://assets.coingecko.com/coins/images/44/large/xrp-symbol-white-128.png',
    sol: 'https://assets.coingecko.com/coins/images/4128/large/solana.png',
    trx: 'https://assets.coingecko.com/coins/images/1094/large/tron-logo.png',
    doge: 'https://assets.coingecko.com/coins/images/5/large/dogecoin.png',
  };
  return images[symbol.toLowerCase()] || '';
}

// Fallback function to get placeholder assets when rate limited
export function getCryptoPlaceholders(): Asset[] {
  return SUPPORTED_CRYPTO.map((crypto, index) => ({
    id: `crypto-${crypto.id}`,
    rank: index + 1,
    name: crypto.name,
    symbol: crypto.symbol,
    marketCap: 0,
    price: 0,
    change24h: 0,
    type: 'crypto' as const,
    image: getCryptoImage(crypto.symbol.toLowerCase()),
    error: `Unable to load ${crypto.name} data`,
  }));
}
