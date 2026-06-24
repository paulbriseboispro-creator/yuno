// Calendrier — helpers sans dépendance. Génère un fichier .ics téléchargeable
// (universel : iOS/macOS ouvrent la feuille Calendrier, Android l'app calendrier)
// et une URL « ajouter à Google Agenda » à partir des détails d'un event.

export interface CalendarEvent {
  title: string;
  start: Date;
  end?: Date;
  location?: string;
  details?: string;
  url?: string;
}

// Durée par défaut d'une soirée club quand aucune fin explicite n'est connue.
const DEFAULT_DURATION_MS = 5 * 60 * 60 * 1000;

const pad = (n: number): string => (n < 10 ? `0${n}` : `${n}`);

// → 20260712T210000Z (UTC, requis par RFC 5545 et Google Agenda)
function toICSDate(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

function escapeICS(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

export function buildGoogleCalendarUrl(ev: CalendarEvent): string {
  const end = ev.end ?? new Date(ev.start.getTime() + DEFAULT_DURATION_MS);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: ev.title,
    dates: `${toICSDate(ev.start)}/${toICSDate(end)}`,
  });
  const details = [ev.details, ev.url].filter(Boolean).join('\n\n');
  if (details) params.set('details', details);
  if (ev.location) params.set('location', ev.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function buildICS(ev: CalendarEvent): string {
  const end = ev.end ?? new Date(ev.start.getTime() + DEFAULT_DURATION_MS);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Yuno//Event//FR',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${toICSDate(ev.start)}-${hashString(ev.title)}@yunoapp.eu`,
    `DTSTAMP:${toICSDate(new Date())}`,
    `DTSTART:${toICSDate(ev.start)}`,
    `DTEND:${toICSDate(end)}`,
    `SUMMARY:${escapeICS(ev.title)}`,
  ];
  if (ev.location) lines.push(`LOCATION:${escapeICS(ev.location)}`);
  const desc = [ev.details, ev.url].filter(Boolean).join('\n\n');
  if (desc) lines.push(`DESCRIPTION:${escapeICS(desc)}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n');
}

export function downloadICS(ev: CalendarEvent, filename = 'event.ics'): void {
  const blob = new Blob([buildICS(ev)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
