import { useState, useEffect, useCallback, useRef } from 'react';

const DEFAULT_RETRY_DELAY_SECONDS = 60; // 1 minute default if no wait time provided

interface RateLimitRetryState {
  isRateLimited: boolean;
  secondsRemaining: number;
  startRetryCountdown: (waitTimeSeconds?: number) => void;
  cancelRetry: () => void;
  resetRateLimit: () => void;
}

/**
 * Hook to manage automatic retry countdown when rate limited.
 * 
 * @param onRetry - Callback to execute when countdown reaches 0
 * @param defaultRetryDelaySeconds - Default number of seconds to wait before retry (default: 60)
 * @returns Rate limit retry state and control functions
 */
export function useRateLimitRetry(
  onRetry: () => void,
  defaultRetryDelaySeconds: number = DEFAULT_RETRY_DELAY_SECONDS
): RateLimitRetryState {
  const [isRateLimited, setIsRateLimited] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const intervalRef = useRef<number | null>(null);
  const onRetryRef = useRef(onRetry);
  const isCountingDown = useRef(false);

  // Keep onRetry ref up to date
  useEffect(() => {
    onRetryRef.current = onRetry;
  }, [onRetry]);

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  // Handle countdown - only start when isRateLimited becomes true
  useEffect(() => {
    // Only start countdown if rate limited and not already counting
    if (isRateLimited && secondsRemaining > 0 && !isCountingDown.current) {
      isCountingDown.current = true;
      
      intervalRef.current = window.setInterval(() => {
        setSecondsRemaining((prev) => {
          const next = prev - 1;
          
          if (next <= 0) {
            // Countdown finished
            isCountingDown.current = false;
            setIsRateLimited(false);
            
            if (intervalRef.current) {
              clearInterval(intervalRef.current);
              intervalRef.current = null;
            }
            
            // Execute retry callback (use setTimeout to avoid state update during render)
            setTimeout(() => {
              onRetryRef.current();
            }, 0);
            
            return 0;
          }
          
          return next;
        });
      }, 1000);
    }

    // Cleanup only when rate limit is cleared (not on every render)
    return () => {
      if (!isRateLimited && intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
        isCountingDown.current = false;
      }
    };
  }, [isRateLimited]); // Only depend on isRateLimited, not secondsRemaining

  /**
   * Start the retry countdown.
   * @param waitTimeSeconds - Optional wait time from backend (in seconds). 
   *                          If not provided, uses defaultRetryDelaySeconds.
   */
  const startRetryCountdown = useCallback((waitTimeSeconds?: number) => {
    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    isCountingDown.current = false;
    
    // Use provided wait time, or default
    const delaySeconds = waitTimeSeconds ?? defaultRetryDelaySeconds;
    // Add 1 second buffer to ensure server has cleared the rate limit
    const totalDelay = Math.ceil(delaySeconds) + 1;
    
    // Set state - this will trigger the useEffect to start the interval
    setSecondsRemaining(totalDelay);
    setIsRateLimited(true);
  }, [defaultRetryDelaySeconds]);

  const cancelRetry = useCallback(() => {
    isCountingDown.current = false;
    setIsRateLimited(false);
    setSecondsRemaining(0);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const resetRateLimit = useCallback(() => {
    isCountingDown.current = false;
    setIsRateLimited(false);
    setSecondsRemaining(0);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  return {
    isRateLimited,
    secondsRemaining,
    startRetryCountdown,
    cancelRetry,
    resetRateLimit,
  };
}

/**
 * Format seconds into a human-readable string
 * e.g., 300 -> "5:00", 65 -> "1:05"
 */
export function formatSecondsRemaining(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}
