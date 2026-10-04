// Yuno CRM : rendu des e-mails du cycle de vie (Yuno → pro), dans la DA e-mail
// de Yuno CRM (papier clair, carte arrondie, bouton rouge — même dessin que les
// e-mails d'authentification, scripts/supabase/auth-emails.mjs). Module PUR :
// importé tel quel par l'edge (envoi) et par l'Admin CRM (aperçu).

export type LifecycleKey = "welcome" | "connect_j1" | "base_ready" | "trial_ending" | "payment_failed" | "paused" | "low_balance" | "winback";
export type LifecycleLang = "fr" | "en" | "es";
export interface LifecycleCopy { subject: string; title: string; body: string; cta: string }

/** Où mène le bouton de chaque e-mail (chemins de la Console CRM). */
export const LIFECYCLE_PATH: Record<LifecycleKey, string> = {
  welcome: "/crm",
  connect_j1: "/crm/connectors",
  base_ready: "/crm/clients",
  trial_ending: "/crm/account/billing",
  payment_failed: "/crm/account/billing",
  paused: "/crm/account/billing",
  low_balance: "/crm/yunits",
  winback: "/crm/account/billing",
};

const T = { ink: "#1c1517", sand50: "#f7f4f3", sand200: "#e6dfdd", sand400: "#a39a98", sand500: "#857b7d", sand600: "#5e5457", red: "#e3141b" };
const FONT = `'Bricolage Grotesque','Helvetica Neue',Helvetica,Arial,sans-serif`;
const BODY = `Geist,'Helvetica Neue',Helvetica,Arial,sans-serif`;
const FOOT: Record<LifecycleLang, string> = {
  fr: "Vous recevez cet e-mail parce que vous avez un compte Yuno CRM. Il concerne votre compte, pas une offre commerciale.",
  en: "You receive this email because you have a Yuno CRM account. It is about your account, not a commercial offer.",
  es: "Recibes este e-mail porque tienes una cuenta de Yuno CRM. Se refiere a tu cuenta, no es una oferta comercial.",
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Remplace {balance}, {name}… par des valeurs déjà échappées. */
function fill(s: string, vars: Record<string, string>): string {
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m));
}

/** Le gabarit commun (titre, texte, bouton rouge, pied) : déjà échappé en entrée sauf `href`. */
export function crmEmailShell(o: { lang: string; subject: string; titleHtml: string; bodyHtml: string; cta: string; href: string; origin: string; foot: string }): string {
  return `<!DOCTYPE html>
<html lang="${o.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>${esc(o.subject)}</title>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600..800&family=Geist:wght@400..600&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:${T.sand50}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${T.sand50}"><tr><td align="center" style="padding:32px 16px">
  <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="width:520px;max-width:100%">
    <tr><td style="padding:0 4px 18px"><img src="${o.origin}/yuno-wordmark-dark.png" width="88" height="30" alt="Yuno" style="display:block;border:0;width:88px;height:30px"></td></tr>
    <tr><td style="background:#ffffff;border:1px solid ${T.sand200};border-radius:24px;padding:32px 32px 28px">
      <div style="font-family:${FONT};font-size:26px;line-height:1.15;font-weight:700;letter-spacing:-0.02em;color:${T.ink}">${o.titleHtml}</div>
      <p style="margin:12px 0 0;font-family:${BODY};font-size:16px;line-height:1.55;color:${T.sand600}">${o.bodyHtml}</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0"><tr><td align="center" bgcolor="${T.red}" style="border-radius:999px;background:linear-gradient(110deg,#e3141b 0%,#f2392a 45%,#ff6b35 100%)"><a href="${esc(o.href)}" style="display:inline-block;padding:15px 30px;font-family:${BODY};font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px">${esc(o.cta)}</a></td></tr></table>
    </td></tr>
    <tr><td style="padding:18px 8px 0;font-family:${BODY};font-size:12px;line-height:1.5;color:${T.sand400}">${esc(o.foot)}<br>Yuno · yunoapp.eu</td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

export function renderLifecycleEmail(opts: {
  copy: LifecycleCopy; lang: LifecycleLang; key: LifecycleKey; origin: string; vars?: Record<string, string>;
}): { subject: string; html: string } {
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.vars ?? {})) vars[k] = esc(v);
  const c = opts.copy;
  const subject = fill(c.subject, opts.vars ?? {});
  const html = crmEmailShell({
    lang: opts.lang, subject, titleHtml: fill(esc(c.title), vars), bodyHtml: fill(esc(c.body), vars),
    cta: c.cta, href: `${opts.origin}${LIFECYCLE_PATH[opts.key]}`, origin: opts.origin, foot: FOOT[opts.lang],
  });
  return { subject, html };
}

// ── Confirmation d'une inscription sur une Page d'inscription (fan) ─────────
const SIGNUP: Record<LifecycleLang, { subject: (t: string) => string; title: string; body: (h: string) => string; cta: string; foot: (h: string) => string }> = {
  fr: { subject: (t) => `Confirmez votre inscription · ${t}`, title: "Un clic pour confirmer",
        body: (h) => `Confirmez votre adresse pour recevoir les annonces de ${h}. Sans confirmation, vous ne recevrez rien.`,
        cta: "Je confirme", foot: (h) => `Vous recevez cet e-mail parce que cette adresse a été inscrite sur une page de ${h}. Pas vous ? Ignorez-le : rien ne sera envoyé.` },
  en: { subject: (t) => `Confirm your signup · ${t}`, title: "One click to confirm",
        body: (h) => `Confirm your address to receive announcements from ${h}. Without confirmation, you will receive nothing.`,
        cta: "I confirm", foot: (h) => `You receive this email because this address was entered on a page by ${h}. Not you? Ignore it: nothing will be sent.` },
  es: { subject: (t) => `Confirme su inscripción · ${t}`, title: "Un clic para confirmar",
        body: (h) => `Confirme su dirección para recibir los anuncios de ${h}. Sin confirmación, no recibirá nada.`,
        cta: "Confirmo", foot: (h) => `Recibe este e-mail porque esta dirección se inscribió en una página de ${h}. ¿No ha sido usted? Ignórelo: no se enviará nada.` },
};

export function renderSignupConfirmEmail(o: { lang: LifecycleLang; title: string; host: string; slug: string; token: string; origin: string }): { subject: string; html: string } {
  const c = SIGNUP[o.lang] ?? SIGNUP.fr;
  const subject = c.subject(o.title || o.host);
  const href = `${o.origin}/j/${encodeURIComponent(o.slug)}/ok?t=${encodeURIComponent(o.token)}`;
  return { subject, html: crmEmailShell({ lang: o.lang, subject, titleHtml: esc(c.title), bodyHtml: esc(c.body(o.host)), cta: c.cta, href, origin: o.origin, foot: c.foot(o.host) }) };
}
