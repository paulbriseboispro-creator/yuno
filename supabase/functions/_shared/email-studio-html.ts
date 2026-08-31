// ─────────────────────────────────────────────────────────────────────────────
// Email Studio — rendu côté edge (Deno) + résolution des données live.
//
// ⚠️ PORT de src/lib/email/render.ts (+ themes/variables/types condensés).
// Les edge functions ne peuvent pas importer depuis src/ : toute modification
// du renderer front DOIT être répercutée ici, et inversement. Les tests
// unitaires du front (src/lib/email/__tests__) sont la référence de
// comportement. Visuels par bloc : prototype claude.design « Email Studio ».
//
// Les blocs Yuno (event, tickets, table, countdown) lisent la base AU RENDU :
// fetchStudioLiveData() est appelé une fois par tranche d'envoi, jamais par
// destinataire. Les règles de visibilité (cond) sont résolues par LOT via la
// RPC get_recipient_block_conds — jamais une requête par destinataire.
// ─────────────────────────────────────────────────────────────────────────────

// deno-lint-ignore-file no-explicit-any

export interface StudioTheme {
  name: string; bg: string; card: string; headerBg: string; headerText: string;
  text: string; muted: string; accent: string; btnText: string;
  divider: string; tile: string; footerBg: string; footerText: string; dark: boolean;
}

export interface StudioSocialLinks {
  instagram?: string; tiktok?: string; facebook?: string; x?: string; website?: string;
}

export interface StudioTicketRow { n: string; s: string; p: string; out: boolean }

export interface StudioLiveEventData {
  title: string; startAt: string; dateLabel: string; venueLabel: string;
  coverUrl?: string | null; url: string; priceFromLabel?: string | null;
  tickets?: StudioTicketRow[]; tablesLeft?: number | null;
}

export type StudioLiveData = Record<string, StudioLiveEventData>;

export interface StudioRecipient {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  city?: string | null;
  lastEventTitle?: string | null;
  loyaltyPoints?: number | null;
  /** Règles de visibilité satisfaites par CE destinataire. */
  conds?: Set<string>;
}

export interface StudioRenderCtx {
  venueName: string;
  city?: string | null;
  /** Logo du compte expéditeur — repli du bloc header (voir render.ts). */
  logoUrl?: string | null;
  emailType: 'promotional' | 'informational';
  subject: string;
  preheader?: string;
  recipient: StudioRecipient;
  unsubscribeUrl?: string;
  socialLinks?: StudioSocialLinks;
  hideBranding?: boolean;
  baseUrl: string;
  campaignId?: string;
  live?: StudioLiveData;
  now?: Date;
  /** true = envoi de test : les blocs conditionnels sont tous rendus. */
  ignoreConds?: boolean;
}

export type StudioBlock = { id: string; type: string } & Record<string, any>;

const FONT = "Arial,'Helvetica Neue',Helvetica,sans-serif";

const THEME_PRESETS: StudioTheme[] = [
  { name: 'classic_dark', bg: '#f3f4f6', card: '#ffffff', headerBg: '#0a0a0a', headerText: '#ffffff', text: '#1a1a1a', muted: '#7a7a7a', accent: '#dc2626', btnText: '#ffffff', divider: '#e5e7eb', tile: '#fafafa', footerBg: '#f9fafb', footerText: '#6b7280', dark: false },
  { name: 'clean_light', bg: '#fafafa', card: '#ffffff', headerBg: '#ffffff', headerText: '#0a0a0a', text: '#111111', muted: '#8a8a8a', accent: '#000000', btnText: '#ffffff', divider: '#ececec', tile: '#fbfbfb', footerBg: '#ffffff', footerText: '#9ca3af', dark: false },
  { name: 'yuno_red', bg: '#1a0606', card: '#ffffff', headerBg: '#dc2626', headerText: '#ffffff', text: '#1a1a1a', muted: '#7a7a7a', accent: '#dc2626', btnText: '#ffffff', divider: '#f0dede', tile: '#fff7f7', footerBg: '#fff5f5', footerText: '#9b6b6b', dark: false },
  { name: 'gold_night', bg: '#0a0a0a', card: '#0f0f0f', headerBg: '#0f0f0f', headerText: '#d4af37', text: '#f5f5f5', muted: '#8a8a8a', accent: '#d4af37', btnText: '#0a0a0a', divider: '#262626', tile: '#161616', footerBg: '#0a0a0a', footerText: '#9ca3af', dark: true },
];

export function normalizeStudioTheme(raw: unknown): StudioTheme {
  const partial = (raw && typeof raw === 'object' ? raw : {}) as Partial<StudioTheme>;
  const base = THEME_PRESETS.find((t) => t.name === partial.name) || THEME_PRESETS[0];
  return { ...base, ...partial, name: partial.name || base.name };
}

const LOGO_SIZES: Record<string, number> = { sm: 42, md: 54, lg: 72 };
const SPACER_SIZES: Record<string, number> = { sm: 8, md: 16, lg: 32, xl: 56 };
const DEFAULT_PX = 24;
const DEFAULT_PY = 18;

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Variables ────────────────────────────────────────────────────────────────

interface VariableDef { key: string; aliases: string[]; fallback: string }

const EMAIL_VARIABLES: VariableDef[] = [
  { key: 'prénom', aliases: ['prenom', 'first_name', 'firstname'], fallback: '' },
  { key: 'nom', aliases: ['last_name', 'lastname'], fallback: '' },
  { key: 'ville', aliases: ['city'], fallback: '' },
  { key: 'dernier_event', aliases: ['dernier_évent', 'last_event'], fallback: 'ta dernière soirée' },
  { key: 'points_fidélité', aliases: ['points_fidelite', 'loyalty_points'], fallback: '0' },
  { key: 'nom_club', aliases: ['club', 'venue_name'], fallback: '' },
];

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function interpolate(input: string, ctx: StudioRenderCtx): string {
  if (!input || input.indexOf('{{') === -1) return input;
  const r = ctx.recipient;
  const values: Record<string, string> = {
    'prénom': (r.firstName || '').trim(),
    'nom': (r.lastName || '').trim(),
    'ville': (r.city || ctx.city || '').trim(),
    'dernier_event': (r.lastEventTitle || '').trim(),
    'points_fidélité': r.loyaltyPoints != null ? String(r.loyaltyPoints) : '',
    'nom_club': ctx.venueName,
  };
  const lookup = new Map<string, VariableDef>();
  for (const def of EMAIL_VARIABLES) {
    lookup.set(stripAccents(def.key).toLowerCase(), def);
    for (const a of def.aliases) lookup.set(stripAccents(a).toLowerCase(), def);
  }
  return input.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (whole, rawKey: string) => {
    const def = lookup.get(stripAccents(rawKey).toLowerCase());
    if (!def) return whole;
    const value = values[def.key];
    return value && value.length > 0 ? value : def.fallback;
  }).replace(/ {2,}/g, ' ');
}

// ── Briques de rendu (miroir strict de src/lib/email/render.ts) ─────────────

function looksLikeHtml(body: string): boolean {
  return /<\s*(p|br|strong|em|b|i|a|u|ul|ol|li|span|div)[\s/>]/i.test(body || '');
}

interface InlineMarkupOpts { accent: string; track?: (url: string) => string }

/** Mini-markup inline (miroir strict de inlineMarkup dans src/lib/email/render.ts). */
function inlineMarkup(escaped: string, opts: InlineMarkupOpts): string {
  let s = escaped;
  s = s.replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, (_m, rawHref: string, label: string) => {
    const href = rawHref.replace(/&amp;/g, '&').trim();
    const url = opts.track ? opts.track(href) : href;
    return `<a href="${esc(url)}" target="_blank" rel="noreferrer" style="color:${opts.accent};text-decoration:underline;">${label}</a>`;
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

function plainToParagraphs(body: string, fontSize: number, color: string, markup: InlineMarkupOpts): string {
  const lines = String(body || '').split('\n');
  return lines
    .map((line, i) => `<p style="margin:0${i < lines.length - 1 ? ' 0 10px' : ''};font-size:${fontSize}px;line-height:1.6;color:${color};">${inlineMarkup(esc(line), markup)}</p>`)
    .join('');
}

function trackUrl(url: string, ctx: StudioRenderCtx): string {
  if (!url) return ctx.baseUrl;
  if (!ctx.campaignId) return url;
  if (!url.startsWith(ctx.baseUrl) && !url.startsWith('/')) return url;
  const abs = url.startsWith('/') ? `${ctx.baseUrl}${url}` : url;
  return `${abs}${abs.includes('?') ? '&' : '?'}yc=${encodeURIComponent(ctx.campaignId)}`;
}

function buttonHtml(opts: {
  href: string; label: string; bg: string; color: string;
  radius: number; full: boolean; ctx: StudioRenderCtx; small?: boolean;
}): string {
  const href = esc(trackUrl(opts.href, opts.ctx));
  const label = esc(opts.label);
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

/** Miroir strict de isHexColor / contrastText / ctaColors (src/lib/email/render.ts). */
function isHexColor(c: unknown): c is string {
  return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c.trim());
}

function contrastText(hex: string): '#111111' | '#ffffff' {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 150 ? '#111111' : '#ffffff';
}

function ctaColors(blockColor: unknown, theme: { accent: string; btnText: string }): { bg: string; color: string } {
  if (isHexColor(blockColor) && blockColor.trim().toLowerCase() !== theme.accent.toLowerCase()) {
    const bg = blockColor.trim();
    return { bg, color: contrastText(bg) };
  }
  return { bg: theme.accent, color: theme.btnText };
}

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

/** Marges par défaut PAR TYPE (miroir de TYPE_PAD_DEFAULTS dans src/lib/email/types.ts). */
const TYPE_PAD_DEFAULTS: Record<string, { px: number; py: number }> = {
  header: { px: 24, py: 30 },
  image: { px: 0, py: 0 },
  divider: { px: 24, py: 10 },
  social: { px: 24, py: 18 },
  cta: { px: 24, py: 24 },
  html: { px: 24, py: 0 },
};

function blockPad(b: StudioBlock): { px: number; py: number } {
  const d = TYPE_PAD_DEFAULTS[b.type] || { px: DEFAULT_PX, py: DEFAULT_PY };
  return { px: typeof b.px === 'number' ? b.px : d.px, py: typeof b.py === 'number' ? b.py : d.py };
}

function blockBg(b: StudioBlock, theme: StudioTheme): string {
  if (isHexColor(b.bgc)) return (b.bgc as string).trim();
  if (b.bg === 'tile') return theme.tile;
  if (b.bg === 'accent') return theme.dark ? 'rgba(212,175,55,0.07)' : 'rgba(232,25,44,0.05)';
  return 'transparent';
}

/** Icônes simpleicons : hex SANS # obligatoire — sinon gris sûr (miroir render.ts). */
function iconHex(custom: unknown, themeFallback: string): string {
  const src = isHexColor(custom) ? custom : themeFallback;
  const m = /^#([0-9a-fA-F]{6})$/.exec(String(src).trim());
  return m ? m[1] : '7a7a7a';
}

function condVisible(b: StudioBlock, ctx: StudioRenderCtx): boolean {
  if (!b.cond || ctx.ignoreConds) return true;
  return !!ctx.recipient.conds && ctx.recipient.conds.has(String(b.cond));
}

function td(inner: string, style: string): string {
  return `<tr><td style="${style}">${inner}</td></tr>`;
}

function renderTicketRows(rows: StudioTicketRow[], theme: StudioTheme, accent: string): string {
  return rows.map((r, i) => `
    <tr>
      <td style="padding:13px 16px;${i > 0 ? `border-top:1px solid ${theme.divider};` : ''}font-family:${FONT};">
        <p style="margin:0;font-size:14.5px;font-weight:600;color:${r.out ? theme.muted : theme.text};">${esc(r.n)}</p>
        ${r.s ? `<p style="margin:2px 0 0;font-size:12px;color:${theme.muted};">${esc(r.s)}</p>` : ''}
      </td>
      <td align="right" style="padding:13px 16px;${i > 0 ? `border-top:1px solid ${theme.divider};` : ''}font-family:${FONT};white-space:nowrap;">
        <span style="font-size:14.5px;font-weight:700;color:${r.out ? theme.muted : accent};${r.out ? 'text-decoration:line-through;' : ''}">${esc(r.p)}</span>
      </td>
    </tr>`).join('');
}

const SOCIAL_SLUG: Record<string, string> = {
  instagram: 'instagram', tiktok: 'tiktok', facebook: 'facebook', x: 'x', website: 'safari',
};

function renderSocial(
  theme: StudioTheme,
  ctx: StudioRenderCtx,
  standalone: boolean,
  opts: { pad?: { px: number; py: number }; iconColor?: unknown; bg?: string } = {},
): string {
  const entries = Object.entries(ctx.socialLinks || {})
    .filter(([, url]) => typeof url === 'string' && url.trim().length > 0) as [string, string][];
  if (entries.length === 0) return '';
  const color = iconHex(opts.iconColor, theme.muted);
  const cells = entries.map(([key, url]) => {
    const href = url.startsWith('http') ? url : `https://${url}`;
    return `<a href="${esc(href)}" target="_blank" rel="noreferrer" style="display:inline-block;margin:0 7px;text-decoration:none;"><img src="https://cdn.simpleicons.org/${SOCIAL_SLUG[key] || key}/${color}" alt="${key}" width="20" height="20" style="display:inline-block;border:0;" /></a>`;
  }).join('');
  const padding = standalone && opts.pad ? `${opts.pad.py}px ${opts.pad.px}px` : '18px 24px 4px';
  // Le bloc autonome respecte le fond choisi (bgc / tile / accent), sinon la carte.
  const bg = standalone
    ? (opts.bg && opts.bg !== 'transparent' ? opts.bg : theme.card)
    : theme.footerBg;
  return td(cells, `padding:${padding};text-align:center;background:${bg};`);
}

export function renderStudioBlock(b: StudioBlock, theme: StudioTheme, ctx: StudioRenderCtx): string {
  if (!condVisible(b, ctx)) return '';
  const pad = blockPad(b);
  const bg = blockBg(b, theme);
  switch (b.type) {
    case 'header': {
      const size = LOGO_SIZES[b.logoSize as string] || LOGO_SIZES.md;
      const radius = b.logoShape === 'circle' ? '50%' : b.logoShape === 'rounded' ? '14px' : '0';
      // Repli automatique sur le logo du compte (miroir de render.ts).
      const logoSrc = (b.logoUrl as string) || ctx.logoUrl || '';
      const logo = logoSrc
        ? `<img src="${esc(logoSrc)}" alt="${esc(b.venueName || ctx.venueName)}" width="${size}" height="${size}" style="width:${size}px;height:${size}px;object-fit:cover;display:block;margin:0 auto${b.showName ? ' 12px' : ''};border:0;border-radius:${radius};" />`
        : '';
      const name = b.showName
        ? `<h1 style="margin:0;font-family:${FONT};font-size:22px;line-height:28px;mso-line-height-rule:exactly;font-weight:700;color:${theme.headerText};letter-spacing:0.06em;">${esc(b.venueName || ctx.venueName)}</h1>`
        : '';
      return td(logo + name, `padding:${pad.py}px ${pad.px}px;text-align:center;background:${theme.headerBg};`);
    }
    case 'image': {
      if (!b.url) return '';
      const radius = typeof b.radius === 'number' && b.radius > 0 ? `border-radius:${Math.min(40, b.radius)}px;` : '';
      const img = `<img src="${esc(b.url)}" alt="${esc(b.label || '')}" width="600" style="width:100%;height:auto;display:block;border:0;${radius}" class="yn-img" />`;
      const linked = b.linkUrl
        ? `<a href="${esc(trackUrl(b.linkUrl as string, ctx))}" target="_blank" rel="noreferrer">${img}</a>`
        : img;
      return `<tr><td style="padding:${pad.py}px ${pad.px}px;background:${bg};font-size:0;line-height:0;">${linked}</td></tr>`;
    }
    case 'text': {
      const size = Math.max(11, Math.min(28, Number(b.size) || 16));
      const color = isHexColor(b.color) ? (b.color as string).trim() : theme.text;
      const raw = interpolate((b.body as string) || '', ctx);
      const markup: InlineMarkupOpts = { accent: theme.accent, track: (u) => trackUrl(u, ctx) };
      const inner = looksLikeHtml(raw) ? raw : plainToParagraphs(raw, size, color, markup);
      return td(inner, `padding:${pad.py}px ${pad.px}px;background:${bg};font-family:${FONT};font-size:${size}px;line-height:1.6;color:${color};text-align:${b.align || 'left'};`);
    }
    case 'cta': {
      const colors = ctaColors(b.color, theme);
      const btn = buttonHtml({
        href: (b.url as string) || ctx.baseUrl, label: interpolate((b.label as string) || '', ctx),
        bg: colors.bg, color: colors.color,
        radius: Number(b.radius ?? 8), full: !!b.full, ctx,
      });
      return td(btn, `padding:${pad.py}px ${pad.px}px;background:${bg};text-align:${b.align || 'center'};`);
    }
    case 'columns': {
      const col = (c: { title?: string; body?: string } | undefined, side: 'l' | 'r') =>
        `<td class="yn-col" width="50%" valign="top" style="${side === 'l' ? 'padding:0 7px 0 0;' : 'padding:0 0 0 7px;'}font-family:${FONT};">
          <p style="margin:0 0 3px;font-size:15px;font-weight:600;color:${theme.text};">${esc(interpolate(c?.title || '', ctx))}</p>
          <p style="margin:0;font-size:13px;line-height:1.6;color:${theme.muted};">${esc(interpolate(c?.body || '', ctx))}</p>
        </td>`;
      return td(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${col(b.left, 'l')}${col(b.right, 'r')}</tr></table>`,
        `padding:${pad.py}px ${pad.px}px;background:${bg};`,
      );
    }
    case 'event': {
      const live = b.eventId ? ctx.live?.[b.eventId as string] : undefined;
      const title = live?.title || (b.title as string) || '';
      const dateLabel = live?.dateLabel || (b.dateLabel as string) || '';
      const venueLabel = live?.venueLabel || (b.venueLabel as string) || '';
      const coverUrl = live?.coverUrl || (b.coverUrl as string | undefined);
      const url = live?.url || (b.ctaUrl as string) || ctx.baseUrl;
      const priceLabel = live?.priceFromLabel;
      const cover = b.cover !== false && coverUrl
        ? `<tr><td style="font-size:0;line-height:0;"><img src="${esc(coverUrl)}" alt="${esc(title)}" width="552" style="width:100%;max-width:552px;height:auto;display:block;border:0;" /></td></tr>`
        : '';
      const venueRow = b.venue !== false
        ? `<p style="margin:0 0 4px;font-family:${FONT};font-size:14px;color:${theme.muted};">${esc(venueLabel)}</p>`
        : '';
      const priceRow = b.price && priceLabel
        ? `<p style="margin:0 0 4px;font-family:${FONT};font-size:14px;color:${theme.muted};">${esc(priceLabel)}</p>`
        : '';
      const btnColors = ctaColors(b.accent, theme);
      const btn = buttonHtml({ href: url, label: (b.ctaLabel as string) || "Voir l'événement", bg: btnColors.bg, color: btnColors.color, radius: 6, full: false, ctx, small: true });
      const cardBg = theme.dark ? theme.tile : '#ffffff';
      return td(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${theme.divider};border-radius:12px;background:${cardBg};">
          ${cover}
          <tr><td style="padding:20px;">
            <h2 style="margin:0 0 8px;font-family:${FONT};font-size:20px;line-height:26px;mso-line-height-rule:exactly;font-weight:700;color:${theme.text};">${esc(title)}</h2>
            <p style="margin:0 0 4px;font-family:${FONT};font-size:14px;color:${theme.muted};">${esc(dateLabel)}</p>
            ${venueRow}
            ${priceRow}
            <div style="height:14px;line-height:14px;font-size:0;">&nbsp;</div>
            ${btn}
          </td></tr>
        </table>`,
        `padding:${pad.py}px ${pad.px}px;background:${bg};`,
      );
    }
    case 'tickets': {
      const live = b.eventId ? ctx.live?.[b.eventId as string] : undefined;
      // Live branché : la base fait foi. Un événement SANS billetterie (guest
      // list seule) efface le bloc — jamais de tarifs inventés (miroir render.ts).
      const rows: StudioTicketRow[] = (b.live !== false && live)
        ? (live.tickets || [])
        : ((b.rows as StudioTicketRow[]) || []);
      if (!rows || rows.length === 0) return '';
      const url = live?.url || ctx.baseUrl;
      const btnColors = ctaColors(b.accent, theme);
      const btn = buttonHtml({ href: url, label: 'Prendre mes billets', bg: btnColors.bg, color: btnColors.color, radius: 8, full: true, ctx, small: true });
      return td(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${theme.divider};border-radius:12px;">
          ${renderTicketRows(rows, theme, btnColors.bg)}
        </table>
        <div style="height:12px;line-height:12px;font-size:0;">&nbsp;</div>
        ${btn}`,
        `padding:${pad.py}px ${pad.px}px;background:${bg};`,
      );
    }
    case 'table': {
      const live = b.eventId ? ctx.live?.[b.eventId as string] : undefined;
      const url = live?.url || (b.ctaUrl as string) || ctx.baseUrl;
      const left = live?.tablesLeft;
      const btnColors = ctaColors(b.accent, theme);
      const accent = btnColors.bg;
      const leftRow = typeof left === 'number' && left >= 0
        ? `<p style="margin:0 0 10px;font-family:${FONT};font-size:12.5px;font-weight:700;color:${accent};">${left <= 0 ? 'Complet ce soir' : `${left} table${left > 1 ? 's' : ''} encore libre${left > 1 ? 's' : ''}`}</p>`
        : '';
      const btn = buttonHtml({ href: url, label: (b.ctaLabel as string) || 'Réserver une table', bg: btnColors.bg, color: btnColors.color, radius: 6, full: false, ctx, small: true });
      const cardBorder = theme.dark ? 'rgba(212,175,55,0.28)' : theme.divider;
      const cardBg = theme.dark ? 'rgba(212,175,55,0.06)' : theme.tile;
      return td(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${cardBorder};border-radius:12px;background:${cardBg};">
          <tr><td style="padding:18px;">
            <p style="margin:0 0 8px;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${accent};">${esc(b.kicker || 'Bottle service')}</p>
            <h2 style="margin:0 0 6px;font-family:${FONT};font-size:17px;line-height:23px;mso-line-height-rule:exactly;font-weight:600;color:${theme.text};">${esc(interpolate((b.title as string) || '', ctx))}</h2>
            <p style="margin:0 0 12px;font-family:${FONT};font-size:13.5px;line-height:1.6;color:${theme.muted};">${esc(interpolate((b.sub as string) || '', ctx))}</p>
            ${leftRow}
            ${btn}
          </td></tr>
        </table>`,
        `padding:${pad.py}px ${pad.px}px;background:${bg};`,
      );
    }
    case 'countdown': {
      const live = b.eventId ? ctx.live?.[b.eventId as string] : undefined;
      // L'événement live prime ; sinon la date cible manuelle (ISO UTC).
      const startIso = live?.startAt || (typeof b.targetAt === 'string' ? b.targetAt : '');
      const parts = startIso ? countdownParts(startIso, ctx.now || new Date()) : null;
      if (!parts) return '';
      const accent = isHexColor(b.accent) ? (b.accent as string).trim() : theme.accent;
      const cell = (num: string, unit: string) =>
        `<td width="33%" style="padding:0 5px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:10px 0;border-radius:9px;background:${theme.tile};text-align:center;">
          <p style="margin:0;font-family:${FONT};font-size:24px;font-weight:700;color:${accent};">${num}</p>
          <p style="margin:2px 0 0;font-family:${FONT};font-size:10px;letter-spacing:.1em;color:${theme.muted};">${unit}</p>
        </td></tr></table></td>`;
      return td(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${theme.divider};border-radius:12px;"><tr><td style="padding:18px;text-align:center;">
          <p style="margin:0 0 12px;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${theme.muted};">${esc(b.label || '')}</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            ${cell(pad2(parts.days), 'JOURS')}${cell(pad2(parts.hours), 'HEURES')}${cell(pad2(parts.mins), 'MIN')}
          </tr></table>
        </td></tr></table>`,
        `padding:${pad.py}px ${pad.px}px;background:${bg};`,
      );
    }
    case 'social':
      return renderSocial(theme, ctx, true, { pad, iconColor: b.color, bg });
    case 'divider': {
      const color = isHexColor(b.color) ? (b.color as string).trim() : theme.divider;
      return td(`<hr style="border:none;border-top:1px solid ${color};margin:0;" />`, `padding:${pad.py}px ${pad.px}px;background:${bg};`);
    }
    case 'spacer': {
      const h = SPACER_SIZES[b.size as string] || SPACER_SIZES.md;
      return `<tr><td style="height:${h}px;line-height:${h}px;mso-line-height-rule:exactly;font-size:0;background:${bg};">&nbsp;</td></tr>`;
    }
    case 'html':
      return `<tr><td style="padding:${pad.py}px ${pad.px}px;background:${bg};">${interpolate((b.code as string) || '', ctx)}</td></tr>`;
    default:
      return '';
  }
}

function renderFooter(theme: StudioTheme, ctx: StudioRenderCtx): string {
  const year = (ctx.now || new Date()).getFullYear();
  const reason = ctx.emailType === 'promotional'
    ? 'vous êtes abonné à sa newsletter'
    : 'vous avez acheté un billet';
  const onPlatform = ctx.hideBranding ? '' : ' sur Yuno';
  const viaPlatform = ctx.hideBranding ? '' : ' via Yuno';
  const unsub = ctx.emailType === 'promotional' && ctx.unsubscribeUrl
    ? `<p style="margin:8px 0 0;font-size:11.5px;"><a href="${esc(ctx.unsubscribeUrl)}" style="color:${theme.accent};text-decoration:underline;">Se désabonner</a></p>`
    : '';
  return td(
    `<p style="margin:0 0 6px;font-size:12px;font-weight:600;color:${theme.footerText};">${esc(ctx.venueName)}${ctx.city ? ' — ' + esc(ctx.city) : ''}</p>
     <p style="margin:0;font-size:11.5px;line-height:1.6;color:${theme.footerText};">Cet email a été envoyé à ${esc(ctx.recipient.email)} car ${reason}${onPlatform}.</p>
     <p style="margin:4px 0 0;font-size:11.5px;line-height:1.6;color:${theme.footerText};">© ${year} ${esc(ctx.venueName)}${viaPlatform}. Tous droits réservés.</p>
     ${unsub}`,
    `padding:22px 24px;background:${theme.footerBg};border-top:1px solid ${theme.divider};font-family:${FONT};text-align:center;`,
  );
}

export function renderStudioEmailHtml(
  blocks: StudioBlock[],
  themeRaw: unknown,
  ctx: StudioRenderCtx,
): string {
  const theme = normalizeStudioTheme(themeRaw);
  const blocksHtml = blocks.map((b) => renderStudioBlock(b, theme, ctx)).join('\n');
  const preheaderText = ctx.preheader ? interpolate(ctx.preheader, ctx) : '';
  const preheader = preheaderText
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:${theme.bg};">${esc(preheaderText)}${'&#8199;&#847; '.repeat(30)}</div>`
    : '';
  const chrome = `${renderSocial(theme, ctx, false)}\n${renderFooter(theme, ctx)}`;

  return `<!DOCTYPE html>
<html lang="fr" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="${theme.dark ? 'dark' : 'light dark'}">
<meta name="supported-color-schemes" content="${theme.dark ? 'dark' : 'light dark'}">
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<title>${esc(ctx.subject)}</title>
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

// ── Données live des blocs Yuno ──────────────────────────────────────────────
// Une requête par tranche d'envoi, jamais par destinataire. Un échec de fetch
// ne fait JAMAIS échouer l'envoi : le bloc retombe sur ses props figées.

function euro(amount: number): string {
  return `${Number.isInteger(amount) ? amount : amount.toFixed(2).replace('.', ',')} €`;
}

export function collectStudioEventIds(blocks: StudioBlock[], fallbackEventId?: string | null): string[] {
  const ids = new Set<string>();
  for (const b of blocks) {
    if (['event', 'tickets', 'table', 'countdown'].includes(b.type)) {
      const id = (b.eventId as string) || fallbackEventId || '';
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

/** Règles de visibilité utilisées par la campagne (pour la résolution par lot). */
export function collectStudioConds(blocks: StudioBlock[]): string[] {
  const out = new Set<string>();
  for (const b of blocks) {
    if (typeof b.cond === 'string' && b.cond) out.add(b.cond);
  }
  return [...out];
}

/**
 * Résout les règles de visibilité pour UN LOT de destinataires via la RPC
 * get_recipient_block_conds. Échec ⇒ map vide : les blocs conditionnels
 * s'effacent (l'audience rétrécit, jamais l'inverse).
 */
export async function fetchRecipientConds(
  admin: any,
  campaignId: string,
  emails: string[],
  usedConds: string[],
): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>();
  if (usedConds.length === 0 || emails.length === 0) return map;
  try {
    const { data, error } = await admin.rpc('get_recipient_block_conds', {
      p_campaign_id: campaignId,
      p_emails: emails,
    });
    if (error) throw error;
    for (const row of (data || []) as { email: string; cond: string }[]) {
      const key = String(row.email || '').toLowerCase();
      if (!map.has(key)) map.set(key, new Set());
      map.get(key)!.add(row.cond);
    }
  } catch (e) {
    console.error('fetchRecipientConds failed (blocs conditionnels masqués):', e instanceof Error ? e.message : e);
  }
  return map;
}

export async function fetchStudioLiveData(
  admin: any,
  blocks: StudioBlock[],
  fallbackEventId: string | null,
  publicUrl: string,
): Promise<StudioLiveData> {
  const live: StudioLiveData = {};
  const ids = collectStudioEventIds(blocks, fallbackEventId);
  if (ids.length === 0) return live;

  try {
    const { data: events } = await admin
      .from('events')
      .select('id, title, start_at, timezone, slug, poster_url, image_url, venue_id, partner_venue_id, location_name, location_city, ticketing_enabled, tables_enabled')
      .in('id', ids);

    const venueIds = [...new Set((events || []).map((e: any) => e.venue_id || e.partner_venue_id).filter(Boolean))];
    const { data: venues } = venueIds.length
      ? await admin.from('venues').select('id, name, city').in('id', venueIds)
      : { data: [] };
    const venueById = new Map<string, any>((venues || []).map((v: any) => [v.id, v]));

    const { data: rounds } = await admin
      .from('ticket_rounds')
      .select('event_id, name, description, price, max_tickets, tickets_sold, is_active, manually_sold_out, position')
      .in('event_id', ids)
      .order('position', { ascending: true });

    const needTables = blocks.some((b) => b.type === 'table');
    let packsByEvent = new Map<string, number>();
    let reservedByEvent = new Map<string, number>();
    if (needTables) {
      const { data: packs } = await admin
        .from('table_packs')
        .select('event_id, venue_id, tables_count, is_active')
        .eq('is_active', true);
      const { data: reservations } = await admin
        .from('table_reservations')
        .select('event_id, status')
        .in('event_id', ids)
        .in('status', ['paid', 'confirmed']);
      packsByEvent = new Map();
      reservedByEvent = new Map();
      for (const e of events || []) {
        const venueId = e.venue_id || e.partner_venue_id;
        let total = 0;
        for (const p of packs || []) {
          if (p.event_id === e.id || (!p.event_id && venueId && p.venue_id === venueId)) {
            total += Number(p.tables_count || 0);
          }
        }
        packsByEvent.set(e.id, total);
      }
      for (const r of reservations || []) {
        reservedByEvent.set(r.event_id, (reservedByEvent.get(r.event_id) || 0) + 1);
      }
    }

    for (const e of events || []) {
      const venue = venueById.get(e.venue_id || e.partner_venue_id);
      const venueName = venue?.name || e.location_name || '';
      const city = venue?.city || e.location_city || '';
      const tz = e.timezone && String(e.timezone).trim() ? e.timezone : 'Europe/Paris';
      const start = new Date(e.start_at);
      const dateLabel = `${start.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz })} · ${start.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: tz })}`;

      const evRounds = (rounds || []).filter((r: any) => r.event_id === e.id);
      const isOut = (r: any) => !!(r.manually_sold_out || (r.max_tickets != null && Number(r.tickets_sold || 0) >= Number(r.max_tickets)));
      const visible = evRounds.filter((r: any) => r.is_active || isOut(r)).slice(0, 4);
      const tickets: StudioTicketRow[] = visible.map((r: any) => ({
        n: r.name || 'Billet',
        s: r.description || '',
        p: euro(Number(r.price || 0)),
        out: isOut(r),
      }));
      const activePrices = evRounds
        .filter((r: any) => r.is_active && !isOut(r))
        .map((r: any) => Number(r.price || 0));
      const priceFrom = activePrices.length ? Math.min(...activePrices) : null;

      const totalTables = packsByEvent.get(e.id) || 0;
      const tablesLeft = needTables && totalTables > 0
        ? Math.max(0, totalTables - (reservedByEvent.get(e.id) || 0))
        : null;

      live[e.id] = {
        title: e.title,
        startAt: e.start_at,
        dateLabel: dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1),
        venueLabel: city ? `${venueName} — ${city}` : venueName,
        coverUrl: e.poster_url || e.image_url || null,
        url: `${publicUrl}/event/${e.slug || e.id}`,
        priceFromLabel: priceFrom != null ? `À partir de ${euro(priceFrom)}` : null,
        // Tableau TOUJOURS présent : vide = pas de billetterie (bloc effacé),
        // undefined = événement non résolu (le bloc retombe sur ses props).
        tickets,
        tablesLeft,
      };
    }
  } catch (e) {
    console.error('fetchStudioLiveData failed (blocs sur props figées):', e instanceof Error ? e.message : e);
  }

  // Les blocs sans eventId propre héritent de l'événement de la campagne.
  if (fallbackEventId && live[fallbackEventId]) {
    for (const b of blocks) {
      if (['event', 'tickets', 'table', 'countdown'].includes(b.type) && !b.eventId) {
        b.eventId = fallbackEventId;
      }
    }
  }

  return live;
}
