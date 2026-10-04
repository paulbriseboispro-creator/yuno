// E-mail « ouvrez aussi l'autre produit » (Yuno Billetterie ⇄ Yuno CRM), envoyé
// par le super admin (admin-account-recovery, action invite-product). DA de Yuno
// CRM : papier clair, carte arrondie, bouton rouge → mandarine — la même que les
// e-mails d'authentification (scripts/supabase/auth-emails.mjs). Module PUR.

export type InviteLang = "fr" | "en" | "es";
export type InviteProduct = "crm" | "suite";

const T = { ink: "#1c1517", sand50: "#f7f4f3", sand200: "#e6dfdd", sand400: "#a39a98", sand500: "#857b7d", sand600: "#5e5457", red: "#e3141b" };
const FONT = `'Bricolage Grotesque','Helvetica Neue',Helvetica,Arial,sans-serif`;
const BODY = `Geist,'Helvetica Neue',Helvetica,Arial,sans-serif`;

interface Copy { subject: string; kicker: string; title: string; body: string; facts: string[]; cta: string; note: string }

const COPY: Record<InviteProduct, Record<InviteLang, Copy>> = {
  crm: {
    fr: {
      subject: "Yuno CRM est prêt pour {name}",
      kicker: "Yuno CRM",
      title: "Ouvrez Yuno CRM pour {name}",
      body: "Votre compte Yuno Billetterie peut aussi accueillir Yuno CRM : vos clients réunis, des segments prêts à l’emploi et des campagnes qui les font revenir.",
      facts: ["Même connexion, mêmes contacts", "14 jours d’essai, sans carte", "Votre Billetterie ne change pas"],
      cta: "Ouvrir Yuno CRM",
      note: "Ce lien est valable 14 jours. Connectez-vous avec le compte de {name} pour l’utiliser.",
    },
    en: {
      subject: "Yuno CRM is ready for {name}",
      kicker: "Yuno CRM",
      title: "Open Yuno CRM for {name}",
      body: "Your Yuno Ticketing account can also run Yuno CRM: your customers in one place, ready-made segments and campaigns that bring them back.",
      facts: ["Same login, same contacts", "14-day trial, no card", "Your ticketing stays as it is"],
      cta: "Open Yuno CRM",
      note: "This link is valid for 14 days. Sign in with the {name} account to use it.",
    },
    es: {
      subject: "Yuno CRM está listo para {name}",
      kicker: "Yuno CRM",
      title: "Abre Yuno CRM para {name}",
      body: "Tu cuenta de Yuno Ticketing también puede tener Yuno CRM: tus clientes reunidos, segmentos listos y campañas que los hacen volver.",
      facts: ["Mismo acceso, mismos contactos", "14 días de prueba, sin tarjeta", "Tu ticketing no cambia"],
      cta: "Abrir Yuno CRM",
      note: "Este enlace es válido 14 días. Inicia sesión con la cuenta de {name} para usarlo.",
    },
  },
  suite: {
    fr: {
      subject: "Yuno Billetterie est prêt pour {name}",
      kicker: "Yuno Billetterie",
      title: "Ouvrez Yuno Billetterie pour {name}",
      body: "Vendez vos billets, vos tables VIP et vos guest lists directement avec Yuno, sur le même compte que votre CRM.",
      facts: ["Même connexion, mêmes contacts", "Sans abonnement", "Votre CRM ne change pas"],
      cta: "Ouvrir Yuno Billetterie",
      note: "Ce lien est valable 14 jours. Connectez-vous avec le compte de {name} pour l’utiliser.",
    },
    en: {
      subject: "Yuno Ticketing is ready for {name}",
      kicker: "Yuno Ticketing",
      title: "Open Yuno Ticketing for {name}",
      body: "Sell your tickets, VIP tables and guest lists directly with Yuno, on the same account as your CRM.",
      facts: ["Same login, same contacts", "No subscription", "Your CRM stays as it is"],
      cta: "Open Yuno Ticketing",
      note: "This link is valid for 14 days. Sign in with the {name} account to use it.",
    },
    es: {
      subject: "Yuno Ticketing está listo para {name}",
      kicker: "Yuno Ticketing",
      title: "Abre Yuno Ticketing para {name}",
      body: "Vende tus entradas, mesas VIP y guest lists directamente con Yuno, en la misma cuenta que tu CRM.",
      facts: ["Mismo acceso, mismos contactos", "Sin suscripción", "Tu CRM no cambia"],
      cta: "Abrir Yuno Ticketing",
      note: "Este enlace es válido 14 días. Inicia sesión con la cuenta de {name} para usarlo.",
    },
  },
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function productInviteLang(v: unknown): InviteLang {
  return v === "en" || v === "es" ? v : "fr";
}

export function buildProductInviteEmail(opts: {
  product: InviteProduct;
  lang: InviteLang;
  name: string;
  url: string;
  origin?: string;
}): { subject: string; html: string } {
  const c = COPY[opts.product][opts.lang];
  const name = esc(opts.name || "Yuno");
  const fill = (s: string) => esc(s).replace(/\{name\}/g, name);
  const origin = opts.origin ?? "https://yunoapp.eu";
  const url = esc(opts.url);
  const facts = c.facts
    .map((f) => `<tr><td style="padding:5px 0;font-family:${BODY};font-size:15px;line-height:1.4;color:${T.ink}"><span style="color:${T.red};font-weight:700">✓</span>&nbsp;&nbsp;${esc(f)}</td></tr>`)
    .join("");
  const html = `<!DOCTYPE html>
<html lang="${opts.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>${fill(c.subject)}</title>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600..800&family=Geist:wght@400..600&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:${T.sand50}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${fill(c.body)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${T.sand50}"><tr><td align="center" style="padding:32px 16px">
  <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="width:520px;max-width:100%">
    <tr><td style="padding:0 4px 18px"><img src="${origin}/yuno-wordmark-dark.png" width="88" height="30" alt="Yuno" style="display:block;border:0;width:88px;height:30px"></td></tr>
    <tr><td style="background:#ffffff;border:1px solid ${T.sand200};border-radius:24px;padding:32px 32px 28px">
      <div style="font-family:'Geist Mono',Menlo,Consolas,monospace;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${T.red}">${esc(c.kicker)}</div>
      <div style="margin-top:10px;font-family:${FONT};font-size:26px;line-height:1.15;font-weight:700;letter-spacing:-0.02em;color:${T.ink}">${fill(c.title)}</div>
      <p style="margin:12px 0 0;font-family:${BODY};font-size:16px;line-height:1.55;color:${T.sand600}">${fill(c.body)}</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 0">${facts}</table>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0"><tr><td align="center" bgcolor="${T.red}" style="border-radius:999px;background:linear-gradient(110deg,#e3141b 0%,#f2392a 45%,#ff6b35 100%)"><a href="${url}" style="display:inline-block;padding:15px 30px;font-family:${BODY};font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px">${esc(c.cta)}</a></td></tr></table>
      <p style="margin:18px 0 0;font-family:${BODY};font-size:13px;line-height:1.5;color:${T.sand500}">${fill(c.note)}</p>
      <p style="margin:18px 0 0;font-family:${BODY};font-size:12px;line-height:1.5;color:${T.sand400};word-break:break-all"><a href="${url}" style="color:${T.sand500}">${url}</a></p>
    </td></tr>
    <tr><td style="padding:18px 8px 0;font-family:${BODY};font-size:12px;line-height:1.5;color:${T.sand400}">Yuno · yunoapp.eu</td></tr>
  </table>
</td></tr></table>
</body></html>`;
  return { subject: c.subject.replace(/\{name\}/g, opts.name || "Yuno"), html };
}
