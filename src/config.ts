/**
 * Frontend Configuration
 * 
 * This file contains configuration options for the frontend application.
 * Edit these values to customize the behavior of the app.
 */

// =============================================================================
// DEVELOPMENT SETTINGS
// =============================================================================

/**
 * React StrictMode toggle
 * 
 * When enabled (true):
 * - React runs effects twice in development mode to detect bugs
 * - Helps catch memory leaks, missing cleanup, stale closures
 * - Can cause double API calls in development (not in production)
 * 
 * When disabled (false):
 * - Effects run once, same as production
 * - Reduces API credit usage during development
 * - Loses some React-specific bug detection
 * 
 * NOTE: StrictMode only affects development builds. Production builds
 * always run effects once regardless of this setting.
 * 
 * Default: false (to save API credits during development)
 */
export const STRICT_MODE = false;
