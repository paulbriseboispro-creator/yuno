// E-mail « offre fondateurs » de Yuno CRM (migration 20261017230000) : le super
// admin l'envoie depuis Admin CRM › Vente › Offre fondateurs (edge
// admin-account-recovery, action crm-founder-offer-email). DA de Yuno CRM :
// papier clair, carte arrondie, bouton rouge → mandarine, comme
// product-invite-email.ts. Module PUR : testé tel quel par le front.

export type FounderLang = "fr" | "en" | "es";

interface Copy {
  subject: string;
  preheader: string;
  kicker: string;
  hello: string;
  helloNamed: string;
  title: string;
  body: string;
  facts: string[];
  cta: string;
  note: string;
  sign: string;
}

const COPY: Record<FounderLang, Copy> = {
  fr: {
    subject: "{org} × Yuno CRM : votre offre fondateur",
    preheader: "{months} mois offerts et {yunits} Yunits pour démarrer. Aucune carte demandée.",
    kicker: "Offre fondateur · 5 places",
    hello: "Bonjour,",
    helloNamed: "Bonjour {first},",
    title: "{months} mois de Yuno CRM offerts à {org}",
    body: "Comme convenu, voici votre accès. Vous faites partie des 5 premiers comptes que nous accompagnons nous-mêmes : créez votre compte avec ce lien, l’offre s’applique toute seule.",
    facts: [
      "{months} mois d’abonnement offerts, à partir de l’ouverture du compte",
      "{yunits} Yunits offerts à l’ouverture du compte",
      "Ensuite {price} € HT / mois, prix de lancement garanti",
      "Aucune carte demandée pour commencer",
    ],
    cta: "Créer mon compte",
    note: "Ce lien vous est réservé et fonctionne une seule fois, jusqu’au {expires}.",
    sign: "Paul, fondateur de Yuno",
  },
  en: {
    subject: "{org} × Yuno CRM: your founder offer",
    preheader: "{months} months free and {yunits} Yunits to start. No card needed.",
    kicker: "Founder offer · 5 spots",
    hello: "Hi,",
    helloNamed: "Hi {first},",
    title: "{months} months of Yuno CRM free for {org}",
    body: "As agreed, here is your access. You are one of the first 5 accounts we onboard ourselves: create your account with this link and the offer applies automatically.",
    facts: [
      "{months} months of subscription free, from the day the account opens",
      "{yunits} Yunits offered when the account opens",
      "Then €{price} excl. VAT / month, launch price guaranteed",
      "No card needed to start",
    ],
    cta: "Create my account",
    note: "This link is yours alone and works once, until {expires}.",
    sign: "Paul, founder of Yuno",
  },
  es: {
    subject: "{org} × Yuno CRM: su oferta fundador",
    preheader: "{months} meses gratis y {yunits} Yunits para empezar. Sin tarjeta.",
    kicker: "Oferta fundador · 5 plazas",
    hello: "Hola:",
    helloNamed: "Hola, {first}:",
    title: "{months} meses de Yuno CRM gratis para {org}",
    body: "Como acordamos, aquí tiene su acceso. Forma parte de las 5 primeras cuentas que acompañamos nosotros mismos: cree su cuenta con este enlace y la oferta se aplica sola.",
    facts: [
      "{months} meses de suscripción gratis, desde que abra la cuenta",
      "{yunits} Yunits de regalo al abrir la cuenta",
      "Después {price} € sin IVA / mes, precio de lanzamiento garantizado",
      "Sin tarjeta para empezar",
    ],
    cta: "Crear mi cuenta",
    note: "Este enlace es solo para usted y funciona una vez, hasta el {expires}.",
    sign: "Paul, fundador de Yuno",
  },
};

const T = { ink: "#1c1517", sand50: "#f7f4f3", sand100: "#efebea", sand200: "#e6dfdd", sand400: "#a39a98", sand500: "#857b7d", sand600: "#5e5457", red: "#e3141b" };
const FONT = `'Bricolage Grotesque','Helvetica Neue',Helvetica,Arial,sans-serif`;
const BODY = `Geist,'Helvetica Neue',Helvetica,Arial,sans-serif`;
const LOCALE: Record<FounderLang, string> = { fr: "fr-FR", en: "en-GB", es: "es-ES" };

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function founderLang(v: unknown): FounderLang {
  return v === "en" || v === "es" ? v : "fr";
}

/** Date en toutes lettres, au fuseau de Paris (« 17 avril 2027 »). */
export function founderDate(iso: string, lang: FounderLang): string {
  return new Date(iso).toLocaleDateString(LOCALE[lang], { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" });
}

export interface FounderEmailInput {
  lang: FounderLang;
  orgName: string;
  contactName?: string | null;
  url: string;
  freeMonths: number;
  yunits: number;
  priceMonth: number;
  expiresAt: string;
  origin?: string;
}

export function buildFounderOfferEmail(o: FounderEmailInput): { subject: string; html: string; text: string } {
  const c = COPY[o.lang];
  const nf = new Intl.NumberFormat(LOCALE[o.lang]);
  const first = (o.contactName ?? "").trim().split(/\s+/)[0] ?? "";
  const vars: Record<string, string> = {
    org: o.orgName || "Yuno",
    first,
    months: String(o.freeMonths),
    yunits: nf.format(o.yunits),
    price: nf.format(o.priceMonth),
    expires: founderDate(o.expiresAt, o.lang),
  };
  const raw = (s: string) => s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m));
  const fill = (s: string) => esc(raw(s));
  const origin = o.origin ?? "https://yunoapp.eu";
  const url = esc(o.url);
  const hello = first ? c.helloNamed : c.hello;
  const facts = c.facts
    .map((f) => `<tr><td style="padding:6px 0;font-family:${BODY};font-size:15px;line-height:1.4;color:${T.ink}"><span style="color:${T.red};font-weight:700">✓</span>&nbsp;&nbsp;${fill(f)}</td></tr>`)
    .join("");
  const subject = raw(c.subject);
  const html = `<!DOCTYPE html>
<html lang="${o.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>${esc(subject)}</title>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600..800&family=Geist:wght@400..600&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:${T.sand50}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${fill(c.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${T.sand50}"><tr><td align="center" style="padding:32px 16px">
  <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="width:520px;max-width:100%">
    <tr><td style="padding:0 4px 18px"><img src="${origin}/yuno-wordmark-dark.png" width="88" height="30" alt="Yuno" style="display:block;border:0;width:88px;height:30px"></td></tr>
    <tr><td style="background:#ffffff;border:1px solid ${T.sand200};border-radius:24px;padding:32px 32px 28px">
      <div style="font-family:'Geist Mono',Menlo,Consolas,monospace;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${T.red}">${esc(c.kicker)}</div>
      <div style="margin-top:10px;font-family:${FONT};font-size:26px;line-height:1.15;font-weight:700;letter-spacing:-0.02em;color:${T.ink}">${fill(c.title)}</div>
      <p style="margin:14px 0 0;font-family:${BODY};font-size:16px;line-height:1.55;color:${T.ink}">${fill(hello)}</p>
      <p style="margin:8px 0 0;font-family:${BODY};font-size:16px;line-height:1.55;color:${T.sand600}">${fill(c.body)}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 0;background:${T.sand50};border-radius:16px"><tr><td style="padding:12px 18px"><table role="presentation" cellpadding="0" cellspacing="0" border="0">${facts}</table></td></tr></table>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0"><tr><td align="center" bgcolor="${T.red}" style="border-radius:999px;background:linear-gradient(110deg,#e3141b 0%,#f2392a 45%,#ff6b35 100%)"><a href="${url}" style="display:inline-block;padding:15px 30px;font-family:${BODY};font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px">${esc(c.cta)}</a></td></tr></table>
      <p style="margin:18px 0 0;font-family:${BODY};font-size:13px;line-height:1.5;color:${T.sand500}">${fill(c.note)}</p>
      <p style="margin:18px 0 0;font-family:${BODY};font-size:15px;line-height:1.5;color:${T.ink}">${esc(c.sign)}</p>
      <p style="margin:18px 0 0;font-family:${BODY};font-size:12px;line-height:1.5;color:${T.sand400};word-break:break-all"><a href="${url}" style="color:${T.sand500}">${url}</a></p>
    </td></tr>
    <tr><td style="padding:18px 8px 0;font-family:${BODY};font-size:12px;line-height:1.5;color:${T.sand400}">Yuno · yunoapp.eu</td></tr>
  </table>
</td></tr></table>
</body></html>`;
  const text = [
    raw(c.title), "", raw(hello), raw(c.body), "", ...c.facts.map((f) => `• ${raw(f)}`), "",
    `${c.cta} : ${o.url}`, "", raw(c.note), "", c.sign,
  ].join("\n");
  return { subject, html, text };
}

/** Le message WhatsApp que l'admin envoie (même promesse que l'e-mail, en texte). */
export function founderOfferWhatsAppText(o: Omit<FounderEmailInput, "origin">): string {
  const c = COPY[o.lang];
  const first = (o.contactName ?? "").trim().split(/\s+/)[0] ?? "";
  const nf = new Intl.NumberFormat(LOCALE[o.lang]);
  const vars: Record<string, string> = {
    org: o.orgName || "Yuno", first, months: String(o.freeMonths), yunits: nf.format(o.yunits), price: nf.format(o.priceMonth),
    expires: founderDate(o.expiresAt, o.lang),
  };
  const raw = (s: string) => s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m));
  return [
    raw(first ? c.helloNamed : c.hello), "", raw(c.body), "", ...c.facts.map((f) => `✓ ${raw(f)}`), "",
    o.url, "", raw(c.note), c.sign,
  ].join("\n");
}
