import { toZonedTime, fromZonedTime } from 'date-fns-tz';

export const PARIS_TIMEZONE = 'Europe/Paris';

/**
 * Convert a date to Paris timezone
 */
export const toParisTime = (date: Date | string): Date => {
  return toZonedTime(date, PARIS_TIMEZONE);
};

/**
 * Convert a Paris timezone date to UTC for storage
 */
export const fromParisTime = (date: Date | string): Date => {
  return fromZonedTime(date, PARIS_TIMEZONE);
};

/**
 * Get current time in Paris timezone
 */
export const nowInParis = (): Date => {
  return toParisTime(new Date());
};
