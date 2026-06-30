/* ============================================================
   Yuno — actions utiles depuis un billet / QR
   Builders d'URL purs (Google Maps + Google Agenda) réutilisés
   par l'overlay QR (OrderQROverlay). Aucune dépendance UI.
   ============================================================ */

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
