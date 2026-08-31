// ─────────────────────────────────────────────────────────────────────────────
// Email Studio — rendu HTML email. PUR : (blocks, theme, ctx) => string.
// Aucune dépendance DOM/réseau — testable, portable Deno.
//
// Contraintes non négociables (voir docs/designs/EMAIL_STUDIO_PLAN.md) :
// tables imbriquées + styles inline (600 px), fallbacks MSO/VML pour Outlook,
// media queries mobiles en <head> en complément, dark mode via meta +
// prefers-color-scheme, preheader caché, alt obligatoire, interpolation des
// variables au rendu, lien de désinscription dans le footer promotionnel.
//
// ⚠️ Port Deno : supabase/functions/_shared/email-studio-html.ts embarque une
// copie de ce fichier. Toute modification ici doit y être répercutée.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  EmailBlock, EmailTheme, RenderCtx, SocialLinks, TicketRow,
  HeaderBlock, ImageBlock, TextBlock, CtaBlock, ColumnsBlock, EventBlock,
  TicketsBlock, TableBlock, CountdownBlock, SpacerBlock, HtmlBlock,
} from './types';
import { LOGO_SIZES, SPACER_SIZES } from './types';
import { interpolateVariables } from './variables';

const FONT = "Arial,'Helvetica Neue',Helvetica,sans-serif";

export function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
  const height = opts.small ? 40 : 46;
  const fontSize = opts.small ? 14 : 15;
  const arc = Math.max(0, Math.min(50, Math.round((opts.radius / height) * 100)));
  const widthAttr = opts.full ? 'width:100%;' : 'width:240px;';
  const aWidth = opts.full ? 'display:block;' : 'display:inline-block;';
  return `<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:${height}px;v-text-anchor:middle;${widthAttr}" arcsize="${arc}%" strokecolor="${opts.bg}" fillcolor="${opts.bg}"><w:anchorlock/><center style="color:${opts.color};font-family:${FONT};font-size:${fontSize}px;font-weight:700;">${label}</center></v:roundrect>
<![endif]--><!--[if !mso]><!--><a href="${href}" target="_blank" rel="noreferrer" style="${aWidth}background:${opts.bg};color:${opts.color};text-decoration:none;font-family:${FONT};font-weight:700;font-size:${fontSize}px;line-height:${height}px;mso-line-height-rule:exactly;padding:0 ${opts.small ? 20 : 32}px;border-radius:${opts.radius}px;text-align:center;">${label}</a><!--<![endif]-->`;
}

/** « J-3 » / « Dans 14 h » / « C'est maintenant » — calculé au rendu. */
export function formatCountdown(startAtIso: string, now: Date): string {
  const start = new Date(startAtIso).getTime();
  if (!Number.isFinite(start)) return '';
  const diff = start - now.getTime();
  if (diff <= 0) return 'C’est maintenant';
  const totalHours = Math.floor(diff / 3_600_000);
  const days = Math.floor(totalHours / 24);
  if (days >= 2) return `J-${days}`;
  if (totalHours >= 1) {
    const mins = Math.floor((diff % 3_600_000) / 60_000);
    return totalHours >= 10 ? `Dans ${totalHours} h` : `Dans ${totalHours} h ${String(mins).padStart(2, '0')}`;
  }
  return `Dans ${Math.max(1, Math.floor(diff / 60_000))} min`;
}

// ── Rendu par type de bloc ───────────────────────────────────────────────────

type R = (theme: EmailTheme, ctx: RenderCtx) => string;

function td(inner: string, style: string, extra = ''): string {
  return `<tr><td ${extra}style="${style}">${inner}</td></tr>`;
}

function renderHeader(b: HeaderBlock, theme: EmailTheme, ctx: RenderCtx): string {
  const size = LOGO_SIZES[b.logoSize] || LOGO_SIZES.md;
  const radius = b.logoShape === 'circle' ? '50%' : b.logoShape === 'rounded' ? '12px' : '0';
  const logo = b.logoUrl
    ? `<img src="${escapeHtml(b.logoUrl)}" alt="${escapeHtml(b.venueName || ctx.venueName)}" width="${size}" height="${size}" style="width:${size}px;height:${size}px;object-fit:cover;display:block;margin:0 auto${b.showName ? ' 12px' : ''};border:0;border-radius:${radius};" />`
    : '';
  const name = b.showName
    ? `<h1 style="margin:0;font-family:${FONT};font-size:22px;line-height:28px;mso-line-height-rule:exactly;font-weight:700;color:${theme.headerText};letter-spacing:1px;">${escapeHtml(b.venueName || ctx.venueName)}</h1>`
    : '';
  return td(logo + name, `padding:30px 24px;text-align:center;background:${theme.headerBg};`);
}

function renderImage(b: ImageBlock, theme: EmailTheme, ctx: RenderCtx): string {
  if (!b.url) {
    return td(
      `<div style="height:${b.h}px;line-height:${b.h}px;mso-line-height-rule:exactly;background:${theme.tile};border:1px dashed ${theme.divider};border-radius:8px;text-align:center;font-family:${FONT};font-size:12px;color:${theme.muted};">${escapeHtml(b.label || 'Image')}</div>`,
      'padding:16px 24px;',
    );
  }
  const img = `<img src="${escapeHtml(b.url)}" alt="${escapeHtml(b.label)}" width="552" style="width:100%;max-width:552px;height:auto;display:block;border:0;border-radius:8px;" class="yn-img" />`;
  const linked = b.linkUrl
    ? `<a href="${escapeHtml(trackUrl(b.linkUrl, ctx))}" target="_blank" rel="noreferrer">${img}</a>`
    : img;
  return td(linked, 'padding:16px 24px;');
}

function renderText(b: TextBlock, theme: EmailTheme, ctx: RenderCtx): string {
  const body = interpolateVariables(b.body || '', ctx);
  const size = Math.max(11, Math.min(28, b.size || 16));
  return td(
    body,
    `padding:20px 24px;font-family:${FONT};font-size:${size}px;line-height:1.6;color:${theme.text};text-align:${b.align || 'left'};`,
  );
}

function renderCta(b: CtaBlock, theme: EmailTheme, ctx: RenderCtx): string {
  const btn = buttonHtml({
    href: b.url, label: interpolateVariables(b.label, ctx),
    bg: theme.accent, color: theme.btnText,
    radius: b.radius ?? 8, full: !!b.full, ctx,
  });
  return td(btn, `padding:20px 24px;text-align:${b.align || 'center'};`);
}

function renderColumns(b: ColumnsBlock, theme: EmailTheme, ctx: RenderCtx): string {
  const col = (c: { title: string; body: string }, pad: string) =>
    `<td class="yn-col" width="50%" valign="top" style="${pad}font-family:${FONT};">
      <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:${theme.text};">${escapeHtml(interpolateVariables(c.title, ctx))}</p>
      <p style="margin:0;font-size:13px;line-height:1.6;color:${theme.muted};">${escapeHtml(interpolateVariables(c.body, ctx))}</p>
    </td>`;
  return td(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${col(b.left, 'padding:0 10px 0 0;')}${col(b.right, 'padding:0 0 0 10px;')}</tr></table>`,
    'padding:16px 24px;',
  );
}

function renderEvent(b: EventBlock, theme: EmailTheme, ctx: RenderCtx): string {
  const live = b.eventId ? ctx.live?.[b.eventId] : undefined;
  const title = live?.title || b.title;
  const dateLabel = live?.dateLabel || b.dateLabel;
  const venueLabel = live?.venueLabel || b.venueLabel;
  const coverUrl = live?.coverUrl || b.coverUrl;
  const url = live?.url || b.ctaUrl || ctx.baseUrl;
  const priceLabel = live?.priceFromLabel;

  const cover = b.cover && coverUrl
    ? `<tr><td><img src="${escapeHtml(coverUrl)}" alt="${escapeHtml(title)}" width="552" style="width:100%;max-width:552px;height:auto;display:block;border:0;" /></td></tr>`
    : '';
  const priceRow = b.price && priceLabel
    ? `<p style="margin:0 0 14px;font-family:${FONT};font-size:13px;font-weight:700;color:${theme.accent};">${escapeHtml(priceLabel)}</p>`
    : '';
  const venueRow = b.venue
    ? `<p style="margin:0 0 4px;font-family:${FONT};font-size:13px;color:${theme.muted};">${escapeHtml(venueLabel)}</p>`
    : '';
  const btn = buttonHtml({ href: url, label: b.ctaLabel || 'Voir la soirée', bg: theme.accent, color: theme.btnText, radius: 8, full: false, ctx, small: true });
  return td(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${theme.divider};border-radius:12px;background:${theme.tile};">
      ${cover}
      <tr><td style="padding:18px 20px;">
        <h2 style="margin:0 0 6px;font-family:${FONT};font-size:19px;line-height:24px;mso-line-height-rule:exactly;color:${theme.text};">${escapeHtml(title)}</h2>
        <p style="margin:0 0 4px;font-family:${FONT};font-size:13px;color:${theme.muted};">${escapeHtml(dateLabel)}</p>
        ${venueRow}
        ${priceRow || '<div style="height:10px;line-height:10px;font-size:0;">&nbsp;</div>'}
        ${btn}
      </td></tr>
    </table>`,
    'padding:16px 24px;',
  );
}

function renderTicketRows(rows: TicketRow[], theme: EmailTheme): string {
  return rows.map((r, i) => `
    <tr>
      <td style="padding:12px 16px;${i > 0 ? `border-top:1px solid ${theme.divider};` : ''}font-family:${FONT};">
        <p style="margin:0;font-size:14px;font-weight:700;color:${theme.text};${r.out ? 'text-decoration:line-through;opacity:.55;' : ''}">${escapeHtml(r.n)}</p>
        ${r.s ? `<p style="margin:2px 0 0;font-size:12px;color:${theme.muted};">${escapeHtml(r.s)}</p>` : ''}
      </td>
      <td align="right" style="padding:12px 16px;${i > 0 ? `border-top:1px solid ${theme.divider};` : ''}font-family:${FONT};white-space:nowrap;">
        ${r.out
      ? `<span style="font-size:11px;font-weight:700;letter-spacing:.06em;color:${theme.muted};text-transform:uppercase;">Épuisé</span>`
      : `<span style="font-size:14px;font-weight:700;color:${theme.text};">${escapeHtml(r.p)}</span>`}
      </td>
    </tr>`).join('');
}

function renderTickets(b: TicketsBlock, theme: EmailTheme, ctx: RenderCtx): string {
  const live = b.eventId ? ctx.live?.[b.eventId] : undefined;
  const rows = (b.live && live?.tickets && live.tickets.length > 0) ? live.tickets : b.rows;
  if (!rows || rows.length === 0) return '';
  const url = live?.url || ctx.baseUrl;
  const btn = buttonHtml({ href: url, label: 'Prendre mes billets', bg: theme.accent, color: theme.btnText, radius: 8, full: true, ctx, small: true });
  return td(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${theme.divider};border-radius:12px;background:${theme.tile};">
      ${renderTicketRows(rows, theme)}
      <tr><td colspan="2" style="padding:14px 16px 16px;">${btn}</td></tr>
    </table>`,
    'padding:16px 24px;',
  );
}

function renderTable(b: TableBlock, theme: EmailTheme, ctx: RenderCtx): string {
  const live = b.eventId ? ctx.live?.[b.eventId] : undefined;
  const url = live?.url || b.ctaUrl || ctx.baseUrl;
  const left = live?.tablesLeft;
  const leftRow = typeof left === 'number' && left >= 0
    ? `<p style="margin:0 0 12px;font-family:${FONT};font-size:12px;font-weight:700;color:${theme.accent};">${left <= 0 ? 'Complet ce soir' : `${left} table${left > 1 ? 's' : ''} encore libre${left > 1 ? 's' : ''}`}</p>`
    : '';
  const btn = buttonHtml({ href: url, label: b.ctaLabel || 'Réserver une table', bg: theme.accent, color: theme.btnText, radius: 8, full: false, ctx, small: true });
  return td(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${theme.divider};border-radius:12px;background:${theme.tile};">
      <tr><td style="padding:18px 20px;">
        <p style="margin:0 0 4px;font-family:${FONT};font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${theme.muted};">${escapeHtml(b.cond || 'VIP · Table')}</p>
        <h2 style="margin:0 0 6px;font-family:${FONT};font-size:18px;line-height:23px;mso-line-height-rule:exactly;color:${theme.text};">${escapeHtml(interpolateVariables(b.title, ctx))}</h2>
        <p style="margin:0 0 12px;font-family:${FONT};font-size:13px;line-height:1.5;color:${theme.muted};">${escapeHtml(interpolateVariables(b.sub, ctx))}</p>
        ${leftRow}
        ${btn}
      </td></tr>
    </table>`,
    'padding:16px 24px;',
  );
}

function renderCountdown(b: CountdownBlock, theme: EmailTheme, ctx: RenderCtx): string {
  const live = b.eventId ? ctx.live?.[b.eventId] : undefined;
  const value = live?.startAt ? formatCountdown(live.startAt, ctx.now || new Date()) : '';
  if (!value) {
    // Pas d'événement branché : le bloc s'efface plutôt que d'afficher un
    // compte à rebours faux — un countdown figé est pire que pas de countdown.
    return '';
  }
  return td(
    `<p style="margin:0 0 6px;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${theme.muted};">${escapeHtml(b.label || '')}</p>
     <p style="margin:0;font-family:${FONT};font-size:34px;line-height:40px;mso-line-height-rule:exactly;font-weight:800;color:${theme.accent};">${escapeHtml(value)}</p>`,
    'padding:22px 24px;text-align:center;',
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
  return td(cells, `padding:${standalone ? '18px' : '20px'} 24px 4px;text-align:center;${standalone ? '' : `background:${theme.footerBg};`}`);
}

function renderSpacer(b: SpacerBlock): string {
  const h = SPACER_SIZES[b.size] || SPACER_SIZES.md;
  return `<tr><td style="height:${h}px;line-height:${h}px;mso-line-height-rule:exactly;font-size:0;">&nbsp;</td></tr>`;
}

function renderDivider(theme: EmailTheme): string {
  return td(`<hr style="border:none;border-top:1px solid ${theme.divider};margin:0;" />`, 'padding:8px 24px;');
}

function renderHtmlBlock(b: HtmlBlock, ctx: RenderCtx): string {
  return `<tr><td style="padding:0 24px;">${interpolateVariables(b.code || '', ctx)}</td></tr>`;
}

export function renderBlock(b: EmailBlock, theme: EmailTheme, ctx: RenderCtx): string {
  switch (b.type) {
    case 'header': return renderHeader(b, theme, ctx);
    case 'image': return renderImage(b, theme, ctx);
    case 'text': return renderText(b, theme, ctx);
    case 'cta': return renderCta(b, theme, ctx);
    case 'columns': return renderColumns(b, theme, ctx);
    case 'event': return renderEvent(b, theme, ctx);
    case 'tickets': return renderTickets(b, theme, ctx);
    case 'table': return renderTable(b, theme, ctx);
    case 'countdown': return renderCountdown(b, theme, ctx);
    case 'social': return renderSocial(theme, ctx, true);
    case 'divider': return renderDivider(theme);
    case 'spacer': return renderSpacer(b);
    case 'html': return renderHtmlBlock(b, ctx);
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
    ? `<p style="margin:12px 0 0;font-size:11px;color:${theme.footerText};">Vous ne souhaitez plus recevoir ces emails ? <a href="${escapeHtml(ctx.unsubscribeUrl)}" style="color:${theme.footerText};text-decoration:underline;">Se désabonner en un clic</a></p>`
    : '';
  return td(
    `<p style="margin:0 0 8px;font-weight:700;color:${theme.footerText};">${escapeHtml(ctx.venueName)}${ctx.city ? ' — ' + escapeHtml(ctx.city) : ''}</p>
     <p style="margin:0 0 8px;">Cet email a été envoyé à ${escapeHtml(ctx.recipient.email)} car ${reason}${onPlatform}.</p>
     <p style="margin:0;">© ${year} ${escapeHtml(ctx.venueName)}${viaPlatform}. Tous droits réservés.</p>
     ${unsub}`,
    `padding:22px 24px;background:${theme.footerBg};border-top:1px solid ${theme.divider};font-family:${FONT};font-size:12px;line-height:1.6;color:${theme.footerText};text-align:center;`,
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
    .yn-img{border-radius:6px!important;}
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
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" class="yn-container" style="width:600px;max-width:600px;background:${theme.card};border-radius:12px;overflow:hidden;">
${blocksHtml}
${chrome}
    </table>
  </td></tr>
</table>
</body></html>`;
}
