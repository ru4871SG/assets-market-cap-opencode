/**
 * Timezone utility functions for converting chart timestamps between timezones.
 * 
 * The backend returns candle timestamps in the exchange's local timezone (e.g., Asia/Hong_Kong for HK stocks).
 * This utility helps convert those timestamps to the user's selected display timezone.
 */

// Common timezone options for the selector
export interface TimezoneOption {
  value: string;  // IANA timezone identifier
  label: string;  // Display label
  offset: string; // UTC offset for display
}

// Get popular timezone options grouped by region
export const TIMEZONE_OPTIONS: TimezoneOption[] = [
  // Americas
  { value: 'America/New_York', label: 'New York (EST)', offset: 'UTC-5' },
  { value: 'America/Chicago', label: 'Chicago (CST)', offset: 'UTC-6' },
  { value: 'America/Denver', label: 'Denver (MST)', offset: 'UTC-7' },
  { value: 'America/Los_Angeles', label: 'Los Angeles (PST)', offset: 'UTC-8' },
  { value: 'America/Toronto', label: 'Toronto (EST)', offset: 'UTC-5' },
  { value: 'America/Sao_Paulo', label: 'Sao Paulo (BRT)', offset: 'UTC-3' },
  // Europe
  { value: 'Europe/London', label: 'London (GMT)', offset: 'UTC+0' },
  { value: 'Europe/Paris', label: 'Paris (CET)', offset: 'UTC+1' },
  { value: 'Europe/Berlin', label: 'Berlin (CET)', offset: 'UTC+1' },
  { value: 'Europe/Zurich', label: 'Zurich (CET)', offset: 'UTC+1' },
  { value: 'Europe/Moscow', label: 'Moscow (MSK)', offset: 'UTC+3' },
  // Asia/Pacific
  { value: 'Asia/Dubai', label: 'Dubai (GST)', offset: 'UTC+4' },
  { value: 'Asia/Mumbai', label: 'Mumbai (IST)', offset: 'UTC+5:30' },
  { value: 'Asia/Singapore', label: 'Singapore (SGT)', offset: 'UTC+8' },
  { value: 'Asia/Hong_Kong', label: 'Hong Kong (HKT)', offset: 'UTC+8' },
  { value: 'Asia/Shanghai', label: 'Shanghai (CST)', offset: 'UTC+8' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)', offset: 'UTC+9' },
  { value: 'Asia/Seoul', label: 'Seoul (KST)', offset: 'UTC+9' },
  { value: 'Australia/Sydney', label: 'Sydney (AEDT)', offset: 'UTC+11' },
  // UTC
  { value: 'UTC', label: 'UTC', offset: 'UTC+0' },
];

/**
 * Get the user's local timezone from the browser
 */
export function getUserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'America/New_York'; // Default fallback
  }
}

/**
 * Find the timezone option that matches the user's timezone
 */
export function findMatchingTimezone(timezone: string): TimezoneOption | undefined {
  return TIMEZONE_OPTIONS.find(opt => opt.value === timezone);
}

/**
 * Get a display label for the user's timezone
 */
export function getTimezoneLabel(timezone: string): string {
  const option = findMatchingTimezone(timezone);
  if (option) {
    return option.label;
  }
  // If not in our list, return the raw timezone name
  return timezone.replace(/_/g, ' ').replace(/\//g, ' / ');
}

/**
 * Convert a date string from one timezone to another.
 * 
 * @param dateStr - Date string in "YYYY-MM-DD HH:MM" format (exchange local time)
 * @param fromTimezone - Source timezone (e.g., 'Asia/Hong_Kong')
 * @param toTimezone - Target timezone (e.g., 'America/New_York')
 * @returns Converted date string in the same format
 */
export function convertTimezone(
  dateStr: string,
  fromTimezone: string,
  toTimezone: string
): string {
  // If same timezone, return as-is
  if (fromTimezone === toTimezone) {
    return dateStr;
  }
  
  // Check if it's daily data (no time component)
  const hasTime = dateStr.includes(' ') && dateStr.split(' ').length > 1;
  if (!hasTime) {
    // Daily data doesn't need timezone conversion
    return dateStr;
  }
  
  try {
    // Parse the date string as being in the source timezone
    // The date is in format "YYYY-MM-DD HH:MM"
    const [datePart, timePart] = dateStr.split(' ');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hour, minute] = timePart.split(':').map(Number);
    
    // Create a date string that includes the source timezone
    // We use a trick: construct an ISO string and use the timezone offset
    
    // First, get the offset for the source timezone by checking what time it shows
    // for a reference UTC time close to our date
    const refDate = new Date(Date.UTC(year, month - 1, day, hour, minute));
    
    // Get how the source timezone displays this UTC time
    const sourceDisplay = new Intl.DateTimeFormat('en-US', {
      timeZone: fromTimezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
      hour12: false
    }).formatToParts(refDate);
    
    const getPartValue = (parts: Intl.DateTimeFormatPart[], type: string) => {
      const part = parts.find(p => p.type === type);
      return part ? parseInt(part.value, 10) : 0;
    };
    
    // What the source timezone shows for our reference UTC time
    const sourceHour = getPartValue(sourceDisplay, 'hour');
    const sourceMinute = getPartValue(sourceDisplay, 'minute');
    const sourceDay = getPartValue(sourceDisplay, 'day');
    
    // Calculate how many minutes difference between what we want (hour:minute) and what source shows
    const wantedMinutes = hour * 60 + minute + day * 24 * 60;
    const sourceMinutes = sourceHour * 60 + sourceMinute + sourceDay * 24 * 60;
    const diffMinutes = wantedMinutes - sourceMinutes;
    
    // Adjust the reference UTC time to get the actual UTC time for our source datetime
    const actualUtcTime = refDate.getTime() + diffMinutes * 60000;
    const actualUtcDate = new Date(actualUtcTime);
    
    // Now format this UTC time in the target timezone
    const targetDisplay = new Intl.DateTimeFormat('en-US', {
      timeZone: toTimezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
      hour12: false
    }).formatToParts(actualUtcDate);
    
    const targetYear = getPartValue(targetDisplay, 'year');
    const targetMonth = getPartValue(targetDisplay, 'month');
    const targetDay = getPartValue(targetDisplay, 'day');
    let targetHour = getPartValue(targetDisplay, 'hour');
    const targetMinute = getPartValue(targetDisplay, 'minute');
    
    // Handle 24:00 edge case (some locales format midnight as 24:00)
    if (targetHour === 24) targetHour = 0;
    
    // Format back to "YYYY-MM-DD HH:MM"
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${targetYear}-${pad(targetMonth)}-${pad(targetDay)} ${pad(targetHour)}:${pad(targetMinute)}`;
  } catch (e) {
    console.error('Error converting timezone:', e);
    return dateStr;
  }
}

/**
 * Format a date/time for display in the tooltip, respecting the selected timezone.
 * 
 * @param dateStr - Date string in "YYYY-MM-DD HH:MM" format (already converted to display timezone)
 * @param locale - Locale for formatting (e.g., 'en-US')
 * @returns Formatted date/time string
 */
export function formatDateTimeForDisplay(
  dateStr: string,
  locale: string = 'en-US'
): string {
  const hasTime = dateStr.includes(' ') && dateStr.split(' ').length > 1;
  
  if (hasTime) {
    const [datePart, timePart] = dateStr.split(' ');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hour, minute] = timePart.split(':').map(Number);
    const date = new Date(year, month - 1, day, hour, minute);
    
    return date.toLocaleDateString(locale, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }) + ' - ' + date.toLocaleTimeString(locale, {
      hour: '2-digit',
      minute: '2-digit'
    });
  } else {
    // Daily data
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString(locale, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }
}
