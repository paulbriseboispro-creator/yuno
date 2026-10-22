// E-mails que le super admin envoie depuis l'Admin CRM (migration
// 20261019420000) : l'invitation à ouvrir un compte Yuno CRM (offre
// fondateurs ou essai standard, avec l'accès démo et l'accès assisté en
// option), l'accès à la démo, et la demande d'accès assisté d'un compte CRM.
// DA de Yuno CRM : papier clair, carte arrondie, bouton rouge → mandarine,
// comme crm-founder-offer-email.ts. Module PUR : testé tel quel par le front,
// qui en tire aussi les messages WhatsApp.

export type CrmLang = "fr" | "en" | "es";
export type CrmInviteOffer = "founder" | "standard";

const T = { ink: "#1c1517", sand50: "#f7f4f3", sand100: "#efebea", sand200: "#e6dfdd", sand400: "#a39a98", sand500: "#857b7d", sand600: "#5e5457", red: "#e3141b" };
const FONT = `'Bricolage Grotesque','Helvetica Neue',Helvetica,Arial,sans-serif`;
const BODY = `Geist,'Helvetica Neue',Helvetica,Arial,sans-serif`;
const MONO = `'Geist Mono',Menlo,Consolas,monospace`;
const LOCALE: Record<CrmLang, string> = { fr: "fr-FR", en: "en-GB", es: "es-ES" };

export function crmLang(v: unknown): CrmLang {
  return v === "en" || v === "es" ? v : "fr";
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Date en toutes lettres, au fuseau de Paris (« 17 avril 2027 »). */
export function crmDate(iso: string, lang: CrmLang): string {
  return new Date(iso).toLocaleDateString(LOCALE[lang], { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" });
}

/** Prénom d'un « Prénom Nom » (vide sans contact). */
export function firstNameOf(contact: string | null | undefined): string {
  return (contact ?? "").trim().split(/\s+/)[0] ?? "";
}

type Vars = Record<string, string>;
/** « Libellé : valeur » à la française, « Label: value » ailleurs. */
const sep = (lang: CrmLang) => (lang === "fr" ? " : " : ": ");
const rawFill = (s: string, vars: Vars) => s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m));

// ── La mise en page commune ────────────────────────────────────────────────
interface Layout {
  lang: CrmLang;
  subject: string;
  preheader: string;
  kicker: string;
  title: string;
  hello: string;
  body: string;
  facts?: string[];
  /** Encadré sous les faits (mot de passe de la démo, accès assisté…), en HTML déjà échappé. */
  boxes?: string[];
  cta: string;
  url: string;
  /** Lien secondaire sous le bouton (déjà échappé). */
  after?: string;
  note?: string;
  sign: string;
  origin?: string;
}

function layout(o: Layout): string {
  const origin = o.origin ?? "https://yunoapp.eu";
  const url = esc(o.url);
  const facts = (o.facts ?? [])
    .map((f) => `<tr><td style="padding:6px 0;font-family:${BODY};font-size:15px;line-height:1.4;color:${T.ink}"><span style="color:${T.red};font-weight:700">✓</span>&nbsp;&nbsp;${esc(f)}</td></tr>`)
    .join("");
  const factsBlock = facts
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 0;background:${T.sand50};border-radius:16px"><tr><td style="padding:12px 18px"><table role="presentation" cellpadding="0" cellspacing="0" border="0">${facts}</table></td></tr></table>`
    : "";
  const boxes = (o.boxes ?? []).join("");
  return `<!DOCTYPE html>
<html lang="${o.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>${esc(o.subject)}</title>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600..800&family=Geist:wght@400..600&family=Geist+Mono:wght@500&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:${T.sand50}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(o.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${T.sand50}"><tr><td align="center" style="padding:32px 16px">
  <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="width:520px;max-width:100%">
    <tr><td style="padding:0 4px 18px"><img src="${origin}/yuno-wordmark-dark.png" width="88" height="30" alt="Yuno" style="display:block;border:0;width:88px;height:30px"></td></tr>
    <tr><td style="background:#ffffff;border:1px solid ${T.sand200};border-radius:24px;padding:32px 32px 28px">
      <div style="font-family:${MONO};font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${T.red}">${esc(o.kicker)}</div>
      <div style="margin-top:10px;font-family:${FONT};font-size:26px;line-height:1.15;font-weight:700;letter-spacing:-0.02em;color:${T.ink}">${esc(o.title)}</div>
      <p style="margin:14px 0 0;font-family:${BODY};font-size:16px;line-height:1.55;color:${T.ink}">${esc(o.hello)}</p>
      <p style="margin:8px 0 0;font-family:${BODY};font-size:16px;line-height:1.55;color:${T.sand600}">${esc(o.body)}</p>
      ${factsBlock}${boxes}
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0"><tr><td align="center" bgcolor="${T.red}" style="border-radius:999px;background:linear-gradient(110deg,#e3141b 0%,#f2392a 45%,#ff6b35 100%)"><a href="${url}" style="display:inline-block;padding:15px 30px;font-family:${BODY};font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px">${esc(o.cta)}</a></td></tr></table>
      ${o.after ?? ""}
      ${o.note ? `<p style="margin:18px 0 0;font-family:${BODY};font-size:13px;line-height:1.5;color:${T.sand500}">${esc(o.note)}</p>` : ""}
      <p style="margin:18px 0 0;font-family:${BODY};font-size:15px;line-height:1.5;color:${T.ink}">${esc(o.sign)}</p>
      <p style="margin:18px 0 0;font-family:${BODY};font-size:12px;line-height:1.5;color:${T.sand400};word-break:break-all"><a href="${url}" style="color:${T.sand500}">${url}</a></p>
    </td></tr>
    <tr><td style="padding:18px 8px 0;font-family:${BODY};font-size:12px;line-height:1.5;color:${T.sand400}">Yuno · yunoapp.eu</td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

/** Un encadré clair : titre en capitales, lignes de texte, lien facultatif. */
function box(title: string, lines: string[], link?: { label: string; url: string }): string {
  const body = lines.map((l) => `<div style="margin-top:6px;font-family:${BODY};font-size:14.5px;line-height:1.5;color:${T.ink}">${l}</div>`).join("");
  const a = link ? `<div style="margin-top:10px"><a href="${esc(link.url)}" style="font-family:${BODY};font-size:14.5px;font-weight:600;color:${T.red};text-decoration:none">${esc(link.label)} →</a></div>` : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0 0;border:1px solid ${T.sand200};border-radius:16px"><tr><td style="padding:14px 18px"><div style="font-family:${MONO};font-size:11.5px;letter-spacing:.08em;text-transform:uppercase;color:${T.sand500}">${esc(title)}</div>${body}${a}</td></tr></table>`;
}

const pw = (p: string) => `<span style="font-family:${MONO};font-size:15px;font-weight:600;letter-spacing:.06em;background:${T.sand100};border-radius:8px;padding:3px 8px">${esc(p)}</span>`;

// ── Invitation à ouvrir un compte Yuno CRM ─────────────────────────────────
interface InviteCopy {
  subject: string; preheader: string; kicker: string; hello: string; helloNamed: string; title: string; body: string;
  facts: string[]; cta: string; note: string;
}

const FOUNDER: Record<CrmLang, InviteCopy> = {
  fr: {
    subject: "{org} × Yuno CRM : votre offre fondateur",
    preheader: "{months} mois offerts et {yunits} Yunits pour démarrer. Aucune carte demandée.",
    kicker: "Offre fondateur · 5 places",
    hello: "Bonjour,", helloNamed: "Bonjour {first},",
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
  },
  en: {
    subject: "{org} × Yuno CRM: your founder offer",
    preheader: "{months} months free and {yunits} Yunits to start. No card needed.",
    kicker: "Founder offer · 5 spots",
    hello: "Hi,", helloNamed: "Hi {first},",
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
  },
  es: {
    subject: "{org} × Yuno CRM: su oferta fundador",
    preheader: "{months} meses gratis y {yunits} Yunits para empezar. Sin tarjeta.",
    kicker: "Oferta fundador · 5 plazas",
    hello: "Hola:", helloNamed: "Hola, {first}:",
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
  },
};

const STANDARD: Record<CrmLang, InviteCopy> = {
  fr: {
    subject: "{org}, votre compte Yuno CRM vous attend",
    preheader: "{trialDays} jours d’essai et {trialYunits} Yunits offerts. Aucune carte demandée.",
    kicker: "Invitation · Yuno CRM",
    hello: "Bonjour,", helloNamed: "Bonjour {first},",
    title: "Yuno CRM, préparé pour {org}",
    body: "Comme convenu, voici votre accès. Votre compte est déjà préparé : créez-le avec ce lien, vos informations sont pré-remplies.",
    facts: [
      "{trialDays} jours d’essai, sans carte bancaire",
      "{trialYunits} Yunits offerts pendant l’essai pour vos premiers envois",
      "Vos acheteurs, vos soirées et vos envois réunis au même endroit",
      "Ensuite {price} € HT / mois, sans engagement",
    ],
    cta: "Créer mon compte",
    note: "Ce lien vous est réservé, jusqu’au {expires}.",
  },
  en: {
    subject: "{org}, your Yuno CRM account is ready",
    preheader: "{trialDays}-day trial and {trialYunits} Yunits offered. No card needed.",
    kicker: "Invitation · Yuno CRM",
    hello: "Hi,", helloNamed: "Hi {first},",
    title: "Yuno CRM, set up for {org}",
    body: "As agreed, here is your access. Your account is already prepared: create it with this link, your details are filled in.",
    facts: [
      "{trialDays}-day trial, no card needed",
      "{trialYunits} Yunits offered during the trial for your first sends",
      "Your buyers, your nights and your sends in one place",
      "Then €{price} excl. VAT / month, no commitment",
    ],
    cta: "Create my account",
    note: "This link is yours alone, until {expires}.",
  },
  es: {
    subject: "{org}, su cuenta de Yuno CRM le espera",
    preheader: "{trialDays} días de prueba y {trialYunits} Yunits de regalo. Sin tarjeta.",
    kicker: "Invitación · Yuno CRM",
    hello: "Hola:", helloNamed: "Hola, {first}:",
    title: "Yuno CRM, preparado para {org}",
    body: "Como acordamos, aquí tiene su acceso. Su cuenta ya está preparada: créela con este enlace, sus datos ya están rellenados.",
    facts: [
      "{trialDays} días de prueba, sin tarjeta",
      "{trialYunits} Yunits de regalo durante la prueba para sus primeros envíos",
      "Sus compradores, sus noches y sus envíos en un solo lugar",
      "Después {price} € sin IVA / mes, sin permanencia",
    ],
    cta: "Crear mi cuenta",
    note: "Este enlace es solo para usted, hasta el {expires}.",
  },
};

const EXTRA: Record<CrmLang, { demoT: string; demoL: string; demoPw: string; demoCta: string; supportT: string; supportB: string; sign: string }> = {
  fr: {
    demoT: "Avant de vous lancer : la démo",
    demoL: "Explorez un compte Yuno CRM déjà rempli (soirées, clients et campagnes fictifs), en lecture seule.",
    demoPw: "Mot de passe : {pw}",
    demoCta: "Ouvrir la démo",
    supportT: "On configure avec vous",
    supportB: "Si vous le souhaitez, l’équipe Yuno met votre compte en place avec vous. Vous accepterez (ou non) son accès depuis votre Console, et vous le coupez quand vous voulez.",
    sign: "Paul, fondateur de Yuno",
  },
  en: {
    demoT: "Before you start: the demo",
    demoL: "Explore a Yuno CRM account that is already filled in (fictional nights, clients and campaigns), read-only.",
    demoPw: "Password: {pw}",
    demoCta: "Open the demo",
    supportT: "We set it up with you",
    supportB: "If you like, the Yuno team sets up your account with you. You approve (or not) its access from your Console, and you can cut it anytime.",
    sign: "Paul, founder of Yuno",
  },
  es: {
    demoT: "Antes de empezar: la demo",
    demoL: "Explore una cuenta de Yuno CRM ya rellenada (noches, clientes y campañas ficticios), en solo lectura.",
    demoPw: "Contraseña: {pw}",
    demoCta: "Abrir la demo",
    supportT: "Lo configuramos con usted",
    supportB: "Si lo desea, el equipo de Yuno pone su cuenta en marcha con usted. Usted aprueba (o no) su acceso desde su Consola y lo corta cuando quiera.",
    sign: "Paul, fundador de Yuno",
  },
};

// ── Tutoiement : la version « à l'aise » du message d'invitation ───────────
// Le vouvoiement reste le texte de référence (e-mail, message sérieux). Le
// tutoiement ne réécrit que ce qui change (formules d'adresse, pronoms) ; tout
// le reste, chiffres compris, vient du même texte : une promesse ne peut pas
// diverger d'un ton à l'autre. L'anglais n'a qu'une forme.
export type CrmTone = "formal" | "casual";
type Extra = (typeof EXTRA)["fr"];
type CasualLang = "fr" | "es";

const FOUNDER_CASUAL: Record<CasualLang, Partial<InviteCopy>> = {
  fr: {
    hello: "Salut,", helloNamed: "Salut {first},",
    body: "Comme on en a parlé, voici ton accès. Tu fais partie des 5 premiers comptes qu’on accompagne nous-mêmes : crée ton compte avec ce lien, l’offre s’applique toute seule.",
    note: "Ce lien t’est réservé et ne marche qu’une fois, jusqu’au {expires}.",
  },
  es: {
    hello: "Hola:", helloNamed: "Hola, {first}:",
    body: "Como hablamos, aquí tienes tu acceso. Eres una de las 5 primeras cuentas que acompañamos nosotros mismos: crea tu cuenta con este enlace y la oferta se aplica sola.",
    facts: [
      "{months} meses de suscripción gratis, desde que abras la cuenta",
      "{yunits} Yunits de regalo al abrir la cuenta",
      "Después {price} € sin IVA / mes, precio de lanzamiento garantizado",
      "Sin tarjeta para empezar",
    ],
    note: "Este enlace es solo para ti y funciona una vez, hasta el {expires}.",
  },
};

const STANDARD_CASUAL: Record<CasualLang, Partial<InviteCopy>> = {
  fr: {
    hello: "Salut,", helloNamed: "Salut {first},",
    body: "Comme on en a parlé, voici ton accès. Ton compte est déjà prêt : crée-le avec ce lien, tes informations sont pré-remplies.",
    facts: [
      "{trialDays} jours d’essai, sans carte bancaire",
      "{trialYunits} Yunits offerts pendant l’essai pour tes premiers envois",
      "Tes acheteurs, tes soirées et tes envois réunis au même endroit",
      "Ensuite {price} € HT / mois, sans engagement",
    ],
    note: "Ce lien t’est réservé, jusqu’au {expires}.",
  },
  es: {
    hello: "Hola:", helloNamed: "Hola, {first}:",
    body: "Como hablamos, aquí tienes tu acceso. Tu cuenta ya está preparada: créala con este enlace, tus datos ya están rellenados.",
    facts: [
      "{trialDays} días de prueba, sin tarjeta",
      "{trialYunits} Yunits de regalo durante la prueba para tus primeros envíos",
      "Tus compradores, tus noches y tus envíos en un solo lugar",
      "Después {price} € sin IVA / mes, sin permanencia",
    ],
    note: "Este enlace es solo para ti, hasta el {expires}.",
  },
};

const EXTRA_CASUAL: Record<CasualLang, Partial<Extra>> = {
  fr: {
    demoT: "Avant de te lancer : la démo",
    demoL: "Explore un compte Yuno CRM déjà rempli (soirées, clients et campagnes fictifs), en lecture seule.",
    supportT: "On configure avec toi",
    supportB: "Si tu veux, l’équipe Yuno met ton compte en place avec toi. Tu acceptes (ou non) son accès depuis ta Console, et tu le coupes quand tu veux.",
  },
  es: {
    demoT: "Antes de empezar: la demo",
    demoL: "Explora una cuenta de Yuno CRM ya rellenada (noches, clientes y campañas ficticios), en solo lectura.",
    supportT: "Lo configuramos contigo",
    supportB: "Si quieres, el equipo de Yuno pone tu cuenta en marcha contigo. Tú apruebas (o no) su acceso desde tu Consola y lo cortas cuando quieras.",
  },
};

export interface CrmInviteEmailInput {
  lang: CrmLang;
  offer: CrmInviteOffer;
  orgName: string;
  contactName?: string | null;
  url: string;
  freeMonths: number;
  yunits: number;
  priceMonth: number;
  trialDays?: number;
  trialYunits?: number;
  expiresAt: string;
  supportOffer?: boolean;
  demo?: { url: string; password: string } | null;
  origin?: string;
}

function inviteVars(o: CrmInviteEmailInput): Vars {
  const nf = new Intl.NumberFormat(LOCALE[o.lang]);
  return {
    org: o.orgName || "Yuno",
    first: firstNameOf(o.contactName),
    months: String(o.freeMonths),
    yunits: nf.format(o.yunits),
    price: nf.format(o.priceMonth),
    trialDays: String(o.trialDays ?? 14),
    trialYunits: nf.format(o.trialYunits ?? 2000),
    expires: crmDate(o.expiresAt, o.lang),
  };
}

export function buildCrmInviteEmail(o: CrmInviteEmailInput): { subject: string; html: string; text: string } {
  const c = (o.offer === "founder" ? FOUNDER : STANDARD)[o.lang];
  const x = EXTRA[o.lang];
  const vars = inviteVars(o);
  const f = (s: string) => rawFill(s, vars);
  const hello = f(vars.first ? c.helloNamed : c.hello);
  const boxes: string[] = [];
  if (o.demo) {
    boxes.push(box(x.demoT, [esc(x.demoL), rawFill(esc(x.demoPw), { pw: pw(o.demo.password) })], { label: x.demoCta, url: o.demo.url }));
  }
  if (o.supportOffer) boxes.push(box(x.supportT, [esc(x.supportB)]));
  const subject = f(c.subject);
  const html = layout({
    lang: o.lang, subject, preheader: f(c.preheader), kicker: c.kicker, title: f(c.title), hello, body: f(c.body),
    facts: c.facts.map(f), boxes, cta: c.cta, url: o.url, note: f(c.note), sign: x.sign, origin: o.origin,
  });
  const text = [
    f(c.title), "", hello, f(c.body), "", ...c.facts.map((s) => `• ${f(s)}`), "",
    `${c.cta}${sep(o.lang)}${o.url}`,
    ...(o.demo ? ["", x.demoT, x.demoL, `${o.demo.url}`, rawFill(x.demoPw, { pw: o.demo.password })] : []),
    ...(o.supportOffer ? ["", x.supportT, x.supportB] : []),
    "", f(c.note), "", x.sign,
  ].join("\n");
  return { subject, html, text };
}

/** Le message WhatsApp de l'invitation (même promesse que l'e-mail, en texte). */
export function crmInviteWhatsAppText(o: Omit<CrmInviteEmailInput, "origin"> & { tone?: CrmTone }): string {
  const casual = o.tone === "casual" && o.lang !== "en" ? (o.lang as CasualLang) : null;
  const base = (o.offer === "founder" ? FOUNDER : STANDARD)[o.lang];
  const c: InviteCopy = casual ? { ...base, ...(o.offer === "founder" ? FOUNDER_CASUAL : STANDARD_CASUAL)[casual] } : base;
  const x: Extra = casual ? { ...EXTRA[o.lang], ...EXTRA_CASUAL[casual] } : EXTRA[o.lang];
  const vars = inviteVars(o);
  const f = (s: string) => rawFill(s, vars);
  return [
    f(vars.first ? c.helloNamed : c.hello), "", f(c.body), "", ...c.facts.map((s) => `✓ ${f(s)}`), "",
    o.url,
    ...(o.demo ? ["", `${x.demoT}${sep(o.lang)}${o.demo.url}`, rawFill(x.demoPw, { pw: o.demo.password })] : []),
    ...(o.supportOffer ? ["", x.supportB] : []),
    "", f(c.note), x.sign,
  ].join("\n");
}

// ── Accès à la démo ─────────────────────────────────────────────────────────
const DEMO: Record<CrmLang, { subject: string; preheader: string; kicker: string; hello: string; helloNamed: string; title: string; body: string; facts: string[]; pwT: string; cta: string; signup: string; note: string }> = {
  fr: {
    subject: "Votre accès à la démo de Yuno CRM",
    preheader: "Un vrai compte Yuno CRM à explorer, en lecture seule.",
    kicker: "Démo · Yuno CRM",
    hello: "Bonjour,", helloNamed: "Bonjour {first},",
    title: "Découvrez Yuno CRM sur un compte complet",
    body: "Voici votre accès à notre compte de démonstration : la Console de Yuno CRM telle qu’un club l’utilise, avec des soirées, des clients et des campagnes fictifs.",
    facts: [
      "Tout est en lecture seule : rien ne part, rien ne se modifie",
      "Vos clients, segments, e-mails, SMS et analyses, écran par écran",
      "Accès valable jusqu’au {expires}",
    ],
    pwT: "Votre mot de passe",
    cta: "Ouvrir la démo",
    signup: "Prêt à vous lancer ? Créer mon compte",
    note: "Cet accès vous est personnel : merci de ne pas le partager.",
  },
  en: {
    subject: "Your access to the Yuno CRM demo",
    preheader: "A real Yuno CRM account to explore, read-only.",
    kicker: "Demo · Yuno CRM",
    hello: "Hi,", helloNamed: "Hi {first},",
    title: "Discover Yuno CRM on a full account",
    body: "Here is your access to our demo account: the Yuno CRM Console as a club uses it, with fictional nights, clients and campaigns.",
    facts: [
      "Everything is read-only: nothing is sent, nothing changes",
      "Your clients, segments, emails, SMS and analytics, screen by screen",
      "Access valid until {expires}",
    ],
    pwT: "Your password",
    cta: "Open the demo",
    signup: "Ready to start? Create my account",
    note: "This access is personal: please don’t share it.",
  },
  es: {
    subject: "Su acceso a la demo de Yuno CRM",
    preheader: "Una cuenta real de Yuno CRM para explorar, en solo lectura.",
    kicker: "Demo · Yuno CRM",
    hello: "Hola:", helloNamed: "Hola, {first}:",
    title: "Descubra Yuno CRM en una cuenta completa",
    body: "Aquí tiene su acceso a nuestra cuenta de demostración: la Consola de Yuno CRM tal como la usa un club, con noches, clientes y campañas ficticios.",
    facts: [
      "Todo es de solo lectura: no sale nada, no se modifica nada",
      "Sus clientes, segmentos, e-mails, SMS y análisis, pantalla por pantalla",
      "Acceso válido hasta el {expires}",
    ],
    pwT: "Su contraseña",
    cta: "Abrir la demo",
    signup: "¿Listo para empezar? Crear mi cuenta",
    note: "Este acceso es personal: no lo comparta, por favor.",
  },
};

export interface CrmDemoEmailInput {
  lang: CrmLang;
  contactName?: string | null;
  url: string;
  password: string;
  expiresAt: string;
  signupUrl?: string | null;
  origin?: string;
}

export function buildCrmDemoEmail(o: CrmDemoEmailInput): { subject: string; html: string; text: string } {
  const c = DEMO[o.lang];
  const vars: Vars = { first: firstNameOf(o.contactName), expires: crmDate(o.expiresAt, o.lang) };
  const f = (s: string) => rawFill(s, vars);
  const hello = f(vars.first ? c.helloNamed : c.hello);
  const after = o.signupUrl
    ? `<p style="margin:16px 0 0;font-family:${BODY};font-size:14.5px;line-height:1.5"><a href="${esc(o.signupUrl)}" style="color:${T.red};font-weight:600;text-decoration:none">${esc(c.signup)} →</a></p>`
    : "";
  const html = layout({
    lang: o.lang, subject: c.subject, preheader: c.preheader, kicker: c.kicker, title: c.title, hello, body: c.body,
    facts: c.facts.map(f), boxes: [box(c.pwT, [pw(o.password)])], cta: c.cta, url: o.url, after, note: c.note,
    sign: EXTRA[o.lang].sign, origin: o.origin,
  });
  const text = [
    c.title, "", hello, c.body, "", ...c.facts.map((s) => `• ${f(s)}`), "",
    `${c.cta}${sep(o.lang)}${o.url}`, `${c.pwT}${sep(o.lang)}${o.password}`,
    ...(o.signupUrl ? ["", `${c.signup}${sep(o.lang)}${o.signupUrl}`] : []),
    "", c.note, "", EXTRA[o.lang].sign,
  ].join("\n");
  return { subject: c.subject, html, text };
}

export function crmDemoWhatsAppText(o: Omit<CrmDemoEmailInput, "origin">): string {
  const c = DEMO[o.lang];
  const vars: Vars = { first: firstNameOf(o.contactName), expires: crmDate(o.expiresAt, o.lang) };
  const f = (s: string) => rawFill(s, vars);
  return [
    f(vars.first ? c.helloNamed : c.hello), "", c.body, "", ...c.facts.map((s) => `✓ ${f(s)}`), "",
    o.url, `${c.pwT}${sep(o.lang)}${o.password}`,
    ...(o.signupUrl ? ["", `${c.signup}${sep(o.lang)}${o.signupUrl}`] : []),
    "", EXTRA[o.lang].sign,
  ].join("\n");
}

// ── Demande d'accès assisté (compte Yuno CRM) ──────────────────────────────
const SUPPORT: Record<CrmLang, { subject: string; preheader: string; kicker: string; hello: string; helloNamed: string; title: string; body: string; reason: string; facts: string[]; cta: string; note: string }> = {
  fr: {
    subject: "Yuno propose de configurer votre compte Yuno CRM avec vous",
    preheader: "Rien ne s’ouvre sans votre accord.",
    kicker: "Accès assisté · Yuno CRM",
    hello: "Bonjour,", helloNamed: "Bonjour {first},",
    title: "L’équipe Yuno vous propose son aide",
    body: "Nous demandons votre accord pour ouvrir un accès d’assistance à votre compte Yuno CRM et tout configurer avec vous : connexion de votre billetterie, imports, premiers e-mails.",
    reason: "Motif : {reason}",
    facts: [
      "Rien ne s’ouvre tant que vous n’avez pas accepté",
      "Votre facturation, votre e-mail de connexion et votre double authentification restent verrouillés",
      "Chaque action est journalisée et visible dans votre Console",
      "Vous coupez l’accès quand vous voulez",
    ],
    cta: "Examiner la demande",
    note: "Si vous n’êtes pas à l’origine de ce contact, ignorez cet e-mail : rien ne s’ouvrira.",
  },
  en: {
    subject: "Yuno offers to set up your Yuno CRM account with you",
    preheader: "Nothing opens without your approval.",
    kicker: "Assisted access · Yuno CRM",
    hello: "Hi,", helloNamed: "Hi {first},",
    title: "The Yuno team offers to help",
    body: "We are asking for your approval to open a support access to your Yuno CRM account and set everything up with you: your ticketing connection, imports, first emails.",
    reason: "Reason: {reason}",
    facts: [
      "Nothing opens until you approve",
      "Your billing, login email and two-factor stay locked",
      "Every action is logged and visible in your Console",
      "You can cut the access anytime",
    ],
    cta: "Review the request",
    note: "If you weren’t expecting this, just ignore this email: nothing will open.",
  },
  es: {
    subject: "Yuno propone configurar su cuenta de Yuno CRM con usted",
    preheader: "Nada se abre sin su aprobación.",
    kicker: "Acceso asistido · Yuno CRM",
    hello: "Hola:", helloNamed: "Hola, {first}:",
    title: "El equipo de Yuno le ofrece su ayuda",
    body: "Pedimos su aprobación para abrir un acceso de asistencia a su cuenta de Yuno CRM y configurarlo todo con usted: conexión de su ticketera, importaciones, primeros e-mails.",
    reason: "Motivo: {reason}",
    facts: [
      "Nada se abre hasta que usted lo acepte",
      "Su facturación, su e-mail de acceso y su doble factor permanecen bloqueados",
      "Cada acción queda registrada y visible en su Consola",
      "Puede cortar el acceso cuando quiera",
    ],
    cta: "Revisar la solicitud",
    note: "Si no esperaba este contacto, ignore este e-mail: no se abrirá nada.",
  },
};

export interface CrmSupportEmailInput {
  lang: CrmLang;
  contactName?: string | null;
  reason?: string | null;
  url: string;
  origin?: string;
}

export function buildCrmSupportEmail(o: CrmSupportEmailInput): { subject: string; html: string; text: string } {
  const c = SUPPORT[o.lang];
  const vars: Vars = { first: firstNameOf(o.contactName), reason: (o.reason ?? "").trim() };
  const f = (s: string) => rawFill(s, vars);
  const hello = f(vars.first ? c.helloNamed : c.hello);
  const body = vars.reason ? `${c.body} ${f(c.reason)}` : c.body;
  const html = layout({
    lang: o.lang, subject: c.subject, preheader: c.preheader, kicker: c.kicker, title: c.title, hello, body,
    facts: c.facts, cta: c.cta, url: o.url, note: c.note, sign: EXTRA[o.lang].sign, origin: o.origin,
  });
  const text = [c.title, "", hello, body, "", ...c.facts.map((s) => `• ${s}`), "", `${c.cta}${sep(o.lang)}${o.url}`, "", c.note, "", EXTRA[o.lang].sign].join("\n");
  return { subject: c.subject, html, text };
}
