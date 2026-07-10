/* ============================================================
   Yuno — actions utiles depuis un billet / QR
   Builders d'URL purs (Google Maps + Google Agenda) réutilisés
   par l'overlay QR (OrderQROverlay). Aucune dépendance UI.
   + addToCalendar : ajout DIRECT au calendrier Apple en natif
   (feuille EventKit), fallback Google Agenda sur le web.
   ============================================================ */

import { isNative, openExternal } from '@/lib/native';

export interface VenueLocation {
  name?: string | null;
  address?: string | null;
  city?: string | null;
  lat?: number | null;
  lng?: number | null;
}

/** Texte « Nom, Adresse, Ville » pour Maps / Agenda (location). */
export function venueLocationText(v: VenueLocation): string {
  return [v.name, v.address, v.city].map(s => (s || '').trim()).filter(Boolean).join(', ');
}

/**
 * URL Google Maps cross-plateforme (ouvre l'app native sur mobile).
 * Préfère le texte nommé quand on a une adresse (résultat = le lieu nommé),
 * sinon les coordonnées GPS (pin précis), sinon nom + ville. '' si rien.
 */
export function buildVenueMapsUrl(v: VenueLocation): string {
  const base = 'https://www.google.com/maps/search/?api=1&query=';
  const text = venueLocationText(v);
  if (v.address && text) return base + encodeURIComponent(text);
  if (typeof v.lat === 'number' && typeof v.lng === 'number') return base + `${v.lat},${v.lng}`;
  if (text) return base + encodeURIComponent(text);
  return '';
}

function toCalStamp(iso: string): string {
  // Google Calendar attend YYYYMMDDTHHMMSSZ (UTC).
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * URL « Ajouter à Google Agenda » (template pré-rempli).
 * Si pas d'heure de fin, on suppose +3h. '' si pas de date de début.
 */
export function buildCalendarUrl(opts: {
  title: string;
  startAt?: string | null;
  endAt?: string | null;
  location?: string;
}): string {
  if (!opts.startAt) return '';
  const start = toCalStamp(opts.startAt);
  const endIso = opts.endAt || new Date(new Date(opts.startAt).getTime() + 3 * 3600 * 1000).toISOString();
  const end = toCalStamp(endIso);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: opts.title,
    dates: `${start}/${end}`,
  });
  if (opts.location) params.set('location', opts.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export interface CalendarEventOpts {
  title: string;
  startAt?: string | null;
  endAt?: string | null;
  location?: string;
  notes?: string;
}

/**
 * Ajoute la soirée au calendrier. App native : feuille d'édition Apple
 * Calendar (EventKit) pré-remplie — ajout direct, pas de détour web.
 * Web / échec du plugin : ouverture du template Google Agenda.
 * Retourne 'native' | 'web' | 'cancelled'.
 */
export async function addToCalendar(opts: CalendarEventOpts): Promise<'native' | 'web' | 'cancelled'> {
  if (!opts.startAt) return 'cancelled';

  if (isNative()) {
    try {
      const { CapacitorCalendar } = await import('@ebarooni/capacitor-calendar');
      const start = new Date(opts.startAt).getTime();
      const end = new Date(
        opts.endAt || new Date(new Date(opts.startAt).getTime() + 3 * 3600 * 1000).toISOString(),
      ).getTime();
      await CapacitorCalendar.createEventWithPrompt({
        title: opts.title,
        startDate: start,
        endDate: end,
        ...(opts.location ? { location: opts.location } : {}),
        ...(opts.notes ? { description: opts.notes } : {}),
      });
      return 'native';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/cancel|dismiss/i.test(msg)) return 'cancelled';
      // Permission refusée / plugin absent du binaire → fallback web.
    }
  }

  const url = buildCalendarUrl(opts);
  if (!url) return 'cancelled';
  openExternal(url);
  return 'web';
}
