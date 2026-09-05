// ─────────────────────────────────────────────────────────────────────────────
// Email Studio — rendu HTML email. PUR : (blocks, theme, ctx) => string.
// Aucune dépendance DOM/réseau — testable, portable Deno.
//
// Contraintes non négociables (voir docs/designs/EMAIL_STUDIO_PLAN.md) :
// tables imbriquées + styles inline (600 px), fallbacks MSO/VML pour Outlook,
// media queries mobiles en <head> en complément, dark mode via meta +
// prefers-color-scheme, preheader caché, alt obligatoire, interpolation des
// variables au rendu, lien de désinscription dans le footer promotionnel.
// Les visuels par bloc suivent le prototype claude.design (blockStyles).
//
// ⚠️ Port Deno : supabase/functions/_shared/email-studio-html.ts embarque une
// copie de ce fichier. Toute modification ici doit y être répercutée.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  BlockCond, EmailBlock, EmailTheme, RenderCtx, SocialLinks, TicketRow,
  HeaderBlock, ImageBlock, TextBlock, CtaBlock, ColumnsBlock, EventBlock,
  TicketsBlock, TableBlock, CountdownBlock, SpacerBlock, HtmlBlock, DividerBlock,
} from './types';
import { blockPadDefaults, LOGO_SIZES, SPACER_SIZES } from './types';
import { isPricedRow, SOLD_OUT_CHIP, soldOutSub, ticketsCtaLabel, ticketsKicker } from './live';
import { interpolateVariables } from './variables';

const FONT = "Arial,'Helvetica Neue',Helvetica,sans-serif";
/** Métadonnées (kicker, jauge, badges) — signal nightlife du design public. */
const MONO = "'SF Mono',SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";
/** Marque Yuno — même pile que les emails transactionnels (_shared/email-kit.ts). */
const DISPLAY = "'Space Grotesk','Helvetica Neue',Arial,sans-serif";

/**
 * Signature Yuno du pied de page. Les emails transactionnels portent déjà le
 * mot-symbole (email-kit.ts) ; les campagnes ne l'avaient QUE noyé dans deux
 * phrases (« sur Yuno », « via Yuno ») — invisibles, et qui répétaient trois
 * fois le nom une fois la signature posée. Elles ont donc sauté : une marque
 * signée vaut mieux que trois mentions marmonnées, et `hideBranding` ne pilote
 * plus qu'UNE chose. La marque reste subordonnée au club : même couleur que le
 * reste du pied de page, c'est la TYPO qui la porte — label mono tracké +
 * mot-symbole display, la paire label/valeur du design public.
 */
function poweredBy(theme: EmailTheme, ctx: RenderCtx): string {
  if (ctx.hideBranding) return '';
  const href = 'https://yunoapp.eu/?utm_source=yuno&utm_medium=powered_by';
  return `<a href="${href}" target="_blank" rel="noreferrer" style="display:inline-block;margin:18px 0 0;text-decoration:none;">
      <span style="display:block;font-family:${MONO};font-size:9.5px;line-height:13px;mso-line-height-rule:exactly;font-weight:700;letter-spacing:0.16em;color:${theme.footerText};">POWERED BY</span>
      <span style="display:block;margin-top:3px;font-family:${DISPLAY};font-size:15px;line-height:19px;mso-line-height-rule:exactly;font-weight:700;letter-spacing:-0.02em;color:${theme.footerText};">Yuno</span>
    </a>`;
}

export function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** true si le corps ressemble à du HTML (brouillon v1 migré) plutôt qu'à du texte brut. */
export function looksLikeHtml(body: string): boolean {
  return /<\s*(p|br|strong|em|b|i|a|u|ul|ol|li|span|div)[\s/>]/i.test(body || '');
}

export interface InlineMarkupOpts {
  accent: string;
  /** Traqueur de liens (attribution clic→achat). Absent = URL brute. */
  track?: (url: string) => string;
}

/**
 * Mini-markup inline des blocs texte — s'applique APRÈS échappement HTML,
 * donc aucun HTML utilisateur ne passe. Syntaxe (une ligne à la fois) :
 *   **gras**   *italique*   ~~barré~~   __souligné__
 *   [c=#ff0000]couleur[/c]   [c=accent]couleur du thème[/c]
 *   [s=22]taille en px[/s]   [url=https://…]lien[/url]
 */
export function inlineMarkup(escaped: string, opts: InlineMarkupOpts): string {
  let s = escaped;
  s = s.replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, (_m, rawHref: string, label: string) => {
    const href = rawHref.replace(/&amp;/g, '&').trim();
    const url = opts.track ? opts.track(href) : href;
    return `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer" style="color:${opts.accent};text-decoration:underline;">${label}</a>`;
  });
  s = s.replace(/\[c=(accent|#[0-9a-fA-F]{3,8})\]([\s\S]*?)\[\/c\]/gi, (_m, c: string, inner: string) =>
    `<span style="color:${c.toLowerCase() === 'accent' ? opts.accent : c};">${inner}</span>`);
  s = s.replace(/\[s=(\d{1,3})\]([\s\S]*?)\[\/s\]/gi, (_m, n: string, inner: string) => {
    const px = Math.max(10, Math.min(40, Number(n)));
    return `<span style="font-size:${px}px;line-height:1.4;">${inner}</span>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/~~([^~]+)~~/g, '<span style="text-decoration:line-through;">$1</span>');
  s = s.replace(/__([^_]+)__/g, '<span style="text-decoration:underline;">$1</span>');
  s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  return s;
}

/** Corps texte brut → paragraphes HTML (variables interpolées par l'appelant). */
function plainToParagraphs(body: string, fontSize: number, color: string, markup: InlineMarkupOpts): string {
  const lines = String(body || '').split('\n');
  return lines
    .map((line, i) => `<p style="margin:0${i < lines.length - 1 ? ' 0 10px' : ''};font-size:${fontSize}px;line-height:1.6;color:${color};">${inlineMarkup(escapeHtml(line), markup)}</p>`)
    .join('');
}

/** Ajoute la référence campagne aux liens internes (attribution clic→achat). */
function trackUrl(url: string, ctx: RenderCtx): string {
  if (!url) return ctx.baseUrl;
  if (!ctx.campaignId) return url;
  if (!url.startsWith(ctx.baseUrl) && !url.startsWith('/')) return url;
  const abs = url.startsWith('/') ? `${ctx.baseUrl}${url}` : url;
  return `${abs}${abs.includes('?') ? '&' : '?'}yc=${encodeURIComponent(ctx.campaignId)}`;
}

/** Bouton compatible Outlook : VML roundrect + <a> pour tout le reste. */
function buttonHtml(opts: {
  href: string; label: string; bg: string; color: string;
  radius: number; full: boolean; ctx: RenderCtx; small?: boolean;
}): string {
  const href = escapeHtml(trackUrl(opts.href, opts.ctx));
  const label = escapeHtml(opts.label);
  const height = opts.small ? 42 : 50;
  const fontSize = opts.small ? 14 : 16;
  const radius = Math.min(opts.radius, height);
  const arc = Math.max(0, Math.min(50, Math.round((radius / height) * 100)));
  const widthAttr = opts.full ? 'width:100%;' : 'width:240px;';
  const aWidth = opts.full ? 'display:block;' : 'display:inline-block;';
  return `<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:${height}px;v-text-anchor:middle;${widthAttr}" arcsize="${arc}%" strokecolor="${opts.bg}" fillcolor="${opts.bg}"><w:anchorlock/><center style="color:${opts.color};font-family:${FONT};font-size:${fontSize}px;font-weight:700;">${label}</center></v:roundrect>
<![endif]--><!--[if !mso]><!--><a href="${href}" target="_blank" rel="noreferrer" style="${aWidth}background:${opts.bg};color:${opts.color};text-decoration:none;font-family:${FONT};font-weight:700;font-size:${fontSize}px;line-height:${height}px;mso-line-height-rule:exactly;padding:0 ${opts.small ? 20 : 40}px;border-radius:${radius}px;text-align:center;">${label}</a><!--<![endif]-->`;
}

/** true si la chaîne est une couleur hex 6 chiffres utilisable en style inline. */
export function isHexColor(c: unknown): c is string {
  return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c.trim());
}

/** Texte lisible sur un fond donné (luminance perceptuelle sRGB simple). */
export function contrastText(hex: string): '#111111' | '#ffffff' {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 150 ? '#111111' : '#ffffff';
}

/** Fond + texte du bouton CTA : couleur du bloc si custom, sinon le thème. */
export function ctaColors(blockColor: unknown, theme: { accent: string; btnText: string }): { bg: string; color: string } {
  if (isHexColor(blockColor) && blockColor.trim().toLowerCase() !== theme.accent.toLowerCase()) {
    const bg = blockColor.trim();
    return { bg, color: contrastText(bg) };
  }
  return { bg: theme.accent, color: theme.btnText };
}

/** Décompte {jours, heures, minutes} — rendu en 3 cellules comme le prototype. */
export function countdownParts(startAtIso: string, now: Date): { days: number; hours: number; mins: number } | null {
  const start = new Date(startAtIso).getTime();
  if (!Number.isFinite(start)) return null;
  const diff = Math.max(0, start - now.getTime());
  return {
    days: Math.floor(diff / 86_400_000),
    hours: Math.floor((diff % 86_400_000) / 3_600_000),
    mins: Math.floor((diff % 3_600_000) / 60_000),
  };
}

const pad2 = (n: number) => String(Math.max(0, n)).padStart(2, '0');

// ── Enveloppe de bloc : marges + fond + règle de visibilité ─────────────────

function blockPad(b: EmailBlock): { px: number; py: number } {
  const d = blockPadDefaults(b.type);
  return { px: b.px ?? d.px, py: b.py ?? d.py };
}

function blockBg(b: EmailBlock, theme: EmailTheme): string {
  if (isHexColor(b.bgc)) return b.bgc.trim();
  if (b.bg === 'tile') return theme.tile;
  if (b.bg === 'accent') return theme.dark ? 'rgba(212,175,55,0.07)' : 'rgba(232,25,44,0.05)';
  return 'transparent';
}

/** Libellé d'un lien réseau : nom du réseau, ou domaine pour le site web. */
export function socialLabel(key: keyof SocialLinks, url: string): string {
  const names: Record<keyof SocialLinks, string> = {
    instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook', x: 'X', website: 'Site',
  };
  if (key !== 'website') return names[key];
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch {
    return names.website;
  }
}

/** Un bloc conditionnel s'efface pour les destinataires hors règle. */
function condVisible(b: EmailBlock, ctx: RenderCtx): boolean {
  if (!b.cond || ctx.ignoreConds) return true;
  const conds = ctx.recipient.conds;
  if (!conds) return false;
  const set = conds instanceof Set ? conds : new Set(conds as BlockCond[]);
  return set.has(b.cond);
}

type Pad = { px: number; py: number };

function td(inner: string, style: string): string {
  return `<tr><td style="${style}">${inner}</td></tr>`;
}

// ── Rendu par type de bloc ───────────────────────────────────────────────────

function renderHeader(b: HeaderBlock, theme: EmailTheme, ctx: RenderCtx, pad: Pad, bg: string): string {
  const size = LOGO_SIZES[b.logoSize] || LOGO_SIZES.md;
  const radius = b.logoShape === 'circle' ? '50%' : b.logoShape === 'rounded' ? '14px' : '0';
  // Repli automatique sur le logo du compte : le pro n'a rien à re-téléverser.
  const logoSrc = b.logoUrl || ctx.logoUrl || '';
  // Le header suit theme.headerBg tant que le bloc ne choisit rien ; dès qu'un
  // fond est posé (Teinte / Accent / couleur), c'est le sien qui gagne — sinon
  // le champ « Fond personnalisé » de l'inspecteur ne changeait rien du tout.
  const headerBg = bg === 'transparent' ? theme.headerBg : bg;
  // Sur une couleur choisie à la main, le nom se re-contraste seul : un fond
  // blanc ne doit pas avaler un headerText blanc hérité du thème.
  const nameColor = isHexColor(b.bgc) ? contrastText(b.bgc.trim()) : theme.headerText;
  const logo = logoSrc
    ? `<img src="${escapeHtml(logoSrc)}" alt="${escapeHtml(b.venueName || ctx.venueName)}" width="${size}" height="${size}" style="width:${size}px;height:${size}px;object-fit:cover;display:block;margin:0 auto${b.showName ? ' 12px' : ''};border:0;border-radius:${radius};" />`
    : '';
  const name = b.showName
    ? `<h1 style="margin:0;font-family:${FONT};font-size:22px;line-height:28px;mso-line-height-rule:exactly;font-weight:700;color:${nameColor};letter-spacing:0.06em;">${escapeHtml(b.venueName || ctx.venueName)}</h1>`
    : '';
  return td(logo + name, `padding:${pad.py}px ${pad.px}px;text-align:center;background:${headerBg};`);
}

function renderImage(b: ImageBlock, theme: EmailTheme, ctx: RenderCtx, pad: Pad, bg: string): string {
  if (!b.url) return '';
  const radius = typeof b.radius === 'number' && b.radius > 0 ? `border-radius:${Math.min(40, b.radius)}px;` : '';
  const img = `<img src="${escapeHtml(b.url)}" alt="${escapeHtml(b.label)}" width="600" style="width:100%;height:auto;display:block;border:0;${radius}" class="yn-img" />`;
  const linked = b.linkUrl
    ? `<a href="${escapeHtml(trackUrl(b.linkUrl, ctx))}" target="_blank" rel="noreferrer">${img}</a>`
    : img;
  return `<tr><td style="padding:${pad.py}px ${pad.px}px;background:${bg};font-size:0;line-height:0;">${linked}</td></tr>`;
}

function renderText(b: TextBlock, theme: EmailTheme, ctx: RenderCtx, pad: Pad, bg: string): string {
  const size = Math.max(11, Math.min(28, b.size || 16));
  const color = isHexColor(b.color) ? b.color.trim() : theme.text;
  const raw = interpolateVariables(b.body || '', ctx);
  const markup: InlineMarkupOpts = { accent: theme.accent, track: (u) => trackUrl(u, ctx) };
  const inner = looksLikeHtml(raw) ? raw : plainToParagraphs(raw, size, color, markup);
  return td(
    inner,
    `padding:${pad.py}px ${pad.px}px;background:${bg};font-family:${FONT};font-size:${size}px;line-height:1.6;color:${color};text-align:${b.align || 'left'};`,
  );
}

function renderCta(b: CtaBlock, theme: EmailTheme, ctx: RenderCtx, pad: Pad, bg: string): string {
  const colors = ctaColors(b.color, theme);
  const btn = buttonHtml({
    href: b.url, label: interpolateVariables(b.label, ctx),
    bg: colors.bg, color: colors.color,
    radius: b.radius ?? 8, full: !!b.full, ctx,
  });
  return td(btn, `padding:${pad.py}px ${pad.px}px;background:${bg};text-align:${b.align || 'center'};`);
}

function renderColumns(b: ColumnsBlock, theme: EmailTheme, ctx: RenderCtx, pad: Pad, bg: string): string {
  const col = (c: { title: string; body: string }, side: 'l' | 'r') =>
    `<td class="yn-col" width="50%" valign="top" style="${side === 'l' ? 'padding:0 7px 0 0;' : 'padding:0 0 0 7px;'}font-family:${FONT};">
      <p style="margin:0 0 3px;font-size:15px;font-weight:600;color:${theme.text};">${escapeHtml(interpolateVariables(c.title, ctx))}</p>
      <p style="margin:0;font-size:13px;line-height:1.6;color:${theme.muted};">${escapeHtml(interpolateVariables(c.body, ctx))}</p>
    </td>`;
  return td(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${col(b.left, 'l')}${col(b.right, 'r')}</tr></table>`,
    `padding:${pad.py}px ${pad.px}px;background:${bg};`,
  );
}

function renderEvent(b: EventBlock, theme: EmailTheme, ctx: RenderCtx, pad: Pad, bg: string): string {
  const live = b.eventId ? ctx.live?.[b.eventId] : undefined;
  const title = live?.title || b.title;
  const dateLabel = live?.dateLabel || b.dateLabel;
  const venueLabel = live?.venueLabel || b.venueLabel;
  const coverUrl = live?.coverUrl || b.coverUrl;
  const url = live?.trackedUrl || live?.url || b.ctaUrl || ctx.baseUrl;
  const priceLabel = live?.priceFromLabel;

  const cover = b.cover && coverUrl
    ? `<tr><td style="font-size:0;line-height:0;"><img src="${escapeHtml(coverUrl)}" alt="${escapeHtml(title)}" width="552" style="width:100%;max-width:552px;height:auto;display:block;border:0;" /></td></tr>`
    : '';
  const venueRow = b.venue
    ? `<p style="margin:0 0 4px;font-family:${FONT};font-size:14px;color:${theme.muted};">${escapeHtml(venueLabel)}</p>`
    : '';
  const priceRow = b.price && priceLabel
    ? `<p style="margin:0 0 4px;font-family:${FONT};font-size:14px;color:${theme.muted};">${escapeHtml(priceLabel)}</p>`
    : '';
  const btnColors = ctaColors(b.accent, theme);
  const btn = buttonHtml({ href: url, label: b.ctaLabel || "Voir l'événement", bg: btnColors.bg, color: btnColors.color, radius: 6, full: false, ctx, small: true });
  const cardBg = theme.dark ? theme.tile : '#ffffff';
  return td(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${theme.divider};border-radius:12px;background:${cardBg};">
      ${cover}
      <tr><td style="padding:20px;">
        <h2 style="margin:0 0 8px;font-family:${FONT};font-size:20px;line-height:26px;mso-line-height-rule:exactly;font-weight:700;color:${theme.text};">${escapeHtml(title)}</h2>
        <p style="margin:0 0 4px;font-family:${FONT};font-size:14px;color:${theme.muted};">${escapeHtml(dateLabel)}</p>
        ${venueRow}
        ${priceRow}
        <div style="height:14px;line-height:14px;font-size:0;">&nbsp;</div>
        ${btn}
      </td></tr>
    </table>`,
    `padding:${pad.py}px ${pad.px}px;background:${bg};`,
  );
}

/**
 * Une ligne d'entrée. Le prix est le point focal (21px), le nom le porte
 * (17px) et la jauge du club reste en retrait (12px, mono). Un tarif sans
 * chiffre (« Gratuit », « Sur invitation ») n'est pas un montant mais une
 * OFFRE : il se rend en pastille accent, pas en nombre.
 */
function renderTicketRows(
  rows: TicketRow[], theme: EmailTheme, accent: string, accentText: string,
): string {
  return rows.map((r, i) => {
    const sep = i > 0 ? `border-top:1px solid ${theme.divider};` : '';
    const sub = r.out ? soldOutSub(r.s) : r.s;
    const soldChip = r.out
      ? `<span style="display:inline-block;margin:7px 0 0;padding:4px 8px;background:${theme.divider};border-radius:3px;font-family:${MONO};font-size:10px;font-weight:700;letter-spacing:0.1em;color:${theme.muted};">${SOLD_OUT_CHIP}</span>`
      : '';
    const price = isPricedRow(r.p)
      ? `<span style="font-family:${FONT};font-size:21px;font-weight:800;letter-spacing:-0.02em;color:${r.out ? theme.muted : accent};${r.out ? 'text-decoration:line-through;' : ''}">${escapeHtml(r.p)}</span>`
      // Pastille : l'entrée gratuite est l'argument de l'email, pas une ligne
      // de tableau. Outlook ignore border-radius et la rend carrée — lisible.
      : `<span style="display:inline-block;padding:7px 13px;border-radius:999px;background:${r.out ? theme.divider : accent};font-family:${FONT};font-size:12.5px;font-weight:800;letter-spacing:0.04em;text-transform:uppercase;color:${r.out ? theme.muted : accentText};">${escapeHtml(r.p)}</span>`;
    return `
    <tr>
      <td valign="middle" style="padding:16px 18px;${sep}font-family:${FONT};">
        <p style="margin:0;font-size:17px;line-height:22px;mso-line-height-rule:exactly;font-weight:600;letter-spacing:-0.01em;color:${r.out ? theme.muted : theme.text};">${escapeHtml(r.n)}</p>
        ${sub ? `<p style="margin:5px 0 0;font-family:${MONO};font-size:12px;line-height:17px;mso-line-height-rule:exactly;letter-spacing:0.02em;color:${theme.muted};">${escapeHtml(sub)}</p>` : ''}
        ${soldChip}
      </td>
      <td align="right" valign="middle" style="padding:16px 18px;${sep}white-space:nowrap;">
        ${price}
      </td>
    </tr>`;
  }).join('');
}

function renderTickets(b: TicketsBlock, theme: EmailTheme, ctx: RenderCtx, pad: Pad, bg: string): string {
  const live = b.eventId ? ctx.live?.[b.eventId] : undefined;
  // Live branché : la base fait foi. Les lignes couvrent les tranches de
  // billetterie ET la liste invités publique. Vide = la soirée n'a AUCUNE
  // entrée ouverte, le bloc s'efface — jamais de tarifs inventés.
  const rows = (b.live && live) ? (live.tickets || []) : b.rows;
  if (!rows || rows.length === 0) return '';
  const guestListOnly = !!b.live && live?.guestListOnly;
  // Liste invités seule : le lien de la PART ouvre le formulaire avec son token
  // et son `tl=`, donc l'inscription se compte sur le canal de la campagne.
  // Sinon on reste sur la page de la soirée, où le `tl=` attribue les ventes.
  const url = (guestListOnly ? live?.entryTrackedUrl : null)
    || live?.trackedUrl || live?.url || ctx.baseUrl;
  const btnColors = ctaColors(b.accent, theme);
  // Une soirée en liste invités seule n'a pas de billet à prendre : le bouton
  // dit ce que le clic fait vraiment.
  const label = ticketsCtaLabel(guestListOnly);
  const btn = buttonHtml({ href: url, label, bg: btnColors.bg, color: btnColors.color, radius: 10, full: true, ctx });
  // Carte de la même famille que les blocs Événement et Table VIP (bord fin,
  // rayon 12, fond opaque) — coiffée d'un kicker accent qui annonce ce qu'on
  // achète avant même d'avoir lu une ligne.
  const cardBg = theme.dark ? theme.tile : '#ffffff';
  return td(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${theme.divider};border-radius:12px;background:${cardBg};">
      <tr><td colspan="2" style="padding:14px 18px 12px;border-bottom:1px solid ${theme.divider};">
        <p style="margin:0;font-family:${MONO};font-size:11px;line-height:15px;mso-line-height-rule:exactly;font-weight:700;letter-spacing:0.14em;color:${btnColors.bg};">${escapeHtml(ticketsKicker(guestListOnly))}</p>
      </td></tr>
      ${renderTicketRows(rows, theme, btnColors.bg, btnColors.color)}
    </table>
    <div style="height:14px;line-height:14px;font-size:0;">&nbsp;</div>
    ${btn}`,
    `padding:${pad.py}px ${pad.px}px;background:${bg};`,
  );
}

function renderTable(b: TableBlock, theme: EmailTheme, ctx: RenderCtx, pad: Pad, bg: string): string {
  const live = b.eventId ? ctx.live?.[b.eventId] : undefined;
  const url = live?.trackedUrl || live?.url || b.ctaUrl || ctx.baseUrl;
  const left = live?.tablesLeft;
  const btnColors = ctaColors(b.accent, theme);
  const accent = btnColors.bg;
  const leftRow = typeof left === 'number' && left >= 0
    ? `<p style="margin:0 0 10px;font-family:${FONT};font-size:12.5px;font-weight:700;color:${accent};">${left <= 0 ? 'Complet ce soir' : `${left} table${left > 1 ? 's' : ''} encore libre${left > 1 ? 's' : ''}`}</p>`
    : '';
  const btn = buttonHtml({ href: url, label: b.ctaLabel || 'Réserver une table', bg: btnColors.bg, color: btnColors.color, radius: 6, full: false, ctx, small: true });
  const cardBorder = theme.dark ? 'rgba(212,175,55,0.28)' : theme.divider;
  const cardBg = theme.dark ? 'rgba(212,175,55,0.06)' : theme.tile;
  return td(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${cardBorder};border-radius:12px;background:${cardBg};">
      <tr><td style="padding:18px;">
        <p style="margin:0 0 8px;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${accent};">${escapeHtml(b.kicker || 'Bottle service')}</p>
        <h2 style="margin:0 0 6px;font-family:${FONT};font-size:17px;line-height:23px;mso-line-height-rule:exactly;font-weight:600;color:${theme.text};">${escapeHtml(interpolateVariables(b.title, ctx))}</h2>
        <p style="margin:0 0 12px;font-family:${FONT};font-size:13.5px;line-height:1.6;color:${theme.muted};">${escapeHtml(interpolateVariables(b.sub, ctx))}</p>
        ${leftRow}
        ${btn}
      </td></tr>
    </table>`,
    `padding:${pad.py}px ${pad.px}px;background:${bg};`,
  );
}

function renderCountdown(b: CountdownBlock, theme: EmailTheme, ctx: RenderCtx, pad: Pad, bg: string): string {
  const live = b.eventId ? ctx.live?.[b.eventId] : undefined;
  // L'événement live prime ; sinon la date cible manuelle du bloc.
  const startIso = live?.startAt || (typeof b.targetAt === 'string' ? b.targetAt : '');
  const parts = startIso ? countdownParts(startIso, ctx.now || new Date()) : null;
  if (!parts) {
    // Ni événement ni date cible : le bloc s'efface plutôt que d'afficher un
    // compte à rebours faux — un countdown figé est pire que pas de countdown.
    return '';
  }
  const accent = isHexColor(b.accent) ? b.accent.trim() : theme.accent;
  const cell = (num: string, unit: string) =>
    `<td width="33%" style="padding:0 5px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:10px 0;border-radius:9px;background:${theme.tile};text-align:center;">
      <p style="margin:0;font-family:${FONT};font-size:24px;font-weight:700;color:${accent};">${num}</p>
      <p style="margin:2px 0 0;font-family:${FONT};font-size:10px;letter-spacing:.1em;color:${theme.muted};">${unit}</p>
    </td></tr></table></td>`;
  return td(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${theme.divider};border-radius:12px;"><tr><td style="padding:18px;text-align:center;">
      <p style="margin:0 0 12px;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${theme.muted};">${escapeHtml(b.label || '')}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        ${cell(pad2(parts.days), 'JOURS')}${cell(pad2(parts.hours), 'HEURES')}${cell(pad2(parts.mins), 'MIN')}
      </tr></table>
    </td></tr></table>`,
    `padding:${pad.py}px ${pad.px}px;background:${bg};`,
  );
}

/** Pastille + glyphe des réseaux : couleur choisie, glyphe auto-contrasté. */
export function socialChip(color: unknown, theme: EmailTheme): { chip: string; glyph: 'w' | 'd' } {
  const chip = isHexColor(color) ? color.trim() : (isHexColor(theme.muted) ? theme.muted : '#7a7a7a');
  return { chip, glyph: contrastText(chip) === '#111111' ? 'd' : 'w' };
}

/**
 * Réseaux = pastilles rondes avec les VRAIS logos, en PNG transparents
 * hébergés par NOUS (`/email-social/*.png`) : Gmail bloque les SVG, et un
 * CDN tiers meurt sans prévenir. La pastille prend la couleur choisie, le
 * glyphe passe en blanc ou foncé selon le contraste.
 */
function renderSocial(
  theme: EmailTheme,
  ctx: RenderCtx,
  standalone: boolean,
  opts: { pad?: Pad; iconColor?: unknown; bg?: string } = {},
): string {
  const entries = (Object.entries(ctx.socialLinks || {}) as [keyof SocialLinks, string | undefined][])
    .filter(([, url]) => url && url.trim().length > 0);
  if (entries.length === 0) return '';
  const { chip, glyph } = socialChip(opts.iconColor, theme);
  const cells = entries.map(([key, url]) => {
    const href = url!.startsWith('http') ? url! : `https://${url}`;
    const label = escapeHtml(socialLabel(key, url!));
    return `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer" style="display:inline-block;margin:0 5px;text-decoration:none;"><table role="presentation" cellpadding="0" cellspacing="0" style="display:inline-table;"><tr><td width="34" height="34" style="width:34px;height:34px;border-radius:50%;background:${chip};text-align:center;vertical-align:middle;font-size:0;line-height:0;"><img src="${ctx.baseUrl}/email-social/${key}-${glyph}.png" width="16" height="16" alt="${label}" style="display:inline-block;border:0;vertical-align:middle;" /></td></tr></table></a>`;
  }).join('');
  const padding = standalone && opts.pad ? `${opts.pad.py}px ${opts.pad.px}px` : '18px 24px 4px';
  // Le bloc autonome respecte le fond choisi (bgc / tile / accent), sinon la carte.
  const bg = standalone
    ? (opts.bg && opts.bg !== 'transparent' ? opts.bg : theme.card)
    : theme.footerBg;
  // Dans le pied de page, c'est la rangée de réseaux qui ouvre la bande : le
  // trait de séparation lui revient, sinon il coupe entre les icônes et le
  // texte légal.
  const border = standalone ? '' : footerBorder(theme);
  return td(cells, `padding:${padding};text-align:center;background:${bg};${border}`);
}

function renderSpacer(b: SpacerBlock, bg: string): string {
  const h = SPACER_SIZES[b.size] || SPACER_SIZES.md;
  return `<tr><td style="height:${h}px;line-height:${h}px;mso-line-height-rule:exactly;font-size:0;background:${bg};">&nbsp;</td></tr>`;
}

function renderDivider(b: DividerBlock, pad: Pad, theme: EmailTheme, bg: string): string {
  const color = isHexColor(b.color) ? b.color.trim() : theme.divider;
  return td(`<hr style="border:none;border-top:1px solid ${color};margin:0;" />`, `padding:${pad.py}px ${pad.px}px;background:${bg};`);
}

function renderHtmlBlock(b: HtmlBlock, ctx: RenderCtx, pad: Pad, bg: string): string {
  return `<tr><td style="padding:${pad.py}px ${pad.px}px;background:${bg};">${interpolateVariables(b.code || '', ctx)}</td></tr>`;
}

export function renderBlock(b: EmailBlock, theme: EmailTheme, ctx: RenderCtx): string {
  if (!condVisible(b, ctx)) return '';
  const pad = blockPad(b);
  const bg = blockBg(b, theme);
  switch (b.type) {
    case 'header': return renderHeader(b, theme, ctx, pad, bg);
    case 'image': return renderImage(b, theme, ctx, pad, bg);
    case 'text': return renderText(b, theme, ctx, pad, bg);
    case 'cta': return renderCta(b, theme, ctx, pad, bg);
    case 'columns': return renderColumns(b, theme, ctx, pad, bg);
    case 'event': return renderEvent(b, theme, ctx, pad, bg);
    case 'tickets': return renderTickets(b, theme, ctx, pad, bg);
    case 'table': return renderTable(b, theme, ctx, pad, bg);
    case 'countdown': return renderCountdown(b, theme, ctx, pad, bg);
    case 'social': return renderSocial(theme, ctx, true, { pad, iconColor: b.color, bg });
    case 'divider': return renderDivider(b, pad, theme, bg);
    case 'spacer': return renderSpacer(b, bg);
    case 'html': return renderHtmlBlock(b, ctx, pad, bg);
  }
}

// ── Footer légal ─────────────────────────────────────────────────────────────

/**
 * Trait de séparation du pied de page : seulement quand le footer est CLAIR.
 * Sur un footer sombre, le divider clair du thème dessinait une ligne blanche
 * criarde entre le contenu et le footer.
 */
function footerBorder(theme: EmailTheme): string {
  return isHexColor(theme.footerBg) && contrastText(theme.footerBg) === '#ffffff'
    ? '' : `border-top:1px solid ${theme.divider};`;
}

/** Réseaux au pied de page : affichés sauf refus explicite du thème. */
export function footerSocialEnabled(theme: EmailTheme): boolean {
  return theme.footerSocial !== false;
}

function renderFooter(theme: EmailTheme, ctx: RenderCtx, socialAbove: boolean): string {
  const year = (ctx.now || new Date()).getFullYear();
  const reason = ctx.emailType === 'promotional'
    ? 'vous êtes abonné à sa newsletter'
    : 'vous avez acheté un billet';
  const unsub = ctx.emailType === 'promotional' && ctx.unsubscribeUrl
    ? `<p style="margin:8px 0 0;font-size:11.5px;"><a href="${escapeHtml(ctx.unsubscribeUrl)}" style="color:${theme.accent};text-decoration:underline;">Se désabonner</a></p>`
    : '';
  const border = socialAbove ? '' : footerBorder(theme);
  return td(
    `<p style="margin:0 0 6px;font-size:12px;font-weight:600;color:${theme.footerText};">${escapeHtml(ctx.venueName)}${ctx.city ? ' — ' + escapeHtml(ctx.city) : ''}</p>
     <p style="margin:0;font-size:11.5px;line-height:1.6;color:${theme.footerText};">Cet email a été envoyé à ${escapeHtml(ctx.recipient.email)} car ${reason}.</p>
     <p style="margin:4px 0 0;font-size:11.5px;line-height:1.6;color:${theme.footerText};">© ${year} ${escapeHtml(ctx.venueName)}. Tous droits réservés.</p>
     ${unsub}
     ${poweredBy(theme, ctx)}`,
    `padding:22px 24px;background:${theme.footerBg};${border}font-family:${FONT};text-align:center;`,
  );
}

// ── Assemblage ───────────────────────────────────────────────────────────────

export interface RenderOptions {
  /** Coupe footer + social + désinscription (usages transactionnels internes). */
  omitFooter?: boolean;
}

export function renderEmailHtml(
  blocks: EmailBlock[],
  theme: EmailTheme,
  ctx: RenderCtx,
  options: RenderOptions = {},
): string {
  const blocksHtml = blocks.map((b) => renderBlock(b, theme, ctx)).join('\n');
  const preheaderText = ctx.preheader ? interpolateVariables(ctx.preheader, ctx) : '';
  // Le padding d'entités empêche les clients d'aspirer le début du corps dans
  // l'aperçu après le preheader.
  const preheader = preheaderText
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:${theme.bg};">${escapeHtml(preheaderText)}${'&#8199;&#847; '.repeat(30)}</div>`
    : '';
  // Le pied de page ne porte les réseaux que si le thème le demande : une
  // campagne qui pose déjà un bloc « Réseaux » les coupe ici.
  const footerSocial = footerSocialEnabled(theme) ? renderSocial(theme, ctx, false) : '';
  const chrome = options.omitFooter
    ? ''
    : `${footerSocial}\n${renderFooter(theme, ctx, footerSocial !== '')}`;

  return `<!DOCTYPE html>
<html lang="fr" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="${theme.dark ? 'dark' : 'light dark'}">
<meta name="supported-color-schemes" content="${theme.dark ? 'dark' : 'light dark'}">
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<title>${escapeHtml(ctx.subject)}</title>
<style>
  html,body{margin:0!important;padding:0!important;}
  table{border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;}
  img{-ms-interpolation-mode:bicubic;}
  a{text-decoration:none;}
  @media only screen and (max-width:620px){
    .yn-container{width:100%!important;max-width:100%!important;border-radius:0!important;}
    .yn-col{display:block!important;width:100%!important;padding:0 0 14px!important;}
  }
  @media (prefers-color-scheme:dark){
    .yn-bg{background:${theme.dark ? theme.bg : '#101012'}!important;}
  }
</style>
</head>
<body class="yn-bg" style="margin:0;padding:0;background:${theme.bg};font-family:${FONT};-webkit-text-size-adjust:100%;">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="yn-bg" style="background:${theme.bg};">
  <tr><td align="center" style="padding:24px 8px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" class="yn-container" style="width:600px;max-width:600px;background:${theme.card};border-radius:12px;overflow:hidden;${theme.dark ? 'border:1px solid rgba(255,255,255,0.06);' : ''}">
${blocksHtml}
${chrome}
    </table>
  </td></tr>
</table>
</body></html>`;
}
