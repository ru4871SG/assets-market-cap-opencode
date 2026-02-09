// Custom error class for rate limiting
export class RateLimitError extends Error {
  public waitTime: number;  // Seconds to wait before retrying
  
  constructor(message: string = 'Too Many Requests. Rate limited.', waitTime: number = 0) {
    super(message);
    this.name = 'RateLimitError';
    this.waitTime = waitTime;
  }
}

// Custom error class for 522 Server Errors (Cloudflare timeout)
// These are transient and should be retried
export class ServerTimeoutError extends Error {
  constructor(message: string = 'Server temporarily unavailable. Retrying...') {
    super(message);
    this.name = 'ServerTimeoutError';
  }
}

// Custom error class for delisted/invalid symbols
// These are NOT transient - the symbol doesn't exist
export class SymbolNotFoundError extends Error {
  public symbol: string;
  
  constructor(symbol: string, message?: string) {
    super(message || `No price data found for ${symbol}`);
    this.name = 'SymbolNotFoundError';
    this.symbol = symbol;
  }
}

// Custom error class for empty history data (common with international stocks)
// These are NOT transient in the short term - user should check back later
export class EmptyHistoryError extends Error {
  public symbol: string;
  public userMessage: string;
  
  constructor(symbol: string, userMessage: string) {
    super(userMessage);
    this.name = 'EmptyHistoryError';
    this.symbol = symbol;
    this.userMessage = userMessage;
  }
}

// Check if an error is a rate limit error
export function isRateLimitError(error: unknown): boolean {
  if (error instanceof RateLimitError) {
    return true;
  }
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return message.includes('rate limit') || 
           message.includes('too many requests') ||
           message.includes('429');
  }
  return false;
}

// Check if an error is a 522 Server Timeout error (transient, should retry)
export function isServerTimeoutError(error: unknown): boolean {
  if (error instanceof ServerTimeoutError) {
    return true;
  }
  if (error instanceof Error) {
    const message = error.message;
    return message.includes('522') || 
           message.includes('Server Error');
  }
  return false;
}

// Check if an error is a symbol not found error (delisted, invalid ticker)
export function isSymbolNotFoundError(error: unknown): boolean {
  if (error instanceof SymbolNotFoundError) {
    return true;
  }
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return message.includes('delisted') || 
           message.includes('no price data found') ||
           message.includes('no data found') ||
           message.includes('symbol may be delisted');
  }
  return false;
}

// Check if an error is an empty history error (should not auto-retry)
export function isEmptyHistoryError(error: unknown): boolean {
  if (error instanceof EmptyHistoryError) {
    return true;
  }
  return false;
}

// Extract symbol from error message for display
export function extractSymbolFromError(error: unknown): string | null {
  if (error instanceof SymbolNotFoundError) {
    return error.symbol;
  }
  if (error instanceof EmptyHistoryError) {
    return error.symbol;
  }
  if (error instanceof Error) {
    // Try to extract symbol from messages like "$NEWM: possibly delisted"
    const dollarMatch = error.message.match(/\$([A-Z0-9.]+)/);
    if (dollarMatch) {
      return dollarMatch[1];
    }
    // Try to extract from "No price data found for XYZ"
    const forMatch = error.message.match(/for\s+([A-Z0-9.]+)/i);
    if (forMatch) {
      return forMatch[1];
    }
  }
  return null;
}
