import type { FeedItem } from '@/hooks/useLiveNightData';
import type { IncidentLive } from '@/lib/liveops/extended';

/**
 * "Staff radio" narrative engine — deterministic, zero-cost, computed on the
 * client from data already fetched. Turns raw feed events into short phrases
 * attributed to a station, the way staff would call things out on a radio:
 * "Door — 12 people in over 5 min", "Bar — order #482 ready", "VIP — table
 * Martin arrived". Individual door scans are folded into 5-minute batches so
 * a busy door doesn't drown out the bar and VIP signal.
 */

export type RadioStation = 'door' | 'bar' | 'vip' | 'cloakroom';

export interface RadioItem {
  id: string;
  station: RadioStation;
  /** i18n key of the phrase template (liveops.radio.*). */
  tKey: string;
  /** Interpolation params: replace `{name}` in the resolved template. */
  params: Record<string, string>;
  timestamp: string;
  severity: 'info' | 'warn';
}

const FIVE_MIN_MS = 5 * 60_000;

export function buildRadioFeed(feed: FeedItem[], incidents: IncidentLive[]): RadioItem[] {
  const items: RadioItem[] = [];

  // Door entries (tickets + guest list) batched per 5-min bucket.
  const entryBuckets = new Map<number, FeedItem[]>();
  feed.forEach(item => {
    if (item.type !== 'ticket_scanned' && item.type !== 'gl_scanned') return;
    const bucket = Math.floor(new Date(item.timestamp).getTime() / FIVE_MIN_MS);
    const list = entryBuckets.get(bucket) || [];
    list.push(item);
    entryBuckets.set(bucket, list);
  });
  entryBuckets.forEach((list, bucket) => {
    const latest = list.reduce((max, i) => (i.timestamp > max ? i.timestamp : max), list[0].timestamp);
    if (list.length === 1) {
      items.push({
        id: `radio-entry-${list[0].id}`,
        station: 'door',
        tKey: list[0].type === 'gl_scanned' ? 'liveops.radio.entryGuestList' : 'liveops.radio.entrySingle',
        params: { name: list[0].description },
        timestamp: latest,
        severity: 'info',
      });
    } else {
      items.push({
        id: `radio-entries-${bucket}`,
        station: 'door',
        tKey: 'liveops.radio.entriesBatch',
        params: { n: String(list.length) },
        timestamp: latest,
        severity: 'info',
      });
    }
  });

  // Everything else keeps one phrase per event.
  feed.forEach(item => {
    switch (item.type) {
      case 'order_created':
        items.push({ id: `radio-${item.id}`, station: 'bar', tKey: 'liveops.radio.orderCreated', params: { desc: item.description }, timestamp: item.timestamp, severity: 'info' });
        break;
      case 'order_ready':
        items.push({ id: `radio-${item.id}`, station: 'bar', tKey: 'liveops.radio.orderReady', params: { desc: item.description }, timestamp: item.timestamp, severity: 'info' });
        break;
      case 'order_served':
        items.push({ id: `radio-${item.id}`, station: 'bar', tKey: 'liveops.radio.orderServed', params: { desc: item.description }, timestamp: item.timestamp, severity: 'info' });
        break;
      case 'refund':
        items.push({ id: `radio-${item.id}`, station: 'bar', tKey: 'liveops.radio.refund', params: { desc: item.description }, timestamp: item.timestamp, severity: 'warn' });
        break;
      case 'vip_scanned':
        items.push({ id: `radio-${item.id}`, station: 'vip', tKey: 'liveops.radio.vipArrived', params: { name: item.description }, timestamp: item.timestamp, severity: 'info' });
        break;
      case 'table_booked':
        items.push({ id: `radio-${item.id}`, station: 'vip', tKey: 'liveops.radio.tableBooked', params: { name: item.description }, timestamp: item.timestamp, severity: 'info' });
        break;
      case 'cloakroom':
        items.push({ id: `radio-${item.id}`, station: 'cloakroom', tKey: 'liveops.radio.cloakroom', params: { num: item.description }, timestamp: item.timestamp, severity: 'info' });
        break;
      default:
        break;
    }
  });

  // Incidents called out by the door.
  incidents.forEach(inc => {
    items.push({
      id: `radio-inc-${inc.id}`,
      station: 'door',
      tKey: `liveops.incident.${inc.kind}`,
      params: inc.reason ? { reason: inc.reason } : {},
      timestamp: inc.createdAt,
      severity: inc.kind === 'shift_start' ? 'info' : 'warn',
    });
  });

  items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return items.slice(0, 80);
}

/** Interpolate `{key}` placeholders of a resolved i18n template. */
export function interpolate(template: string, params: Record<string, string>): string {
  return Object.entries(params).reduce(
    (acc, [key, value]) => acc.split(`{${key}}`).join(value),
    template,
  );
}
