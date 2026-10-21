// L'email qui donne à un invité (club ou organisation) l'accès à SON espace de
// la soirée (/h/<jeton>). Mots : `guest-space-words.ts` (famille guestSpace.*,
// partagée avec le front) ; gabarit : la DA publique des emails (`email-kit.ts`).
// Pur : rien n'est envoyé ici.
import { shell, brandBar, poster, ruleLabel, title, body, section, ctaPill, infoRows, footer, esc, C } from './email-kit.ts';
import { guestSpaceLocale, guestSpaceWords, toGuestSpaceLanguage } from './guest-space-words.ts';

export interface GuestSpaceEmailInput {
  lang: string;
  guestName: string;
  inviterName: string;
  eventTitle: string;
  eventStartAt: string | null;
  timezone: string | null;
  posterUrl: string | null;
  locationName: string | null;
  locationCity: string | null;
  pageUrl: string;
  recipientEmail?: string | null;
  /** Un contrat de soirée attend sa signature dans l'espace. */
  contractProposed?: boolean;
}

export function buildGuestSpaceEmail(d: GuestSpaceEmailInput): { subject: string; preheader: string; html: string } {
  const lang = toGuestSpaceLanguage(d.lang);
  const w = guestSpaceWords(lang);
  const vars = { guest: d.guestName, event: d.eventTitle, inviter: d.inviterName };
  const subject = w('guestSpace.mail.subject', vars);
  const preheader = w('guestSpace.mail.preheader');
  const strong = (s: string) => `<strong style="color:${C.white}">${esc(s)}</strong>`;
  const intro = esc(w('guestSpace.mail.intro', { guest: '\u0001', event: '\u0002', inviter: '\u0003' }))
    .replace('\u0001', strong(d.guestName))
    .replace('\u0002', strong(d.eventTitle))
    .replace('\u0003', strong(d.inviterName));
  const date = d.eventStartAt
    ? new Date(d.eventStartAt).toLocaleString(guestSpaceLocale(lang), {
      weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
      timeZone: d.timezone || 'Europe/Paris',
    })
    : null;
  const rows: Array<{ k: string; v: string }> = [{ k: w('guestSpace.mail.rowOrganizer'), v: d.inviterName }];
  if (date) rows.push({ k: w('guestSpace.mail.rowDate'), v: date });
  const place = [d.locationName, d.locationCity].filter(Boolean).join(', ');
  if (place) rows.push({ k: w('guestSpace.mail.rowPlace'), v: place });

  const html = shell({
    title: subject,
    preheader,
    body: [
      brandBar(),
      ...(d.posterUrl && /^https:\/\//.test(d.posterUrl) ? [poster(d.posterUrl, d.eventTitle)] : []),
      section(ruleLabel(w('guestSpace.mail.kicker')) + `<div style="height:16px"></div>` +
        title(d.eventTitle, 30) + `<div style="height:16px"></div>` + body(intro), { border: false }),
      section(infoRows(rows)),
      ...(d.contractProposed ? [section(body(esc(w('guestSpace.mail.contract', vars))), { border: false })] : []),
      section(body(esc(w('guestSpace.mail.next')), C.gray2) + `<div style="height:22px"></div>` +
        ctaPill(w('guestSpace.mail.cta'), d.pageUrl), { border: false }),
      footer({ lang, recipientEmail: d.recipientEmail ?? undefined, reason: w('guestSpace.mail.reason', vars) }),
    ].join(''),
  });
  return { subject, preheader, html };
}
