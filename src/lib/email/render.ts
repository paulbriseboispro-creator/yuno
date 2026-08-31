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
  TicketsBlock, TableBlock, CountdownBlock, SpacerBlock, HtmlBlock,
} from './types';
import { DEFAULT_PX, DEFAULT_PY, LOGO_SIZES, SPACER_SIZES } from './types';
import { interpolateVariables } from './variables';

const FONT = "Arial,'Helvetica Neue',Helvetica,sans-serif";

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

/** Corps texte brut → paragraphes HTML (variables interpolées par l'appelant). */
function plainToParagraphs(body: string, fontSize: number, color: string): string {
  const lines = String(body || '').split('\n');
  return lines
    .map((line, i) => `<p style="margin:0${i < lines.length - 1 ? ' 0 10px' : ''};font-size:${fontSize}px;line-height:1.6;color:${color};">${escapeHtml(line)}</p>`)
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
  return { px: b.px ?? DEFAULT_PX, py: b.py ?? DEFAULT_PY };
}

function blockBg(b: EmailBlock, theme: EmailTheme): string {
  if (b.bg === 'tile') return theme.tile;
  if (b.bg === 'accent') return theme.dark ? 'rgba(212,175,55,0.07)' : 'rgba(232,25,44,0.05)';
  return 'transparent';
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

function renderHeader(b: HeaderBlock, theme: EmailTheme, ctx: RenderCtx): string {
  const size = LOGO_SIZES[b.logoSize] || LOGO_SIZES.md;
  const radius = b.logoShape === 'circle' ? '50%' : b.logoShape === 'rounded' ? '14px' : '0';
  const logo = b.logoUrl
    ? `<img src="${escapeHtml(b.logoUrl)}" alt="${escapeHtml(b.venueName || ctx.venueName)}" width="${size}" height="${size}" style="width:${size}px;height:${size}px;object-fit:cover;display:block;margin:0 auto${b.showName ? ' 12px' : ''};border:0;border-radius:${radius};" />`
    : '';
  const name = b.showName
    ? `<h1 style="margin:0;font-family:${FONT};font-size:22px;line-height:28px;mso-line-height-rule:exactly;font-weight:700;color:${theme.headerText};letter-spacing:0.06em;">${escapeHtml(b.venueName || ctx.venueName)}</h1>`
    : '';
  return td(logo + name, `padding:30px 24px;text-align:center;background:${theme.headerBg};`);
}

function renderImage(b: ImageBlock, theme: EmailTheme, ctx: RenderCtx): string {
  if (!b.url) return '';
  const img = `<img src="${escapeHtml(b.url)}" alt="${escapeHtml(b.label)}" width="600" style="width:100%;height:auto;display:block;border:0;" class="yn-img" />`;
  const linked = b.linkUrl
    ? `<a href="${escapeHtml(trackUrl(b.linkUrl, ctx))}" target="_blank" rel="noreferrer">${img}</a>`
    : img;
  return `<tr><td style="padding:0;font-size:0;line-height:0;">${linked}</td></tr>`;
}

function renderText(b: TextBlock, theme: EmailTheme, ctx: RenderCtx, pad: Pad, bg: string): string {
  const size = Math.max(11, Math.min(28, b.size || 16));
  const raw = interpolateVariables(b.body || '', ctx);
  const inner = looksLikeHtml(raw) ? raw : plainToParagraphs(raw, size, theme.text);
  return td(
    inner,
    `padding:${pad.py}px ${pad.px}px;background:${bg};font-family:${FONT};font-size:${size}px;line-height:1.6;color:${theme.text};text-align:${b.align || 'left'};`,
  );
}

function renderCta(b: CtaBlock, theme: EmailTheme, ctx: RenderCtx, pad: Pad, bg: string): string {
  const btn = buttonHtml({
    href: b.url, label: interpolateVariables(b.label, ctx),
    bg: theme.accent, color: theme.btnText,
    radius: b.radius ?? 8, full: !!b.full, ctx,
  });
  return td(btn, `padding:${pad.py + 6}px ${pad.px}px;background:${bg};text-align:${b.align || 'center'};`);
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
  const url = live?.url || b.ctaUrl || ctx.baseUrl;
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
  const btn = buttonHtml({ href: url, label: b.ctaLabel || "Voir l'événement", bg: theme.accent, color: theme.btnText, radius: 6, full: false, ctx, small: true });
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

function renderTicketRows(rows: TicketRow[], theme: EmailTheme): string {
  return rows.map((r, i) => `
    <tr>
      <td style="padding:13px 16px;${i > 0 ? `border-top:1px solid ${theme.divider};` : ''}font-family:${FONT};">
        <p style="margin:0;font-size:14.5px;font-weight:600;color:${r.out ? theme.muted : theme.text};">${escapeHtml(r.n)}</p>
        ${r.s ? `<p style="margin:2px 0 0;font-size:12px;color:${theme.muted};">${escapeHtml(r.s)}</p>` : ''}
      </td>
      <td align="right" style="padding:13px 16px;${i > 0 ? `border-top:1px solid ${theme.divider};` : ''}font-family:${FONT};white-space:nowrap;">
        <span style="font-size:14.5px;font-weight:700;color:${r.out ? theme.muted : theme.accent};${r.out ? 'text-decoration:line-through;' : ''}">${escapeHtml(r.p)}</span>
      </td>
    </tr>`).join('');
}

function renderTickets(b: TicketsBlock, theme: EmailTheme, ctx: RenderCtx, pad: Pad, bg: string): string {
  const live = b.eventId ? ctx.live?.[b.eventId] : undefined;
  const rows = (b.live && live?.tickets && live.tickets.length > 0) ? live.tickets : b.rows;
  if (!rows || rows.length === 0) return '';
  const url = live?.url || ctx.baseUrl;
  const btn = buttonHtml({ href: url, label: 'Prendre mes billets', bg: theme.accent, color: theme.btnText, radius: 8, full: true, ctx, small: true });
  return td(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${theme.divider};border-radius:12px;">
      ${renderTicketRows(rows, theme)}
    </table>
    <div style="height:12px;line-height:12px;font-size:0;">&nbsp;</div>
    ${btn}`,
    `padding:${pad.py}px ${pad.px}px;background:${bg};`,
  );
}

function renderTable(b: TableBlock, theme: EmailTheme, ctx: RenderCtx, pad: Pad, bg: string): string {
  const live = b.eventId ? ctx.live?.[b.eventId] : undefined;
  const url = live?.url || b.ctaUrl || ctx.baseUrl;
  const left = live?.tablesLeft;
  const leftRow = typeof left === 'number' && left >= 0
    ? `<p style="margin:0 0 10px;font-family:${FONT};font-size:12.5px;font-weight:700;color:${theme.accent};">${left <= 0 ? 'Complet ce soir' : `${left} table${left > 1 ? 's' : ''} encore libre${left > 1 ? 's' : ''}`}</p>`
    : '';
  const btn = buttonHtml({ href: url, label: b.ctaLabel || 'Réserver une table', bg: theme.accent, color: theme.btnText, radius: 6, full: false, ctx, small: true });
  const cardBorder = theme.dark ? 'rgba(212,175,55,0.28)' : theme.divider;
  const cardBg = theme.dark ? 'rgba(212,175,55,0.06)' : theme.tile;
  return td(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${cardBorder};border-radius:12px;background:${cardBg};">
      <tr><td style="padding:18px;">
        <p style="margin:0 0 8px;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${theme.accent};">${escapeHtml(b.kicker || 'Bottle service')}</p>
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
  const parts = live?.startAt ? countdownParts(live.startAt, ctx.now || new Date()) : null;
  if (!parts) {
    // Pas d'événement branché : le bloc s'efface plutôt que d'afficher un
    // compte à rebours faux — un countdown figé est pire que pas de countdown.
    return '';
  }
  const cell = (num: string, unit: string) =>
    `<td width="33%" style="padding:0 5px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:10px 0;border-radius:9px;background:${theme.tile};text-align:center;">
      <p style="margin:0;font-family:${FONT};font-size:24px;font-weight:700;color:${theme.accent};">${num}</p>
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

const SOCIAL_SLUG: Record<keyof SocialLinks, string> = {
  instagram: 'instagram', tiktok: 'tiktok', facebook: 'facebook', x: 'x', website: 'safari',
};

function renderSocial(theme: EmailTheme, ctx: RenderCtx, standalone: boolean): string {
  const entries = (Object.entries(ctx.socialLinks || {}) as [keyof SocialLinks, string | undefined][])
    .filter(([, url]) => url && url.trim().length > 0);
  if (entries.length === 0) return '';
  const color = theme.muted.replace('#', '');
  const cells = entries.map(([key, url]) => {
    const href = url!.startsWith('http') ? url! : `https://${url}`;
    return `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer" style="display:inline-block;margin:0 7px;text-decoration:none;"><img src="https://cdn.simpleicons.org/${SOCIAL_SLUG[key]}/${color}" alt="${key}" width="20" height="20" style="display:inline-block;border:0;" /></a>`;
  }).join('');
  return td(cells, `padding:18px 24px${standalone ? '' : ' 4px'};text-align:center;background:${standalone ? theme.card : theme.footerBg};`);
}

function renderSpacer(b: SpacerBlock): string {
  const h = SPACER_SIZES[b.size] || SPACER_SIZES.md;
  return `<tr><td style="height:${h}px;line-height:${h}px;mso-line-height-rule:exactly;font-size:0;">&nbsp;</td></tr>`;
}

function renderDivider(b: DividerBlockLike, theme: EmailTheme): string {
  return td(`<hr style="border:none;border-top:1px solid ${theme.divider};margin:0;" />`, `padding:10px ${b.px ?? DEFAULT_PX}px;`);
}
interface DividerBlockLike { px?: number }

function renderHtmlBlock(b: HtmlBlock, ctx: RenderCtx, pad: Pad, bg: string): string {
  return `<tr><td style="padding:0 ${pad.px}px;background:${bg};">${interpolateVariables(b.code || '', ctx)}</td></tr>`;
}

export function renderBlock(b: EmailBlock, theme: EmailTheme, ctx: RenderCtx): string {
  if (!condVisible(b, ctx)) return '';
  const pad = blockPad(b);
  const bg = blockBg(b, theme);
  switch (b.type) {
    case 'header': return renderHeader(b, theme, ctx);
    case 'image': return renderImage(b, theme, ctx);
    case 'text': return renderText(b, theme, ctx, pad, bg);
    case 'cta': return renderCta(b, theme, ctx, pad, bg);
    case 'columns': return renderColumns(b, theme, ctx, pad, bg);
    case 'event': return renderEvent(b, theme, ctx, pad, bg);
    case 'tickets': return renderTickets(b, theme, ctx, pad, bg);
    case 'table': return renderTable(b, theme, ctx, pad, bg);
    case 'countdown': return renderCountdown(b, theme, ctx, pad, bg);
    case 'social': return renderSocial(theme, ctx, true);
    case 'divider': return renderDivider(b, theme);
    case 'spacer': return renderSpacer(b);
    case 'html': return renderHtmlBlock(b, ctx, pad, bg);
  }
}

// ── Footer légal ─────────────────────────────────────────────────────────────

function renderFooter(theme: EmailTheme, ctx: RenderCtx): string {
  const year = (ctx.now || new Date()).getFullYear();
  const reason = ctx.emailType === 'promotional'
    ? 'vous êtes abonné à sa newsletter'
    : 'vous avez acheté un billet';
  const onPlatform = ctx.hideBranding ? '' : ' sur Yuno';
  const viaPlatform = ctx.hideBranding ? '' : ' via Yuno';
  const unsub = ctx.emailType === 'promotional' && ctx.unsubscribeUrl
    ? `<p style="margin:8px 0 0;font-size:11.5px;"><a href="${escapeHtml(ctx.unsubscribeUrl)}" style="color:${theme.accent};text-decoration:underline;">Se désabonner</a></p>`
    : '';
  return td(
    `<p style="margin:0 0 6px;font-size:12px;font-weight:600;color:${theme.footerText};">${escapeHtml(ctx.venueName)}${ctx.city ? ' — ' + escapeHtml(ctx.city) : ''}</p>
     <p style="margin:0;font-size:11.5px;line-height:1.6;color:${theme.footerText};">Cet email a été envoyé à ${escapeHtml(ctx.recipient.email)} car ${reason}${onPlatform}.</p>
     <p style="margin:4px 0 0;font-size:11.5px;line-height:1.6;color:${theme.footerText};">© ${year} ${escapeHtml(ctx.venueName)}${viaPlatform}. Tous droits réservés.</p>
     ${unsub}`,
    `padding:22px 24px;background:${theme.footerBg};border-top:1px solid ${theme.divider};font-family:${FONT};text-align:center;`,
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
  const chrome = options.omitFooter ? '' : `${renderSocial(theme, ctx, false)}\n${renderFooter(theme, ctx)}`;

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
