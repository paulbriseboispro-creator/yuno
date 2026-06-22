// ─────────────────────────────────────────────────────────────────────────────
// Yuno Email Kit — éditorial nightlife, email-safe.
//
// Traduit docs/DESIGN_SYSTEM_PUBLIC.md ("affiche de club / magazine de nuit") en
// HTML compatible clients mail (tables, inline styles, fallbacks de police).
//
//   • Fond #0A0A0A, surface #141414, accent rouge UNIQUE #E8192C.
//   • Titres : Space Grotesk uppercase serré (fallback Helvetica/Arial Black).
//   • Metadata : JetBrains Mono uppercase tracké (fallback Courier) = signature.
//   • Radius tranchant 2–4px sur l'éditorial ; pills 999px pour les CTA.
//
// Les vraies polices se chargent dans Apple Mail / iOS Mail (audience nightlife =
// iPhone ++) via <link> ; Gmail/Outlook tombent proprement sur les fallbacks.
// ─────────────────────────────────────────────────────────────────────────────

export const C = {
  bg: '#0A0A0A',
  bg2: '#0E0E10',
  card: '#141414',
  card2: '#1B1B1E',
  elev: '#222226',
  red: '#E8192C',
  redHover: '#FF2438',
  redDim: 'rgba(232,25,44,0.10)',
  redTint: 'rgba(232,25,44,0.06)',
  white: '#FFFFFF',
  gray1: '#E5E5E5',
  gray2: '#9A9A9A',
  gray3: '#5A5A5E',
  gray4: '#3A3A3E',
  amber: '#F5A623',
  border: 'rgba(255,255,255,0.08)',
  borderStrong: 'rgba(255,255,255,0.14)',
};

// Stacks de polices : la vraie police d'abord (Apple Mail), puis fallback robuste.
export const F = {
  display: `'Space Grotesk','Helvetica Neue',Arial,sans-serif`,
  body: `'Inter','Helvetica Neue',Arial,sans-serif`,
  mono: `'JetBrains Mono','SFMono-Regular',Menlo,Consolas,'Courier New',monospace`,
};

export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Shell : doctype + preheader caché + container 600px centré sur fond noir ──
export function shell(opts: { preheader: string; body: string; title?: string }): string {
  return `<!DOCTYPE html>
<html lang="fr" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${esc(opts.title || 'Yuno')}</title>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=JetBrains+Mono:wght@400;500;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<!--[if mso]><style>*{font-family:Arial,sans-serif!important}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background:${C.bg};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:${C.bg};">${esc(opts.preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg};">
  <tr><td align="center" style="padding:0;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:${C.bg};">
      ${opts.body}
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ── Wordmark Yuno (header minimal éditorial) ──
export function brandBar(): string {
  return `<tr><td style="padding:22px 28px 18px;border-bottom:1px solid ${C.border};">
    <span style="font-family:${F.display};font-size:20px;font-weight:700;color:${C.red};letter-spacing:-0.02em;">Yuno</span>
  </td></tr>`;
}

// ── Image poster pleine largeur (1:1 conseillé). Texte JAMAIS sur l'image. ──
export function poster(url: string, alt = ''): string {
  if (!url) return '';
  return `<tr><td style="padding:0;font-size:0;line-height:0;background:${C.bg};">
    <img src="${esc(url)}" alt="${esc(alt)}" width="600" style="width:100%;max-width:600px;height:auto;display:block;border:0;" />
  </td></tr>`;
}

// ── Label de section à filet rouge (signature éditoriale) ──
export function ruleLabel(text: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td style="padding:0 10px 0 0;vertical-align:middle;"><div style="width:28px;height:2px;background:${C.red};font-size:0;line-height:0;">&nbsp;</div></td>
    <td style="vertical-align:middle;font-family:${F.mono};font-size:11px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:${C.gray2};">${esc(text)}</td>
  </tr></table>`;
}

// ── Titre fort (Space Grotesk uppercase) ──
export function title(text: string, size = 34): string {
  return `<div style="font-family:${F.display};font-size:${size}px;font-weight:700;line-height:0.98;letter-spacing:-0.02em;color:${C.white};text-transform:uppercase;">${esc(text)}</div>`;
}

// ── Metadata mono (date · lieu · prix…) ──
export function mono(text: string, color = C.gray2, size = 12): string {
  return `<div style="font-family:${F.mono};font-size:${size}px;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;color:${color};">${esc(text)}</div>`;
}

// ── Corps de texte ──
export function body(html: string, color = C.gray1): string {
  return `<div style="font-family:${F.body};font-size:16px;font-weight:400;line-height:1.6;color:${color};">${html}</div>`;
}

// ── Section conteneur (padding latéral 28px + bordure basse optionnelle) ──
export function section(inner: string, opts: { border?: boolean; padTop?: number; padBottom?: number } = {}): string {
  const bb = opts.border === false ? '' : `border-bottom:1px solid ${C.border};`;
  return `<tr><td style="padding:${opts.padTop ?? 30}px 28px ${opts.padBottom ?? 30}px;${bb}">${inner}</td></tr>`;
}

// ── Bouton pill rouge (bulletproof, table-based) ──
export function ctaPill(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td align="center" bgcolor="${C.red}" style="border-radius:999px;mso-padding-alt:14px 34px;">
      <a href="${esc(url)}" target="_blank" style="display:inline-block;padding:14px 34px;font-family:${F.body};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px;">${esc(label)}</a>
    </td></tr></table>`;
}

// ── CTA "affiche" tranchant (radius 3px, mono uppercase) ──
export function ctaSharp(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td align="center" bgcolor="${C.red}" style="border-radius:3px;mso-padding-alt:14px 28px;">
      <a href="${esc(url)}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${F.mono};font-size:12px;font-weight:700;letter-spacing:0.10em;text-transform:uppercase;color:#ffffff;text-decoration:none;border-radius:3px;">${esc(label)}</a>
    </td></tr></table>`;
}

// ── Date typographique géante (chiffre + mois + heure) ──
export function bigDate(opts: { day: string; month: string; timeLabel?: string; timeValue?: string; dateLabel?: string }): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td style="vertical-align:bottom;">
      ${mono(opts.dateLabel || 'Date', C.gray3, 10)}
      <div style="font-family:${F.display};font-size:56px;font-weight:700;line-height:0.85;letter-spacing:-0.04em;color:${C.white};margin-top:6px;">${esc(opts.day)}</div>
      <div style="font-family:${F.mono};font-size:13px;letter-spacing:0.10em;text-transform:uppercase;color:${C.gray2};margin-top:6px;">${esc(opts.month)}</div>
    </td>
    ${opts.timeValue ? `<td style="vertical-align:bottom;text-align:right;">
      ${mono(opts.timeLabel || 'Ouverture', C.gray3, 10)}
      <div style="font-family:${F.display};font-size:40px;font-weight:700;line-height:0.9;letter-spacing:-0.03em;color:${C.white};margin-top:6px;">${esc(opts.timeValue)}</div>
    </td>` : ''}
  </tr></table>`;
}

// ── Callout prix (encadré rouge tranchant) ──
export function calloutPrice(label: string, value: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td style="border:1px solid rgba(232,25,44,0.30);border-radius:4px;background:${C.redTint};padding:16px 20px;">
      ${mono(label, C.red, 9)}
      <div style="font-family:${F.display};font-size:30px;font-weight:700;letter-spacing:-0.025em;line-height:1;color:${C.white};margin-top:6px;">${esc(value)}</div>
    </td></tr></table>`;
}

// ── Bloc code (OTP / référence) en mono géant ──
export function codeBlock(code: string, label?: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td align="center" style="border:1px solid ${C.borderStrong};border-radius:4px;background:${C.card};padding:22px 16px;">
      ${label ? `<div style="font-family:${F.mono};font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:${C.gray3};margin-bottom:10px;">${esc(label)}</div>` : ''}
      <div style="font-family:${F.mono};font-size:34px;font-weight:700;letter-spacing:0.30em;color:${C.white};padding-left:0.30em;">${esc(code)}</div>
    </td></tr></table>`;
}

// ── Lignes info clé/valeur (label mono gris, valeur claire) ──
export function infoRows(rows: Array<{ k: string; v: string }>): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.map((r, i) => `
    <tr>
      <td style="padding:${i ? '12px' : '0'} 0 12px;border-top:${i ? `1px solid ${C.border}` : '0'};font-family:${F.mono};font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:${C.gray3};">${esc(r.k)}</td>
      <td style="padding:${i ? '12px' : '0'} 0 12px;border-top:${i ? `1px solid ${C.border}` : '0'};text-align:right;font-family:${F.body};font-size:14px;font-weight:500;color:${C.gray1};">${esc(r.v)}</td>
    </tr>`).join('')}</table>`;
}

// ── Carte event mini (poster + titre + meta) pour reco / win-back ──
export function eventMiniCard(opts: { img?: string; title: string; meta: string; url: string; cta: string }): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.card};border:1px solid ${C.border};border-radius:8px;overflow:hidden;">
    ${opts.img ? `<tr><td style="font-size:0;line-height:0;"><img src="${esc(opts.img)}" alt="" width="544" style="width:100%;height:auto;display:block;border:0;" /></td></tr>` : ''}
    <tr><td style="padding:16px 18px;">
      <div style="font-family:${F.display};font-size:17px;font-weight:700;text-transform:uppercase;letter-spacing:-0.01em;color:${C.white};">${esc(opts.title)}</div>
      <div style="font-family:${F.mono};font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:${C.gray2};margin:6px 0 14px;">${esc(opts.meta)}</div>
      ${ctaSharp(opts.cta, opts.url)}
    </td></tr>
  </table>`;
}

export function divider(): string {
  return `<tr><td style="padding:0 28px;"><div style="border-top:1px solid ${C.border};font-size:0;line-height:0;">&nbsp;</div></td></tr>`;
}

export function spacer(h = 16): string {
  return `<tr><td style="height:${h}px;line-height:${h}px;font-size:0;">&nbsp;</td></tr>`;
}

// ── Footer éditorial (mono, mention légale + désinscription optionnelle) ──
const FOOTER_I18N = {
  en: { sent: (e: string, r: string) => `Sent to ${e} because ${r}.`, tagline: '© 2026 Yuno · Nightlife, simplified.', unsub: 'Unsubscribe' },
  fr: { sent: (e: string, r: string) => `Envoyé à ${e} car ${r}.`, tagline: '© 2026 Yuno · La nuit, simplifiée.', unsub: 'Se désinscrire' },
  es: { sent: (e: string, r: string) => `Enviado a ${e} porque ${r}.`, tagline: '© 2026 Yuno · La noche, simplificada.', unsub: 'Cancelar suscripción' },
};
export function footer(opts: {
  lang?: 'en' | 'fr' | 'es';
  recipientEmail?: string;
  reason?: string;        // déjà traduit par le builder, ex: "tu as acheté un billet"
  unsubscribeUrl?: string;
  venueName?: string;
}): string {
  const L = FOOTER_I18N[opts.lang || 'fr'];
  const lines: string[] = [];
  if (opts.venueName) lines.push(`<div style="font-family:${F.mono};font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:${C.gray2};margin-bottom:8px;">${esc(opts.venueName)}</div>`);
  if (opts.recipientEmail && opts.reason) lines.push(`<div style="font-family:${F.body};font-size:12px;line-height:1.6;color:${C.gray3};">${esc(L.sent(opts.recipientEmail, opts.reason))}</div>`);
  lines.push(`<div style="font-family:${F.body};font-size:12px;color:${C.gray3};margin-top:6px;">${esc(L.tagline)}</div>`);
  if (opts.unsubscribeUrl) lines.push(`<div style="font-family:${F.body};font-size:12px;color:${C.gray3};margin-top:10px;"><a href="${esc(opts.unsubscribeUrl)}" style="color:${C.gray3};text-decoration:underline;">${esc(L.unsub)}</a></div>`);
  return `<tr><td style="padding:26px 28px 34px;border-top:1px solid ${C.border};background:${C.bg2};">
    <span style="font-family:${F.display};font-size:15px;font-weight:700;color:${C.gray3};letter-spacing:-0.02em;">Yuno</span>
    <div style="margin-top:12px;">${lines.join('')}</div>
  </td></tr>`;
}
