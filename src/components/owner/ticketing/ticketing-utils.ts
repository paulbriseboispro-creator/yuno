import { formatInTimeZone } from 'date-fns-tz';
import { PARIS_TIMEZONE, fromParisTime, toParisTime } from '@/lib/timezone';
import type { TicketSalesMode } from './ticketing-types';

// Pure date/mode helpers extracted verbatim from OwnerTicketing.tsx (no component state).
export const toDateTimeLocalInput = (value?: string) => {
  if (!value) return '';
  return formatInTimeZone(toParisTime(value), PARIS_TIMEZONE, "yyyy-MM-dd'T'HH:mm");
};

export const toUtcIsoOrNull = (value: string) => {
  if (!value) return null;
  return fromParisTime(value).toISOString();
};

export const resolveSalesMode = (values: { presaleStartAt?: string; publicSaleStartAt?: string; waitlistEnabled?: boolean }): TicketSalesMode => {
  if (values.presaleStartAt || values.publicSaleStartAt) return 'presale';
  if (values.waitlistEnabled) return 'private';
  return 'normal';
};
