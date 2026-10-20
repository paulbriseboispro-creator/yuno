// L'email qui donne au club hôte l'accès à SA page de la soirée (/h/<jeton>).
// Mots : `host-pass-words.ts` (famille hostPass.*, partagée avec le front) ;
// gabarit : la DA publique des emails (`email-kit.ts`). Pur : rien n'est envoyé ici.
import { shell, brandBar, poster, ruleLabel, title, body, section, ctaPill, infoRows, footer, esc, C } from './email-kit.ts';
import { hostPassLocale, hostPassWords, toHostPassLanguage } from './host-pass-words.ts';

export interface HostPassEmailInput {
  lang: string;
  venueName: string;
  inviterName: string;
  eventTitle: string;
  eventStartAt: string | null;
  timezone: string | null;
  posterUrl: string | null;
  locationName: string | null;
  locationCity: string | null;
  pageUrl: string;
  recipientEmail?: string | null;
}

export function buildHostPassEmail(d: HostPassEmailInput): { subject: string; preheader: string; html: string } {
  const lang = toHostPassLanguage(d.lang);
  const w = hostPassWords(lang);
  const vars = { club: d.venueName, event: d.eventTitle, inviter: d.inviterName };
  const subject = w('hostPass.mail.subject', vars);
  const preheader = w('hostPass.mail.preheader');
  const strong = (s: string) => `<strong style="color:${C.white}">${esc(s)}</strong>`;
  const intro = esc(w('hostPass.mail.intro', { club: '\u0001', event: '\u0002', inviter: '\u0003' }))
    .replace('\u0001', strong(d.venueName))
    .replace('\u0002', strong(d.eventTitle))
    .replace('\u0003', strong(d.inviterName));
  const date = d.eventStartAt
    ? new Date(d.eventStartAt).toLocaleString(hostPassLocale(lang), {
      weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
      timeZone: d.timezone || 'Europe/Paris',
    })
    : null;
  const rows: Array<{ k: string; v: string }> = [{ k: w('hostPass.mail.rowOrganizer'), v: d.inviterName }];
  if (date) rows.push({ k: w('hostPass.mail.rowDate'), v: date });
  const place = [d.locationName, d.locationCity].filter(Boolean).join(', ');
  if (place) rows.push({ k: w('hostPass.mail.rowPlace'), v: place });

  const html = shell({
    title: subject,
    preheader,
    body: [
      brandBar(),
      ...(d.posterUrl && /^https:\/\//.test(d.posterUrl) ? [poster(d.posterUrl, d.eventTitle)] : []),
      section(ruleLabel(w('hostPass.mail.kicker')) + `<div style="height:16px"></div>` +
        title(d.eventTitle, 30) + `<div style="height:16px"></div>` + body(intro), { border: false }),
      section(infoRows(rows)),
      section(body(esc(w('hostPass.mail.next')), C.gray2) + `<div style="height:22px"></div>` +
        ctaPill(w('hostPass.mail.cta'), d.pageUrl), { border: false }),
      footer({ lang, recipientEmail: d.recipientEmail ?? undefined, reason: w('hostPass.mail.reason', vars) }),
    ].join(''),
  });
  return { subject, preheader, html };
}
