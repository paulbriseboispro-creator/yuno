// Espace invité : le RENDU des e-mails de notifications de l'invité (contrat,
// argent, soirée qui change, bilan). Pur, testé : rien n'est envoyé ici (voir
// `guest-pass-notify.ts`). Le lien mène à l'espace (connexion puis retour) ou,
// tant que personne n'a rattaché l'accès, à une invitation neuve.
import { shell, brandBar, poster, ruleLabel, title, body, section, ctaPill, footer, esc } from "./email-kit.ts";
import { describeGuestNotification, guestSpaceLocale, guestSpaceWords, toGuestSpaceLanguage } from "./guest-space-words.ts";

const APP_ORIGIN = "https://yunoapp.eu";

export interface GuestNotifEmailRow {
  id: string;
  type: string;
  data: Record<string, unknown>;
  email: string;
  language: string;
  guest_name: string;
  event_title: string;
  event_start_at: string | null;
  timezone: string | null;
  poster_url: string | null;
  path: string;
  inviter_name: string | null;
}

/** L'e-mail d'une notification (pur). null = type sans e-mail connu. */
export function buildGuestNotifEmail(r: GuestNotifEmailRow): { subject: string; html: string } | null {
  const lang = toGuestSpaceLanguage(r.language);
  const w = guestSpaceWords(lang);
  const eur = (n: number) => new Intl.NumberFormat(guestSpaceLocale(lang), { style: "currency", currency: "EUR" }).format(n);
  const d = describeGuestNotification(r.type, { tz: r.timezone ?? undefined, ...r.data }, lang, eur);
  if (!d) return null;
  const text = w(d.key, d.vars);
  const subject = w("guestSpace.notifMail.subject", { event: r.event_title, text });
  const url = `${APP_ORIGIN}${r.path}${r.path.startsWith("/invite/") ? `?tab=${d.tab}` : ""}`;
  const html = shell({
    title: subject,
    preheader: text,
    body: [
      brandBar(),
      ...(r.poster_url && /^https:\/\//.test(r.poster_url) ? [poster(r.poster_url, r.event_title)] : []),
      section(ruleLabel(w("guestSpace.notifMail.kicker")) + `<div style="height:16px"></div>` +
        title(r.event_title, 28) + `<div style="height:14px"></div>` + body(esc(text)), { border: false }),
      section(body(esc(w("guestSpace.notifMail.next"))) + `<div style="height:22px"></div>` +
        ctaPill(w("guestSpace.mail.cta"), url), { border: false }),
      footer({
        lang, recipientEmail: r.email,
        reason: w("guestSpace.mail.reason", { guest: r.guest_name, event: r.event_title, inviter: r.inviter_name ?? "" }),
      }),
    ].join(""),
  });
  return { subject, html };
}

