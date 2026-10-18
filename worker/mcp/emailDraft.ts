// Brouillons d'e-mails dessinés par l'IA : de la demande de l'IA (sections
// HTML avec balises Yuno, thème, audiences) au contenu d'une campagne du
// Studio (blocs v2), contrôlé avant d'être écrit.
//
// Le Worker ne fait que préparer et contrôler : l'écriture elle-même, ses
// droits et ses débits vivent dans mcp_write (migration 20261009150000).
// Pur et testé (worker/mcp/__tests__/emailDraft.test.ts).

import {
  buildSmartData, hasSmartSalesLink, lintEmail, lintSmartSection, sanitizeSectionHtml, sectionText, smartNeeds,
  type SmartEvent, type SmartIssue, type SmartLang,
} from '../../supabase/functions/_shared/email-smart';
import { emailWords } from '../../supabase/functions/_shared/email-words';

export const SECTION_SHOW_TO = ['everyone', 'vip_table', 'no_vip_table', 'buyers', 'no_buyers', 'new_subscribers'] as const;
export const NATIVE_BLOCKS = ['event', 'tickets', 'lineup', 'countdown', 'table', 'guestlist', 'social', 'divider', 'spacer'] as const;
type NativeBlock = typeof NATIVE_BLOCKS[number];

const HEX = /^#[0-9a-fA-F]{6}$/;

export interface SectionInput {
  html?: string;
  yuno_block?: NativeBlock;
  options?: Record<string, unknown>;
  label?: string;
  show_to?: typeof SECTION_SHOW_TO[number];
  padding?: number;
  background?: string;
}

export interface ThemeInput {
  background?: string;
  card?: string;
  text?: string;
  muted?: string;
  accent?: string;
  button_text?: string;
  divider?: string;
  footer_background?: string;
  footer_text?: string;
  dark?: boolean;
  radius?: number;
  footer_social?: boolean;
}

// ── Couleurs (miroir de contrastText / mixHex, render.ts) ────────────────────

function lum(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

function contrastText(hex: string): '#111111' | '#ffffff' {
  return HEX.test(hex) && lum(hex) > 150 / 255 ? '#111111' : '#ffffff';
}

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) * t + ((pb >> s) & 255) * (1 - t));
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`;
}

const hex = (v: unknown): string | undefined => (typeof v === 'string' && HEX.test(v.trim()) ? v.trim().toLowerCase() : undefined);

/**
 * Thème de l'e-mail (EmailTheme du Studio) depuis les couleurs de l'IA. Ce
 * qui manque se déduit des couleurs données : un thème sombre reste sombre de
 * bout en bout, pied de page légal compris.
 */
export function themeFromInput(t: ThemeInput | undefined): Record<string, unknown> | undefined {
  if (!t || typeof t !== 'object') return undefined;
  const card = hex(t.card) ?? (t.dark ? '#111111' : '#ffffff');
  const dark = typeof t.dark === 'boolean' ? t.dark : lum(card) < 0.45;
  const text = hex(t.text) ?? (dark ? '#f5f5f5' : '#151515');
  const accent = hex(t.accent) ?? (dark ? '#ff5a1f' : '#e3141b');
  const bg = hex(t.background) ?? (dark ? '#0a0a0a' : '#f3f4f6');
  const muted = hex(t.muted) ?? mix(text, card, 0.6);
  const footerBg = hex(t.footer_background) ?? card;
  const out: Record<string, unknown> = {
    name: 'ai',
    bg,
    card,
    headerBg: card,
    headerText: text,
    text,
    muted,
    accent,
    btnText: hex(t.button_text) ?? contrastText(accent),
    divider: hex(t.divider) ?? mix(text, card, 0.14),
    tile: mix(text, card, 0.05),
    footerBg,
    footerText: hex(t.footer_text) ?? mix(contrastText(footerBg) === '#ffffff' ? '#ffffff' : '#111111', footerBg, 0.62),
    dark,
  };
  if (typeof t.radius === 'number' && Number.isFinite(t.radius)) out.radius = Math.max(0, Math.min(40, Math.round(t.radius)));
  if (typeof t.footer_social === 'boolean') out.footerSocial = t.footer_social;
  return out;
}

// ── Blocs ────────────────────────────────────────────────────────────────────

function blockId(i: number): string {
  const r = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `ai_${i}_${r}`;
}

const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

/** Bloc Yuno natif (dessin imposé) : défauts du Studio, dans la langue de l'e-mail, + options permises. */
function nativeBlock(kind: NativeBlock, o: Record<string, unknown>, id: string, lang: SmartLang = 'fr'): Record<string, unknown> {
  const w = emailWords(lang);
  const accent = hex(o.accent);
  const align = o.align === 'center' || o.align === 'right' ? o.align : 'left';
  const layout = ['showcase', 'banner', 'minimal', 'split'].includes(String(o.layout)) ? String(o.layout) : 'showcase';
  switch (kind) {
    case 'event':
      return { id, type: 'event', title: str(o.title, 120) ?? '', dateLabel: '', venueLabel: '', ctaLabel: str(o.button, 40) ?? w.eventCta,
        cover: o.cover !== false, venue: true, price: o.price !== false, layout, align, metaDisplay: 'rows', full: true,
        ...(accent ? { accent } : {}), ...(str(o.kicker, 40) ? { kicker: str(o.kicker, 40) } : {}), ...(str(o.subtitle, 200) ? { sub: str(o.subtitle, 200) } : {}) };
    case 'tickets':
      return { id, type: 'tickets', live: true, rows: [], layout: layout === 'split' ? 'showcase' : layout, align,
        priceDisplay: o.price_display === 'from' ? 'from' : 'rows',
        ...(accent ? { accent } : {}), ...(str(o.kicker, 40) ? { kicker: str(o.kicker, 40) } : {}), ...(str(o.title, 120) ? { title: str(o.title, 120) } : {}),
        ...(str(o.subtitle, 200) ? { sub: str(o.subtitle, 200) } : {}), ...(str(o.button, 40) ? { ctaLabel: str(o.button, 40) } : {}) };
    case 'lineup':
      return { id, type: 'lineup', photos: o.photos !== false, align: align === 'left' ? 'center' : align,
        ...(accent ? { accent } : {}), ...(typeof o.kicker === 'string' ? { kicker: o.kicker.slice(0, 40) } : {}) };
    case 'countdown':
      return { id, type: 'countdown', label: str(o.label, 80) ?? w.countdownLabel, ...(accent ? { accent } : {}) };
    case 'table':
      return { id, type: 'table', kicker: str(o.kicker, 40) ?? w.tableKicker, title: str(o.title, 120) ?? '', sub: str(o.subtitle, 200) ?? '',
        ctaLabel: str(o.button, 40) ?? w.tableCta, livePacks: true, layout: layout === 'split' ? 'showcase' : layout, align,
        packDisplay: o.pack_display === 'zones' ? 'zones' : 'packs', ...(accent ? { accent } : {}) };
    case 'guestlist':
      return { id, type: 'guestlist', layout: layout === 'split' ? 'showcase' : layout, align,
        ...(accent ? { accent } : {}), ...(str(o.title, 120) ? { title: str(o.title, 120) } : {}), ...(str(o.button, 40) ? { ctaLabel: str(o.button, 40) } : {}) };
    case 'social':
      return { id, type: 'social', ...(hex(o.color) ? { color: hex(o.color) } : {}) };
    case 'divider':
      return { id, type: 'divider', ...(hex(o.color) ? { color: hex(o.color) } : {}) };
    case 'spacer':
      return { id, type: 'spacer', size: ['sm', 'md', 'lg', 'xl'].includes(String(o.size)) ? String(o.size) : 'md' };
  }
}

export interface PreparedSections {
  blocks: Record<string, unknown>[];
  removed: { section: number; elements: string[] }[];
}

/** Une section de l'IA → un bloc v2 du Studio (HTML nettoyé AVANT d'être écrit). */
function sectionToBlock(s: SectionInput, id: string, lang: SmartLang): { block: Record<string, unknown>; removed: string[] } {
  const cond = s.show_to && s.show_to !== 'everyone' ? s.show_to : undefined;
  const pad = typeof s.padding === 'number' ? Math.max(0, Math.min(48, Math.round(s.padding))) : 0;
  const bgc = hex(s.background);
  if (s.yuno_block) {
    const b = nativeBlock(s.yuno_block, (s.options && typeof s.options === 'object' ? s.options : {}) as Record<string, unknown>, id, lang);
    if (s.label) b.label = String(s.label).slice(0, 60);
    if (cond) b.cond = cond;
    if (bgc) b.bgc = bgc;
    if (typeof s.padding === 'number') { b.px = pad; b.py = pad; }
    return { block: b, removed: [] };
  }
  const clean = sanitizeSectionHtml(String(s.html || ''));
  const b: Record<string, unknown> = { id, type: 'html', code: clean.html.trim(), px: pad, py: pad };
  if (s.label) b.label = String(s.label).slice(0, 60);
  if (cond) b.cond = cond;
  if (bgc) b.bgc = bgc;
  return { block: b, removed: clean.removed };
}

/** Sections de l'IA → blocs v2 du Studio. Le HTML est nettoyé AVANT d'être écrit. */
export function sectionsToBlocks(sections: SectionInput[], lang: SmartLang = 'fr'): PreparedSections {
  const removed: PreparedSections['removed'] = [];
  const blocks = sections.map((s, i) => {
    const r = sectionToBlock(s, blockId(i), lang);
    if (r.removed.length) removed.push({ section: i, elements: r.removed });
    return r.block;
  });
  return { blocks, removed };
}

/**
 * Une modification ciblée (update_email_draft). La section visée se désigne
 * par son `id` (stable : il ne bouge pas quand le pro déplace ou ajoute des
 * blocs dans le Studio) ou, à défaut, par son `index` lu dans get_email_draft.
 */
export interface SectionUpdate {
  id?: string;
  index?: number;
  action?: 'edit' | 'remove' | 'insert_before' | 'insert_after' | 'move';
  html?: string;
  yuno_block?: NativeBlock;
  options?: Record<string, unknown>;
  label?: string;
  show_to?: typeof SECTION_SHOW_TO[number];
  background?: string;
  padding?: number;
  move_to?: number;
  // Formes d'avant (toujours lues).
  insert_after?: boolean;
  remove?: boolean;
}

export interface UpdateResult {
  blocks: Record<string, unknown>[];
  error?: { code: string; message: string };
  /** Ce qui a changé, section par section (rendu à l'IA pour qu'elle le dise). */
  changes: string[];
  removed: { section: number; elements: string[] }[];
}

// Options d'un bloc natif → champs du bloc (mêmes noms que la création).
const OPTION_FIELDS: Record<string, string> = {
  title: 'title', subtitle: 'sub', button: 'ctaLabel', kicker: 'kicker', label: 'label',
  layout: 'layout', align: 'align', price_display: 'priceDisplay', pack_display: 'packDisplay',
  photos: 'photos', size: 'size', cover: 'cover', price: 'price',
};

/** Applique des options à un bloc natif existant, sans toucher au reste de ce que le pro a réglé. */
function patchNative(b: Record<string, unknown>, o: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(o)) {
    if (k === 'accent' || k === 'color') {
      if (v === 'none' || v === '') delete b[k];
      else if (hex(v)) b[k] = hex(v);
      continue;
    }
    const field = OPTION_FIELDS[k];
    if (!field) continue;
    if (typeof v === 'boolean') b[field] = v;
    else if (typeof v === 'string') b[field] = v.slice(0, field === 'sub' ? 200 : 120);
  }
}

const describe = (b: Record<string, unknown>) => String(b.label || (b.type === 'html' ? 'section' : `${b.type} block`));

/**
 * Applique des modifications aux blocs d'un brouillon, dans l'ordre donné.
 * Un `index` désigne la section telle que l'IA l'a lue (liste d'avant toute
 * modification de cet appel) ; il est converti en id avant de commencer.
 */
export function applySectionUpdates(blocks: Record<string, unknown>[], updates: SectionUpdate[], lang: SmartLang = 'fr'): UpdateResult {
  const next = blocks.map((b) => ({ ...b }));
  const changes: string[] = [];
  const removed: UpdateResult['removed'] = [];
  const fail = (code: string, message: string): UpdateResult => ({ blocks, error: { code, message }, changes: [], removed: [] });
  // Index → id, sur la liste lue par l'IA.
  const targets: (string | null)[] = [];
  for (const u of updates) {
    if (typeof u.id === 'string' && u.id) {
      if (!blocks.some((b) => b.id === u.id)) return fail('section_not_found', `No section with id "${u.id}" in this draft (it may have been removed in the Console). Read the draft again with get_email_draft.`);
      targets.push(u.id);
    } else if (Number.isInteger(u.index)) {
      const b = blocks[u.index as number];
      if (!b) return fail('section_not_found', `Index ${u.index} does not exist in this draft (it has ${blocks.length} sections, numbered from 0).`);
      targets.push(String(b.id));
    } else {
      return fail('invalid_args', 'Each section update needs "id" (preferred) or "index" from get_email_draft.');
    }
  }
  let n = 0;
  updates.forEach((u, k) => {
    const id = targets[k]!;
    const at = next.findIndex((b) => b.id === id);
    const action = u.action ?? (u.remove ? 'remove' : u.insert_after ? 'insert_after' : 'edit');
    if (at < 0) return; // déjà supprimée par une modification précédente du même appel
    if (action === 'remove') {
      changes.push(`removed ${describe(next[at])}`);
      next.splice(at, 1);
      return;
    }
    if (action === 'move') {
      if (!Number.isInteger(u.move_to)) return;
      const [b] = next.splice(at, 1);
      const to = Math.max(0, Math.min(next.length, u.move_to as number));
      next.splice(to, 0, b);
      changes.push(`moved ${describe(b)} to position ${to}`);
      return;
    }
    if (action === 'insert_before' || action === 'insert_after') {
      if (!u.html && !u.yuno_block) return;
      const made = sectionToBlock({ html: u.html, yuno_block: u.yuno_block, options: u.options, label: u.label, show_to: u.show_to, background: u.background, padding: u.padding }, blockId(100 + n++), lang);
      if (made.removed.length) removed.push({ section: at, elements: made.removed });
      next.splice(action === 'insert_before' ? at : at + 1, 0, made.block);
      changes.push(`inserted ${describe(made.block)} ${action === 'insert_before' ? 'above' : 'below'} ${describe(next[action === 'insert_before' ? at + 1 : at])}`);
      return;
    }
    // edit
    let cur = next[at];
    if (u.yuno_block) {
      // Remplacer par un bloc Yuno natif (même id : la place ne bouge pas).
      cur = nativeBlock(u.yuno_block, (u.options && typeof u.options === 'object' ? u.options : {}) as Record<string, unknown>, id, lang);
      if (next[at].cond) cur.cond = next[at].cond;
      next[at] = cur;
      changes.push(`replaced section ${at} with a native ${u.yuno_block} block`);
    } else if (u.html !== undefined) {
      const clean = sanitizeSectionHtml(u.html);
      if (clean.removed.length) removed.push({ section: at, elements: clean.removed });
      if (cur.type !== 'html') {
        // Remplacer un bloc natif par une section sur mesure.
        cur = { id, type: 'html', code: clean.html.trim(), px: 0, py: 0, ...(next[at].cond ? { cond: next[at].cond } : {}) };
        next[at] = cur;
      } else {
        cur.code = clean.html.trim();
      }
      changes.push(`rewrote ${describe(cur)}`);
    } else if (u.options && cur.type !== 'html') {
      patchNative(cur, u.options);
      changes.push(`changed options of ${describe(cur)}`);
    }
    if (u.label !== undefined) cur.label = u.label.slice(0, 60);
    if (u.show_to !== undefined) {
      if (u.show_to === 'everyone') delete cur.cond;
      else cur.cond = u.show_to;
    }
    if (u.background !== undefined) {
      if (u.background === 'none' || u.background === '') delete cur.bgc;
      else if (hex(u.background)) cur.bgc = hex(u.background);
    }
    if (typeof u.padding === 'number') {
      const pad = Math.max(0, Math.min(48, Math.round(u.padding)));
      cur.px = pad;
      cur.py = pad;
    }
    if (u.label !== undefined || u.show_to !== undefined || u.background !== undefined || typeof u.padding === 'number') {
      if (!u.html && !u.yuno_block && !u.options) changes.push(`updated settings of ${describe(cur)}`);
    }
  });
  if (!next.length) return fail('invalid_content', 'This would leave the email empty: keep at least one section.');
  return { blocks: next, changes, removed };
}

// ── Lecture d'un brouillon : ce que l'IA voit de chaque section ─────────────

const NATIVE_OPTION_READ: Record<string, string> = Object.fromEntries(Object.entries(OPTION_FIELDS).map(([k, v]) => [v, k]));

/**
 * Une section telle que l'IA la lit : son id stable, sa place, son nom, qui la
 * voit, le TEXTE visible (pour retrouver « ça » sur une capture d'écran), et
 * son contenu dans la forme qu'update_email_draft accepte (html, ou bloc Yuno
 * et ses options).
 */
export function blockToSectionView(b: Record<string, unknown>, index: number): Record<string, unknown> {
  const out: Record<string, unknown> = { index, id: b.id };
  if (b.label) out.label = b.label;
  out.show_to = b.cond || 'everyone';
  if (b.bgc) out.background = b.bgc;
  if (b.type === 'html') {
    const code = String(b.code || '');
    // Le texte qu'on voit : sans les marqueurs de logique ({{#if}}, {{/each}}…),
    // les valeurs restent des balises ({{event.title}} = le titre de la soirée).
    out.text = sectionText(code).replace(/\{\{\s*(?:[#^/][^}]*|else)\s*\}\}/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
    out.html = code;
    return out;
  }
  if (['header', 'image', 'text', 'cta'].includes(String(b.type))) {
    // Blocs du Studio posés à la main par le pro : lisibles, modifiables en
    // les remplaçant par une section (html) ou supprimables.
    out.studio_block = b.type;
    const txt = b.type === 'header' ? b.venueName : b.type === 'text' ? b.body : b.label;
    out.text = String(txt || '').replace(/\[\/?[a-z]+(?:=[^\]]*)?\]/gi, '').replace(/\s+/g, ' ').trim().slice(0, 400);
    if (b.type === 'image' && b.url) out.image = b.url;
    if (b.type === 'cta' && b.url) out.link = b.url;
    return out;
  }
  out.yuno_block = b.type;
  const options: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(b)) {
    if (['id', 'type', 'cond', 'bgc', 'px', 'py'].includes(k)) continue;
    if (k === 'accent' || k === 'color') { options[k] = v; continue; }
    const name = NATIVE_OPTION_READ[k];
    if (name && v !== '' && v != null) options[name] = v;
  }
  if (Object.keys(options).length) out.options = options;
  const txt = [b.kicker, b.title, b.sub, b.ctaLabel, b.label].filter((x) => typeof x === 'string' && x).join(' · ');
  if (txt) out.text = String(txt).slice(0, 400);
  return out;
}

// ── Faits de la soirée → données des balises (contrôle et aperçu des valeurs) ─

export interface EventFacts {
  id?: string;
  title?: string;
  start_at?: string;
  timezone?: string;
  venue?: string | null;
  poster_url?: string | null;
  sales?: 'yuno' | 'external';
  page_url?: string;
  ticket_url?: string | null;
  sold_out?: boolean;
  tiers?: { name: string; price: number | null; detail?: string | null; open?: boolean; sold_out?: boolean }[];
  tables?: { on_sale?: boolean; left?: number | null; packs?: { name: string; price: number | null; guests?: number | null; bottles?: number | null }[] };
  guest_list?: { open?: boolean; free_before?: string | null; drink?: boolean };
  lineup?: { name: string; photo?: string | null }[];
}

const euro = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2).replace('.', ',')} €`;

/**
 * Approximation de la donnée live (fetchStudioLiveData) à partir des faits du
 * kit : suffisante pour contrôler une section et montrer à l'IA ce que ses
 * balises écriront. Les liens réels (suivis) ne naissent qu'à l'envoi.
 */
export function factsToSmartEvent(f: EventFacts | null | undefined): SmartEvent | null {
  if (!f || !f.title || !f.start_at) return null;
  const external = f.sales === 'external';
  const tiers = Array.isArray(f.tiers) ? f.tiers : [];
  // Miroir de l'envoi : une tranche Yuno s'affiche ouverte ou épuisée, jamais
  // une tranche à venir ; un tarif externe s'affiche toujours.
  const tickets = tiers
    .filter((t) => external || t.open !== false || t.sold_out)
    .slice(0, external ? 6 : 4)
    .map((t) => ({ n: t.name, s: t.detail || '', p: Number(t.price || 0) > 0 ? euro(Number(t.price)) : 'Gratuit', out: !!t.sold_out }));
  const openPrices = tiers.filter((t) => !t.sold_out && (external || t.open !== false)).map((t) => Number(t.price || 0));
  const paid = openPrices.filter((p) => p > 0);
  const priceFromLabel = f.sold_out ? null : paid.length ? `À partir de ${euro(Math.min(...paid))}` : openPrices.length ? 'Gratuit' : null;
  const packs = f.tables?.packs || [];
  return {
    title: f.title,
    startAt: f.start_at,
    timezone: f.timezone || 'Europe/Paris',
    venueLabel: f.venue || '',
    coverUrl: f.poster_url || null,
    url: external ? (f.ticket_url || '') : (f.page_url || ''),
    priceFromLabel,
    tickets: f.sold_out ? tickets.map((t) => ({ ...t, out: true })) : tickets,
    guestList: f.guest_list?.open ? { freeBefore: f.guest_list.free_before || null, includesDrink: !!f.guest_list.drink, remaining: null, soldOut: false } : null,
    tablesLeft: f.tables?.on_sale ? Number(f.tables.left ?? 0) : (packs.length ? 0 : null),
    tablesOpen: !external && !!(f.tables?.on_sale || packs.length),
    tablePacks: packs.map((p) => ({ n: p.name, s: [p.guests ? `${p.guests} pers.` : '', p.bottles ? `${p.bottles} bouteille${p.bottles > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · '), p: Number(p.price || 0) > 0 ? euro(Number(p.price)) : 'Sur demande' })),
    tableZones: [],
    lineup: Array.isArray(f.lineup) ? f.lineup : [],
    trackedUrl: null,
    entryTrackedUrl: null,
    external,
  };
}

/** Ce que les balises écriraient aujourd'hui pour cette soirée (liens : forme non suivie). */
export function tagPreview(ev: SmartEvent | null, lang: SmartLang): Record<string, unknown> | null {
  if (!ev) return null;
  const d = buildSmartData({ event: ev, language: lang, recipient: { firstName: 'Camille' } });
  const e = d.event as Record<string, unknown>;
  return {
    event: {
      title: e.title, date: e.date, date_short: e.date_short, time: e.time, venue: e.venue, cover: e.cover || '(empty)',
      price_from: e.price_from || '(empty)', on_sale: e.on_sale, sold_out: e.sold_out, lineup: e.lineup || '(empty)', external: e.external,
      tickets_url: '(tracked buy link, set when the email leaves)',
    },
    tickets: d.tickets,
    lineup: d.lineup,
    tables: d.tables,
    guestlist: d.guestlist,
    countdown: d.countdown,
    note: 'Values are read again when the email leaves: prices, sold out, tables left and countdown may change. Links become tracked links at sending.',
  };
}

// ── Contrôle d'un brouillon ──────────────────────────────────────────────────

export interface DraftCheck {
  errors: SmartIssue[];
  warnings: SmartIssue[];
  /** Estimation du poids du HTML (sections seules + gabarit). */
  estimated_kb: number;
}

export function checkDraft(input: {
  blocks: Record<string, unknown>[];
  subject?: string | null;
  subjectB?: string | null;
  preheader?: string | null;
  hasEvent: boolean;
  facts?: EventFacts | null;
  lang: SmartLang;
  /** Création : objet obligatoire. Modification : contrôlé seulement s'il change. */
  requireSubject: boolean;
}): DraftCheck {
  const ev = factsToSmartEvent(input.facts);
  const data = ev ? buildSmartData({ event: ev, language: input.lang }) : null;
  const eventUrls = [input.facts?.page_url, input.facts?.ticket_url].filter((u): u is string => !!u);
  const issues: SmartIssue[] = [];
  let chars = 6_000;
  let hasText = false;
  let tracked = false;
  input.blocks.forEach((b, i) => {
    if (b.type === 'html') {
      const code = String(b.code || '');
      chars += code.length;
      issues.push(...lintSmartSection(code, { index: i, hasEvent: input.hasEvent, data, eventUrls }));
      if (sectionText(code).replace(/\{\{[^}]*\}\}/g, 'x').length > 40) hasText = true;
      if (hasSmartSalesLink(code)) tracked = true;
    } else {
      chars += 2_500;
      hasText = true;
      if (['event', 'tickets', 'table', 'guestlist'].includes(String(b.type))) tracked = true;
      if (['event', 'tickets', 'table', 'guestlist', 'lineup', 'countdown'].includes(String(b.type)) && !input.hasEvent) {
        issues.push({ code: 'event_tags_without_event', level: 'error', section: i, message: 'This Yuno block needs an event: pass "event" on the draft.' });
      }
    }
  });
  const emailLevel = lintEmail({
    subject: input.requireSubject || input.subject != null ? String(input.subject ?? '') : 'unchanged subject',
    subjectB: input.subjectB,
    preheader: input.requireSubject || input.preheader != null ? input.preheader : 'unchanged',
    hasTrackedLink: tracked,
    renderedChars: chars,
    hasText,
  });
  issues.push(...emailLevel);
  return {
    errors: issues.filter((i) => i.level === 'error'),
    warnings: issues.filter((i) => i.level === 'warning'),
    estimated_kb: Math.round(chars / 1000),
  };
}

/** true = au moins une section lit une soirée (balises) ou un bloc Yuno en a besoin. */
export function blocksNeedEvent(blocks: Record<string, unknown>[]): boolean {
  return blocks.some((b) => (b.type === 'html' ? smartNeeds(String(b.code || '')).event
    : ['event', 'tickets', 'table', 'guestlist', 'lineup', 'countdown'].includes(String(b.type))));
}

/** Lien de la Console où le pro relit, ajuste et envoie le brouillon. */
export function consoleUrl(product: string, draftId: string, venueId: string | null | undefined, organizerUserId: string | null | undefined): string {
  if (product === 'crm') return `https://crm.yunoapp.eu/crm/emails/studio/${draftId}`;
  if (venueId) return `https://yunoapp.eu/owner/campaigns/${draftId}/edit`;
  if (organizerUserId) return `https://yunoapp.eu/organizer-app/campaigns/${draftId}/edit`;
  return 'https://yunoapp.eu';
}
