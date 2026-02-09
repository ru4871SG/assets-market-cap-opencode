import { 
  EventCategory, 
  EventCategoriesResponse, 
  EventsResponse, 
  HistoricalEvent 
} from '../types/asset';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

/**
 * Fetch historical events for a date range
 */
export async function fetchEvents(
  startDate: string,
  endDate: string,
  categories?: EventCategory[]
): Promise<HistoricalEvent[]> {
  const params = new URLSearchParams({
    start_date: startDate,
    end_date: endDate,
  });

  if (categories && categories.length > 0) {
    params.append('categories', categories.join(','));
  }

  const response = await fetch(`${API_BASE_URL}/api/events?${params}`);
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
  }

  const data: EventsResponse = await response.json();
  return data.events;
}

/**
 * Fetch all available event categories
 */
export async function fetchEventCategories(): Promise<EventCategoriesResponse> {
  const response = await fetch(`${API_BASE_URL}/api/events/categories`);
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
  }

  return response.json();
}

/**
 * Get events that should be displayed on a chart based on price data range
 */
export async function fetchEventsForChart(
  priceData: Array<{ date: string; timestamp: number }>,
  categories?: EventCategory[]
): Promise<HistoricalEvent[]> {
  if (!priceData || priceData.length === 0) {
    return [];
  }

  // Get the date range from the price data
  const dates = priceData.map(p => p.date.split(' ')[0]); // Handle "YYYY-MM-DD HH:MM" format
  const sortedDates = [...dates].sort();
  const startDate = sortedDates[0];
  const endDate = sortedDates[sortedDates.length - 1];

  return fetchEvents(startDate, endDate, categories);
}

/**
 * Default event categories that are most commonly used
 */
export const DEFAULT_EVENT_CATEGORIES: EventCategory[] = [
  'government_shutdown',
  'recession',
];

/**
 * All available event categories
 */
export const ALL_EVENT_CATEGORIES: EventCategory[] = [
  'government_shutdown',
  'recession',
  'fed_rate_hike',
  'fed_rate_cut',
  'fed_rate_hold',
];

/**
 * Fed-related categories (for grouping)
 */
export const FED_CATEGORIES: EventCategory[] = [
  'fed_rate_hike',
  'fed_rate_cut',
  'fed_rate_hold',
];

/**
 * Category display configuration (for UI)
 */
export const CATEGORY_CONFIG: Record<EventCategory, { name: string; color: string; icon: string }> = {
  government_shutdown: {
    name: 'U.S. Government Shutdowns',
    color: '#ff6b6b',
    icon: '🏛️',
  },
  recession: {
    name: 'U.S. Recessions',
    color: '#868e96',
    icon: '📉',
  },
  fed_rate_hike: {
    name: 'Fed Rate Hikes',
    color: '#f59f00',
    icon: '⬆️',
  },
  fed_rate_cut: {
    name: 'Fed Rate Cuts',
    color: '#51cf66',
    icon: '⬇️',
  },
  fed_rate_hold: {
    name: 'Fed Rate Holds',
    color: '#748ffc',
    icon: '⏸️',
  },
};
