import { useState, useEffect, useCallback, useRef } from 'react';

// Auto-refresh interval (x minutes in milliseconds) for both homepage and asset page
// NOTE: Keep in sync with ASSET_PAGE_REFRESH_MINUTES in backend/data_refresher.py
export const AUTO_REFRESH_INTERVAL = 3 * 60 * 1000;

interface UseAutoRefreshCountdownOptions {
  enabled: boolean;
  onRefresh: () => void;
  isLoading?: boolean;
  isPaused?: boolean; // External pause condition (e.g., rate limited)
}

interface UseAutoRefreshCountdownResult {
  secondsRemaining: number;
  isRefreshing: boolean;
  formattedCountdown: string;
  resetCountdown: () => void;
}

/**
 * Format seconds remaining as MM:SS
 */
export function formatCountdown(seconds: number): string {
  if (seconds <= 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Hook for managing auto-refresh countdown timer
 */
export function useAutoRefreshCountdown({
  enabled,
  onRefresh,
  isLoading = false,
  isPaused = false,
}: UseAutoRefreshCountdownOptions): UseAutoRefreshCountdownResult {
  const [secondsRemaining, setSecondsRemaining] = useState(AUTO_REFRESH_INTERVAL / 1000);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onRefreshRef = useRef(onRefresh);

  // Keep onRefresh ref updated
  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  // Reset countdown to full duration
  const resetCountdown = useCallback(() => {
    setSecondsRemaining(AUTO_REFRESH_INTERVAL / 1000);
    setIsRefreshing(false);
  }, []);

  // Main countdown effect
  useEffect(() => {
    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    // Don't run if disabled or paused
    if (!enabled || isPaused) {
      return;
    }

    // Countdown interval (every second)
    intervalRef.current = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          // Time to refresh
          if (!isLoading) {
            setIsRefreshing(true);
            console.log('[Auto-refresh] Countdown complete, refreshing...');
            onRefreshRef.current();
            // Reset will happen when isLoading changes or via resetCountdown
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, isPaused, isLoading]);

  // Reset countdown when loading completes (after a refresh)
  useEffect(() => {
    if (!isLoading && isRefreshing) {
      resetCountdown();
    }
  }, [isLoading, isRefreshing, resetCountdown]);

  return {
    secondsRemaining,
    isRefreshing,
    formattedCountdown: formatCountdown(secondsRemaining),
    resetCountdown,
  };
}
