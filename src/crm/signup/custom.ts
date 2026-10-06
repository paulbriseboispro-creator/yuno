/**
 * Pages d'inscription — le DESIGN SUR MESURE (2026-10-06, plan
 * docs/designs/MCP_SIGNUP_PAGE_DESIGN_PLAN.md).
 *
 * À côté des dix gabarits (`model.ts`), une page peut porter un design dessiné
 * par l'IA du pro via le MCP : un THÈME (couleurs, polices, formulaire, bouton)
 * et des SECTIONS — du HTML/CSS libre avec des balises Yuno ({{page.title}},
 * {{event.date}}…), et les blocs Yuno (le formulaire, obligatoire, le compte à
 * rebours, la récompense, le compteur). Le formulaire, la case d'accord et sa
 * confirmation restent ceux de Yuno : le thème ne fait que les recolorer.
 *
 * Module PUR (ni React, ni DOM, ni appel), importé tel quel par la Console
 * (FanPage, aperçus, page publique) et par le Worker MCP (contrôle avant
 * écriture) : une seule définition du nettoyage, des balises et du contrôle.
 * Le rendu web ajoute DOMPurify et un Shadow DOM (`CustomSection.tsx`) : ce
 * nettoyage-ci n'est jamais la seule barrière.
 */
import { canonicalTag, decodeForScheme, escapeSmart, parseSmart, renderSmartTemplate, sectionText } from '../../../supabase/functions/_shared/email-smart.ts';
import { DEFAULT_STYLE, isHex, lum, onC, rgba, rgbs, tokens } from './model';
import type { ResolvedStyle, SignupDesign, SignupKind, TokenFont, Tokens } from './model';

// ── Le modèle ───────────────────────────────────────────────────────────────

export const CUSTOM_DESIGN_VERSION = 1;

/** Les blocs Yuno qu'une page sur mesure peut placer. `form` est obligatoire et unique. */
export const PAGE_BLOCKS = ['form', 'countdown', 'reward', 'count'] as const;
export type PageBlock = (typeof PAGE_BLOCKS)[number];

/** Quand une section se montre : toujours, avant l'inscription, ou sur « C'est noté ». */
export const SHOW_ON = ['always', 'before_signup', 'after_signup'] as const;
export type ShowOn = (typeof SHOW_ON)[number];

export interface HtmlSection { id: string; type: 'html'; html: string; css?: string; label?: string; show_on?: ShowOn }
export interface YunoSection { id: string; type: 'yuno'; block: PageBlock; label?: string; show_on?: ShowOn; tagline?: boolean }
export type PageSection = HtmlSection | YunoSection;

export type CardBg = string; // '#rrggbb' | 'transparent' | 'glass'
export type Shadow = 'none' | 'soft' | 'hard' | 'glow';

export interface CustomTheme {
  /** Fond de la page (couleur de base). */
  bg: string;
  /** Calques de fond en plus (dégradés, image hébergée sur Yuno), posés AU-DESSUS de `bg`. */
  bg_css?: string;
  /** Couleur du texte. */
  text: string;
  accent: string;
  /** Second accent : fin du dégradé du bouton (`button_style: gradient`). */
  accent2?: string;
  /** Texte posé sur l'accent (calculé s'il manque). */
  accent_text?: string;
  font_heading: string;
  font_body: string;
  heading_weight: number;
  heading_case: 'none' | 'uppercase';
  /** Interlettrage des titres, en em (-0.1 à 0.3). */
  heading_tracking: number;
  /** Boîte du formulaire : couleur, transparente, ou verre dépoli. */
  card_bg: CardBg;
  card_border: string; // '#rrggbb' | 'none'
  card_radius: number;
  card_shadow: Shadow;
  /** Couleur des ombres décalées (`hard`) : l'accent sur une page sombre, l'encre sur une page claire, par défaut. */
  shadow_color?: string;
  input_style: 'box' | 'underline' | 'pill';
  input_bg?: string; // '#rrggbb' | 'transparent'
  /** Coins des champs et des choix de réponse. */
  radius: number;
  button_style: 'solid' | 'gradient' | 'outline';
  button_radius: number;
  button_shadow: Shadow;
  button_case: 'none' | 'uppercase';
  button_arrow: boolean;
  button_height: number;
  button_font: 'body' | 'heading';
  label_style: 'normal' | 'uppercase' | 'mono';
  /** Polices Google en plus, pour les sections (deux au plus). */
  extra_fonts?: string[];
  /** CSS commun à toutes les sections (chaque section le reçoit dans son Shadow DOM). */
  css?: string;
}

export interface CustomDesign { v: 1; theme: CustomTheme; sections: PageSection[] }

export const CUSTOM_LIMITS = {
  sections: 24,
  sectionHtml: 30_000,
  sectionCss: 15_000,
  themeCss: 15_000,
  bgCss: 2_000,
  total: 150_000,
} as const;

export const DEFAULT_THEME: CustomTheme = {
  bg: '#0B0B0C', text: '#F7F2F1', accent: '#E3141B',
  font_heading: 'Bricolage Grotesque', font_body: 'Geist',
  heading_weight: 700, heading_case: 'none', heading_tracking: -0.03,
  card_bg: 'transparent', card_border: 'none', card_radius: 20, card_shadow: 'none',
  input_style: 'box', radius: 14,
  button_style: 'solid', button_radius: 99, button_shadow: 'soft', button_case: 'none', button_arrow: true, button_height: 56, button_font: 'body',
  label_style: 'normal',
};

const FONT_RE = /^[A-Za-z0-9][A-Za-z0-9 ]{1,39}$/;
/** Un nom de famille Google Fonts plausible (« Playfair Display », « Space Grotesk »). */
export const isFontFamily = (f: unknown): f is string => typeof f === 'string' && FONT_RE.test(f.trim());

const clampN = (v: unknown, min: number, max: number, def: number): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def;
};
const oneOf = <T extends string>(v: unknown, list: readonly T[], def: T): T => (list.includes(v as T) ? (v as T) : def);
const hexOr = (v: unknown, def: string | undefined): string | undefined => (isHex(v) ? (v as string).toUpperCase() : def);
const SHADOWS = ['none', 'soft', 'hard', 'glow'] as const;

/** Thème lu ou reçu → thème complet et borné (toute valeur illisible prend le défaut). */
export function normalizeTheme(raw: unknown): CustomTheme {
  const t = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_THEME;
  const cardBg = t.card_bg === 'glass' || t.card_bg === 'transparent' ? (t.card_bg as string) : hexOr(t.card_bg, d.card_bg)!;
  const out: CustomTheme = {
    bg: hexOr(t.bg, d.bg)!,
    text: hexOr(t.text, d.text)!,
    accent: hexOr(t.accent, d.accent)!,
    font_heading: isFontFamily(t.font_heading) ? t.font_heading.trim() : d.font_heading,
    font_body: isFontFamily(t.font_body) ? t.font_body.trim() : d.font_body,
    heading_weight: Math.round(clampN(t.heading_weight, 100, 900, d.heading_weight) / 100) * 100,
    heading_case: oneOf(t.heading_case, ['none', 'uppercase'] as const, d.heading_case),
    heading_tracking: Math.round(clampN(t.heading_tracking, -0.1, 0.3, d.heading_tracking) * 1000) / 1000,
    card_bg: cardBg,
    card_border: t.card_border === 'none' ? 'none' : hexOr(t.card_border, d.card_border)!,
    card_radius: Math.round(clampN(t.card_radius, 0, 40, d.card_radius)),
    card_shadow: oneOf(t.card_shadow, SHADOWS, d.card_shadow),
    input_style: oneOf(t.input_style, ['box', 'underline', 'pill'] as const, d.input_style),
    radius: Math.round(clampN(t.radius, 0, 40, d.radius)),
    button_style: oneOf(t.button_style, ['solid', 'gradient', 'outline'] as const, d.button_style),
    button_radius: Math.round(clampN(t.button_radius, 0, 99, d.button_radius)),
    button_shadow: oneOf(t.button_shadow, SHADOWS, d.button_shadow),
    button_case: oneOf(t.button_case, ['none', 'uppercase'] as const, d.button_case),
    button_arrow: typeof t.button_arrow === 'boolean' ? t.button_arrow : d.button_arrow,
    button_height: Math.round(clampN(t.button_height, 44, 64, d.button_height)),
    button_font: oneOf(t.button_font, ['body', 'heading'] as const, d.button_font),
    label_style: oneOf(t.label_style, ['normal', 'uppercase', 'mono'] as const, d.label_style),
  };
  const a2 = hexOr(t.accent2, undefined);
  if (a2) out.accent2 = a2;
  const at = hexOr(t.accent_text, undefined);
  if (at) out.accent_text = at;
  const sc = hexOr(t.shadow_color, undefined);
  if (sc) out.shadow_color = sc;
  if (t.input_bg === 'transparent') out.input_bg = 'transparent';
  else if (isHex(t.input_bg)) out.input_bg = (t.input_bg as string).toUpperCase();
  const fonts = (Array.isArray(t.extra_fonts) ? t.extra_fonts : []).filter(isFontFamily).map((f) => f.trim()).slice(0, 2);
  if (fonts.length) out.extra_fonts = fonts;
  if (typeof t.bg_css === 'string' && t.bg_css.trim()) {
    const bg = cleanBackgroundValue(t.bg_css).text;
    if (bg) out.bg_css = bg;
  }
  if (typeof t.css === 'string' && t.css.trim()) {
    const css = sanitizePageCss(t.css).text.slice(0, CUSTOM_LIMITS.themeCss);
    if (css.trim()) out.css = css;
  }
  return out;
}

const SECTION_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Design lu en base ou reçu → design sûr : thème borné, sections nettoyées,
 * exactement UN formulaire (ajouté en fin s'il manque, doublons retirés),
 * identifiants uniques. `null` si l'entrée n'est pas un design.
 */
export function normalizeCustomDesign(raw: unknown): CustomDesign | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const theme = normalizeTheme(r.theme);
  const seen = new Set<string>();
  const sections: PageSection[] = [];
  let form = false;
  const list = Array.isArray(r.sections) ? r.sections.slice(0, CUSTOM_LIMITS.sections + 4) : [];
  list.forEach((s, i) => {
    if (!s || typeof s !== 'object') return;
    const x = s as Record<string, unknown>;
    let id = typeof x.id === 'string' && SECTION_ID.test(x.id) ? x.id : `s${i}`;
    while (seen.has(id)) id = `${id}_${i}`;
    const label = typeof x.label === 'string' && x.label.trim() ? x.label.trim().slice(0, 60) : undefined;
    const show = oneOf(x.show_on, SHOW_ON, 'always');
    if (x.type === 'yuno') {
      const block = oneOf(x.block, PAGE_BLOCKS, 'form');
      if (block === 'form' && form) return;
      if (sections.some((y) => y.type === 'yuno' && y.block === block)) return;
      if (block === 'form') form = true;
      seen.add(id);
      const y: YunoSection = { id, type: 'yuno', block };
      if (label) y.label = label;
      // Le formulaire se montre dans toutes les scènes : c'est lui qui porte « C'est noté ».
      if (block !== 'form' && show !== 'always') y.show_on = show;
      if (block === 'form' && x.tagline === false) y.tagline = false;
      sections.push(y);
      return;
    }
    if (x.type !== 'html' || typeof x.html !== 'string') return;
    const html = sanitizePageHtml(x.html).text.slice(0, CUSTOM_LIMITS.sectionHtml).trim();
    if (!html) return;
    seen.add(id);
    const h: HtmlSection = { id, type: 'html', html };
    if (typeof x.css === 'string' && x.css.trim()) {
      const css = sanitizePageCss(x.css).text.slice(0, CUSTOM_LIMITS.sectionCss);
      if (css.trim()) h.css = css;
    }
    if (label) h.label = label;
    if (show !== 'always') h.show_on = show;
    sections.push(h);
  });
  if (!form) sections.push({ id: seen.has('form') ? 'form_yuno' : 'form', type: 'yuno', block: 'form' });
  return { v: 1, theme, sections: sections.slice(0, CUSTOM_LIMITS.sections) };
}

/** Une section se montre-t-elle dans cette scène ? (`noted` = après l'inscription). */
export function sectionVisible(s: PageSection, scene: string): boolean {
  const show = s.show_on ?? 'always';
  if (show === 'always') return true;
  return show === 'after_signup' ? scene === 'noted' : scene !== 'noted';
}

/** Poids d'un design (caractères du JSON), pour les plafonds. */
export const designWeight = (d: CustomDesign): number => JSON.stringify(d).length;

// ── Ce qui peut se charger dans une page ─────────────────────────────────────
// Une image hébergée ailleurs verrait l'adresse IP de chaque fan qui ouvre la
// page : seuls le stockage du projet Supabase de Yuno et les fichiers d'image
// de yunoapp.eu passent (jamais une autre route de yunoapp.eu : un lien /go/
// posé en image compterait des visites). Le nettoyage le dit tout de suite à
// l'IA, plutôt qu'une image qui ne s'afficherait pas.

const YUNO_STORAGE = /^https:\/\/fulawxvdlwtdlpkycixe\.supabase\.co\/storage\/v1\/(object|render\/image)\/public\//i;
const YUNO_STATIC_IMAGE = /^https:\/\/(crm\.)?yunoapp\.eu\/[a-z0-9/_.-]+\.(png|jpe?g|gif|webp|avif|svg)(\?[^#]*)?$/i;
const DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i;

/** true = une image (ou un fond) que la page publique affichera. */
export function isAllowedAssetUrl(u: string): boolean {
  const s = String(u || '').trim();
  if (!s) return false;
  if (DATA_IMAGE.test(s)) return s.length <= 120_000;
  return (YUNO_STORAGE.test(s) || YUNO_STATIC_IMAGE.test(s)) && !/["'<>\s()]/.test(s);
}

/** Lien d'une section : https, http, mailto, tel, ancre, chemin, ou balise Yuno. */
export function safeLinkUrl(v: string): boolean {
  const raw = String(v || '').trim();
  if (!raw || raw.startsWith('#') || raw.startsWith('/') || raw.startsWith('{{')) return true;
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(decodeForScheme(raw));
  if (!scheme) return true;
  return ['https', 'http', 'mailto', 'tel'].includes(scheme[1]);
}

/** Source d'une image : stockage Yuno, image en ligne (data:), ou balise Yuno. */
function safeImageSrc(v: string): boolean {
  const raw = String(v || '').trim();
  if (raw.startsWith('{{')) return true;
  return isAllowedAssetUrl(raw);
}

export interface CleanResult { text: string; removed: string[] }

/** Une valeur CSS : sans exécution, sans fichier d'un autre site. */
function cleanCssText(input: string, note: (what: string) => void): string {
  let c = String(input || '');
  c = c.replace(/expression\s*\(|behavior\s*:|-moz-binding\s*:|(java|vb)script\s*:/gi, () => { note('css expression'); return ''; });
  c = c.replace(/url\(\s*(['"]?)([\s\S]*?)\1\s*\)/gi, (m, _q: string, u: string) => {
    const s = String(u || '').trim();
    if (s.startsWith('{{') || isAllowedAssetUrl(s)) return m;
    note('external url');
    return 'none';
  });
  return c;
}

/** Calques de fond de la page (`background`) : une valeur CSS, sans `;` ni accolade. */
export function cleanBackgroundValue(input: string): CleanResult {
  const removed = new Set<string>();
  const v = cleanCssText(String(input || '').replace(/[;{}<>]/g, ' ').slice(0, CUSTOM_LIMITS.bgCss), (w) => removed.add(w)).trim();
  return { text: v, removed: [...removed] };
}

/**
 * Le CSS d'une section (ou commun) : sans `@import`, `@font-face`,
 * `expression()`, ni image d'un autre site. Il vit dans le Shadow DOM de sa
 * section : il ne peut pas toucher au formulaire.
 */
export function sanitizePageCss(input: string): CleanResult {
  const removed = new Set<string>();
  const note = (w: string) => removed.add(w);
  let c = String(input || '');
  c = c.replace(/\/\*[\s\S]*?\*\//g, '');
  c = c.replace(/<\/?style[^>]*>/gi, '');
  c = c.replace(/@import[^;]*;?/gi, () => { note('@import'); return ''; });
  c = c.replace(/@(charset|namespace)[^;]*;?/gi, '');
  c = c.replace(/@font-face\s*\{[^}]*\}/gi, () => { note('@font-face'); return ''; });
  c = cleanCssText(c, note);
  c = c.replace(/<\//g, '<\\/');
  return { text: c.trim(), removed: [...removed] };
}

// Ce qui ne s'affiche jamais dans une section de page : exécution, intégration
// d'un autre site, champs de saisie (le seul formulaire est celui de Yuno),
// médias lourds, animation SVG (vecteur connu d'injection).
const PAIRED_DROP = ['script', 'style', 'iframe', 'object', 'applet', 'noscript', 'template', 'math', 'video', 'audio', 'canvas', 'select', 'textarea', 'title', 'foreignobject', 'frameset', 'xmp', 'plaintext', 'noembed', 'noframes'];
const VOID_DROP = ['link', 'meta', 'base', 'frame', 'param', 'source', 'track', 'input', 'keygen', 'embed', 'use', 'animate', 'animatemotion', 'animatetransform', 'set', 'image', 'portal'];
const UNWRAP = ['form', 'button', 'label', 'fieldset', 'legend', 'dialog', 'option', 'optgroup', 'datalist', 'output'];
const LINK_ATTRS = ['href', 'action', 'cite', 'longdesc', 'formaction'];
const SRC_ATTRS = ['src', 'background', 'poster', 'lowsrc', 'dynsrc'];

/**
 * Le HTML d'une section de page : ce qui exécute, intègre un autre site ou
 * imite un champ de saisie est retiré et SIGNALÉ (le Worker le dit à l'IA).
 * Pur et idempotent. Le rendu passe ensuite par DOMPurify.
 */
export function sanitizePageHtml(input: string): CleanResult {
  let h = String(input || '');
  const removed = new Set<string>();
  const note = (tag: string) => removed.add(tag);

  const body = /<body\b[^>]*>([\s\S]*?)(<\/body\s*>|$)/i.exec(h);
  if (body) { h = body[1]; note('document'); }
  h = h.replace(/<!doctype[^>]*>/gi, () => { note('document'); return ''; });
  h = h.replace(/<head\b[\s\S]*?<\/head\s*>/gi, () => { note('head'); return ''; });
  h = h.replace(/<\/?(html|head|body)\b[^>]*>/gi, () => { note('document'); return ''; });
  h = h.replace(/<!--[\s\S]*?(-->|$)/g, '');
  h = h.replace(/<!\[CDATA\[[\s\S]*?\]\]>/gi, '');

  for (const tag of PAIRED_DROP) {
    h = h.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'), () => { note(tag === 'style' ? 'style (use the css field)' : tag); return ''; });
    h = h.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi'), () => { note(tag === 'style' ? 'style (use the css field)' : tag); return ''; });
  }
  for (const tag of VOID_DROP) {
    h = h.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi'), () => { note(tag); return ''; });
  }
  for (const tag of UNWRAP) {
    h = h.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi'), () => { note(tag); return ''; });
  }

  h = h.replace(/\s(on[a-z]+|srcdoc|srcset|ping|xmlns:xlink|xlink:href|http-equiv|autofocus|contenteditable)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, (_m, a: string) => {
    note(`${a.toLowerCase().startsWith('on') ? 'on*' : a.toLowerCase()} attribute`);
    return '';
  });

  const linkRe = new RegExp(`(\\s(?:${LINK_ATTRS.join('|')})\\s*=\\s*)("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'gi');
  h = h.replace(linkRe, (m, pre: string, _all: string, dq?: string, sq?: string, bare?: string) => {
    if (safeLinkUrl(dq ?? sq ?? bare ?? '')) return m;
    note('unsafe link');
    return /href/i.test(pre) ? `${pre}"#"` : '';
  });
  const srcRe = new RegExp(`(\\s(?:${SRC_ATTRS.join('|')})\\s*=\\s*)("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'gi');
  h = h.replace(srcRe, (m, _pre: string, _all: string, dq?: string, sq?: string, bare?: string) => {
    if (safeImageSrc(dq ?? sq ?? bare ?? '')) return m;
    note('image not hosted on Yuno');
    return '';
  });
  h = h.replace(/(\sstyle\s*=\s*)("([^"]*)"|'([^']*)'|([^\s>"']+))/gi, (_m, pre: string, _all: string, dq?: string, sq?: string, bare?: string) => {
    const quote = sq !== undefined ? "'" : '"';
    return `${pre}${quote}${cleanCssText(dq ?? sq ?? bare ?? '', note).replace(quote === '"' ? /"/g : /'/g, '')}${quote}`;
  });
  return { text: h, removed: [...removed] };
}

// ── Balises Yuno des sections de page ────────────────────────────────────────

export interface PageTagDef { tag: string; kind: 'text' | 'url' | 'image' | 'boolean' | 'number'; desc: string }

/** La référence des balises (kit de l'IA, contrôle). Même syntaxe que les e-mails. */
export const PAGE_TAGS: readonly PageTagDef[] = [
  { tag: 'page.title', kind: 'text', desc: 'Title of the page (set by the person or the AI, 40 characters max).' },
  { tag: 'page.tagline', kind: 'text', desc: 'Short pitch under the title (140 characters max).' },
  { tag: 'page.button', kind: 'text', desc: 'Label of the sign-up button.' },
  { tag: 'page.poster', kind: 'image', desc: 'Visual of the page: its own poster, else the event poster. Empty when none.' },
  { tag: 'page.url', kind: 'url', desc: 'Public link of the page (to share).' },
  { tag: 'page.kind', kind: 'text', desc: 'prevente, venue, attente or communaute.' },
  { tag: 'page.count', kind: 'text', desc: 'Number of sign-ups, formatted ("1 284"). Empty when the counter is off.' },
  { tag: 'page.show_count', kind: 'boolean', desc: 'True when the page shows its sign-up counter.' },
  { tag: 'page.sale_date', kind: 'text', desc: 'Presale only: when ticket sales open ("sat 17 oct at 18:00"). Empty otherwise.' },
  { tag: 'page.sale_open', kind: 'boolean', desc: 'Presale only: true once ticket sales are open.' },
  { tag: 'host.name', kind: 'text', desc: 'Name of the club or organizer.' },
  { tag: 'host.logo', kind: 'image', desc: 'Logo of the club or organizer (empty when none).' },
  { tag: 'host.city', kind: 'text', desc: 'City of the club or organizer.' },
  { tag: 'host.instagram', kind: 'url', desc: 'Instagram link of the club or organizer (empty when none).' },
  { tag: 'host.initials', kind: 'text', desc: 'Initials of the host ("LB"), for a monogram when there is no logo.' },
  { tag: 'event.title', kind: 'text', desc: 'Title of the night. Every event.* tag is empty on a community page (no night).' },
  { tag: 'event.date', kind: 'text', desc: 'Date and time ("Sat 17 Oct · 23:00"), or "Date to be announced".' },
  { tag: 'event.date_long', kind: 'text', desc: 'Long date ("Saturday 17 October").' },
  { tag: 'event.weekday', kind: 'text', desc: 'Day of the week ("Saturday").' },
  { tag: 'event.day', kind: 'text', desc: 'Day of the month ("17").' },
  { tag: 'event.month', kind: 'text', desc: 'Month ("October").' },
  { tag: 'event.month_short', kind: 'text', desc: 'Short month ("Oct").' },
  { tag: 'event.time', kind: 'text', desc: 'Start time ("23:00").' },
  { tag: 'event.venue', kind: 'text', desc: 'Venue of the night.' },
  { tag: 'event.city', kind: 'text', desc: 'City of the night.' },
  { tag: 'event.place', kind: 'text', desc: 'Venue and city ("Le Bunker · Paris").' },
  { tag: 'event.poster', kind: 'image', desc: 'Poster of the night (empty when none).' },
  { tag: 'event.tickets_url', kind: 'url', desc: 'Ticketing page of the night (empty when none).' },
  { tag: 'event.sold_out', kind: 'boolean', desc: 'True when the night is sold out.' },
  { tag: 'event.has_date', kind: 'boolean', desc: 'True when the page is linked to a night with a date.' },
  { tag: 'reward.on', kind: 'boolean', desc: 'True when the page promises a reward for signing up.' },
  { tag: 'reward.label', kind: 'text', desc: 'The reward ("Free drink on arrival"). Empty when off.' },
  { tag: 'reward.how', kind: 'text', desc: 'How to get the reward (custom rewards only).' },
  { tag: 'scene.form', kind: 'boolean', desc: 'True before sign-up, while the form is shown.' },
  { tag: 'scene.noted', kind: 'boolean', desc: 'True after sign-up ("You are on the list").' },
  { tag: 'scene.open', kind: 'boolean', desc: 'Presale: true once sales opened (the page then sends to the tickets).' },
  { tag: 'scene.closed', kind: 'boolean', desc: 'True when the page is closed.' },
  { tag: 'scene.soon', kind: 'boolean', desc: 'True when the page opens later.' },
  { tag: 'fan.first_name', kind: 'text', desc: 'First name the fan just typed: only after sign-up (scene.noted), empty before.' },
];

const PAGE_KNOWN = new Set<string>([
  ...PAGE_TAGS.map((t) => t.tag),
  'page', 'host', 'event', 'reward', 'scene', 'fan', 'lang',
  // Alias acceptés par le moteur des e-mails ({{club}}, {{soirée}}, {{ville}}, {{prénom}}).
  'venue_name', 'event_title', 'city', 'first_name',
]);

export interface PageTagInput {
  locale: string;
  lang: 'fr' | 'en' | 'es';
  kind: SignupKind;
  title: string;
  tagline: string;
  button: string;
  poster: string | null;
  pageUrl: string | null;
  host: { name: string; logo?: string | null; city?: string | null; instagram?: string | null };
  event: { title: string; start_at: string; tz?: string | null; venue?: string | null; city?: string | null; poster?: string | null; ticket_url?: string | null; sold_out?: boolean } | null;
  /** Nombre d'inscrits, ou null quand la page ne montre pas son compteur. */
  count: number | null;
  saleAt: string | null;
  saleOpen: boolean;
  reward: { on: boolean; label: string; how: string };
  scene: string;
  firstName?: string;
  /** « Date bientôt annoncée », dans la langue de la page. */
  tbaLabel?: string;
}

function fmtDate(iso: string, locale: string, tz: string | undefined, o: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat(locale, { ...o, ...(tz ? { timeZone: tz } : {}) }).format(new Date(iso));
  } catch {
    return '';
  }
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const ini = (s: string) => s.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const httpsOrEmpty = (u: unknown) => (typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u.trim()) ? u.trim() : '');

/** Les valeurs que les balises écrivent, pour une page, une scène et une langue. */
export function buildPageTagData(i: PageTagInput): Record<string, unknown> {
  const ev = i.event;
  const tz = ev?.tz || undefined;
  const ok = !!ev && !Number.isNaN(Date.parse(ev.start_at));
  const d = (o: Intl.DateTimeFormatOptions) => (ok ? fmtDate(ev!.start_at, i.locale, tz, o) : '');
  const time = d({ hour: '2-digit', minute: '2-digit', hour12: false });
  const short = d({ weekday: 'short', day: 'numeric', month: 'short' });
  const event = ev ? {
    title: ev.title || '',
    date: ok ? `${cap(short)} · ${time}` : (i.tbaLabel || ''),
    date_long: cap(d({ weekday: 'long', day: 'numeric', month: 'long' })),
    weekday: d({ weekday: 'long' }),
    day: d({ day: 'numeric' }),
    month: d({ month: 'long' }),
    month_short: d({ month: 'short' }),
    time,
    venue: ev.venue || '',
    city: ev.city || '',
    place: [ev.venue, ev.city].filter(Boolean).join(' · '),
    poster: httpsOrEmpty(ev.poster),
    tickets_url: httpsOrEmpty(ev.ticket_url),
    sold_out: !!ev.sold_out,
    has_date: ok,
  } : {
    title: '', date: '', date_long: '', weekday: '', day: '', month: '', month_short: '', time: '',
    venue: '', city: '', place: '', poster: '', tickets_url: '', sold_out: false, has_date: false,
  };
  const saleDate = i.kind === 'prevente' && i.saleAt && !Number.isNaN(Date.parse(i.saleAt))
    ? fmtDate(i.saleAt, i.locale, tz, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
    : '';
  const count = i.count == null ? '' : new Intl.NumberFormat(i.locale).format(Math.max(0, i.count)).replace(/[\u202f\u00a0]/g, ' ');
  const host = {
    name: i.host.name || '',
    logo: httpsOrEmpty(i.host.logo),
    city: i.host.city || '',
    instagram: httpsOrEmpty(i.host.instagram),
    initials: ini(i.host.name || ''),
  };
  const scene = i.scene;
  return {
    lang: i.lang,
    page: {
      title: i.title || '', tagline: i.tagline || '', button: i.button || '',
      poster: httpsOrEmpty(i.poster) || event.poster,
      url: httpsOrEmpty(i.pageUrl) || (i.pageUrl && /^http:\/\/(localhost|127\.0\.0\.1)/.test(i.pageUrl) ? i.pageUrl : ''),
      kind: i.kind, count, show_count: i.count != null, sale_date: saleDate, sale_open: !!i.saleOpen,
    },
    host,
    event,
    reward: { on: !!i.reward.on, label: i.reward.on ? i.reward.label || '' : '', how: i.reward.on ? i.reward.how || '' : '' },
    scene: { form: scene === 'form', noted: scene === 'noted', open: scene === 'open', closed: scene === 'closed', soon: scene === 'soon' },
    fan: { first_name: scene === 'noted' ? (i.firstName || '') : '' },
    venue_name: host.name, event_title: event.title, city: host.city || event.city, first_name: scene === 'noted' ? (i.firstName || '') : '',
  };
}

/**
 * Une section rendue : balises résolues (valeurs échappées), puis nettoyée.
 * C'est LA fonction que la page publique, les aperçus et le contrôle du Worker
 * appellent ; le navigateur ajoute DOMPurify par-dessus.
 */
export function renderPageSection(html: string, data: Record<string, unknown>): string {
  return sanitizePageHtml(renderSmartTemplate(String(html || '').slice(0, CUSTOM_LIMITS.sectionHtml * 2), data)).text;
}

/** Texte visible d'une section (sans balises de logique), pour la retrouver sur une capture. */
export function pageSectionText(html: string): string {
  return sectionText(html).replace(/\{\{\s*(?:[#^/][^}]*|else)\s*\}\}/g, ' ').replace(/\s+/g, ' ').trim();
}

// ── Contrôle d'un design (Worker avant d'écrire, Console pour prévenir) ──────

export interface PageIssue { code: string; level: 'error' | 'warning'; message: string; section?: number }

/** Rapport de contraste WCAG entre deux couleurs. */
export function contrastRatio(a: string, b: string): number {
  if (!isHex(a) || !isHex(b)) return 21;
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

function tagPaths(nodes: ReturnType<typeof parseSmart>['nodes'], into: string[]): void {
  for (const n of nodes) {
    if (n.t === 'var') into.push(n.path);
    if (n.t === 'block') { into.push(n.path); tagPaths(n.body, into); tagPaths(n.alt, into); }
  }
}

export interface LintPageOptions {
  /** La page est reliée à une soirée (sinon les balises event.* restent vides). */
  hasEvent: boolean;
  /** Éléments retirés au nettoyage, par section (rendus en avertissements). */
  removed?: { section: number; elements: string[] }[];
}

/** Erreurs (rien n'est écrit) et avertissements d'un design sur mesure. */
export function lintCustomDesign(d: CustomDesign, opt: LintPageOptions): PageIssue[] {
  const out: PageIssue[] = [];
  const add = (level: PageIssue['level'], code: string, message: string, section?: number) =>
    out.push(section == null ? { code, level, message } : { code, level, message, section });

  const forms = d.sections.filter((s) => s.type === 'yuno' && s.block === 'form').length;
  if (forms !== 1) add('error', 'form_block', 'The page needs exactly one Yuno form block ({"yuno_block": "form"}): it carries the fields, the consent box and the confirmation.');
  if (d.sections.length > CUSTOM_LIMITS.sections) add('error', 'too_many_sections', `At most ${CUSTOM_LIMITS.sections} sections.`);
  const weight = designWeight(d);
  if (weight > CUSTOM_LIMITS.total) add('error', 'design_too_large', `The design weighs ${Math.round(weight / 1000)} KB: keep it under ${CUSTOM_LIMITS.total / 1000} KB (merge sections, drop inline data images).`);

  let hasTitle = false;
  d.sections.forEach((s, i) => {
    if (s.type !== 'html') return;
    if (s.html.length > CUSTOM_LIMITS.sectionHtml) add('error', 'section_too_large', `Section ${i}: HTML over ${CUSTOM_LIMITS.sectionHtml / 1000} KB.`, i);
    const { nodes, issues } = parseSmart(s.html);
    for (const p of issues) {
      if (p.code === 'raw_html_tag') add('error', 'raw_tag', `Section ${i}: ${p.tag} is not allowed (values are always escaped): use {{…}}.`, i);
      else add('error', p.code, `Section ${i}: ${p.code.replace(/_/g, ' ')} near ${p.tag}.`, i);
    }
    const paths: string[] = [];
    tagPaths(nodes, paths);
    for (const p of paths) {
      if (!p || p === 'this' || p === '.' || p.startsWith('@')) continue;
      const c = canonicalTag(p);
      if (!PAGE_KNOWN.has(c)) add('error', 'unknown_tag', `Section ${i}: unknown tag {{${p}}}. Page tags: ${PAGE_TAGS.map((t) => t.tag).slice(0, 12).join(', ')}… (full list in get_signup_page_kit).`, i);
      else if (!opt.hasEvent && (c.startsWith('event.') || c === 'event_title') && c !== 'event.has_date') {
        add('warning', 'event_tag_without_event', `Section ${i}: {{${p}}} stays empty: the page is not linked to a night.`, i);
      }
    }
    if (/\{\{\s*page\.title\s*\}\}|<h1\b/i.test(s.html)) hasTitle = true;
    if (/<img\b(?![^>]*\balt\s*=)[^>]*>/i.test(s.html)) add('warning', 'img_alt', `Section ${i}: an <img> has no alt text.`, i);
    if (/position\s*:\s*fixed|100vh|100dvh/i.test(`${s.html} ${s.css ?? ''}`)) {
      add('warning', 'viewport_units', `Section ${i}: position fixed and vh units refer to the section, not the screen (previews show the page in a phone). Use relative sizes.`, i);
    }
    if (/\bwidth\s*:\s*(4[89]\d|[5-9]\d\d|\d{4,})px/i.test(`${s.html} ${s.css ?? ''}`)) {
      add('warning', 'too_wide', `Section ${i}: a fixed width above 480 px overflows a phone. Use max-width and %.`, i);
    }
  });
  if (!hasTitle) add('warning', 'no_title', 'No section shows the page title ({{page.title}} or an <h1>): visitors need to read what they sign up for.');

  for (const r of opt.removed ?? []) {
    add('warning', 'removed_by_yuno', `Section ${r.section}: removed ${r.elements.join(', ')} (not allowed on a public page; images must be hosted on Yuno: add_email_image).`, r.section);
  }

  const t = d.theme;
  const cr = contrastRatio(t.text, t.bg);
  if (cr < 4.5) add('warning', 'low_contrast_text', `Text ${t.text} on background ${t.bg} has a contrast of ${cr.toFixed(1)}:1 (aim for 4.5:1).`);
  const aFg = t.accent_text || onC(t.accent);
  const ca = contrastRatio(aFg, t.accent);
  if (ca < 3) add('warning', 'low_contrast_button', `Button text ${aFg} on ${t.accent} has a contrast of ${ca.toFixed(1)}:1 (aim for 3:1 at least).`);
  if (isHex(t.card_bg)) {
    const ink = onC(t.card_bg);
    if (contrastRatio(ink, t.card_bg) < 4.5) add('warning', 'low_contrast_form', 'The form box color makes its text hard to read.');
  }
  return out;
}

// ── Thème → jetons de FanPage (les mêmes que les gabarits) ───────────────────

/** Polices Google à charger pour un design (titres, texte, extras). */
export function customFontFamilies(t: CustomTheme): { family: string; weights: number[] }[] {
  const out = new Map<string, Set<number>>();
  const add = (f: string, w: number[]) => { const s = out.get(f) ?? new Set<number>(); w.forEach((x) => s.add(x)); out.set(f, s); };
  add(t.font_heading, [t.heading_weight]);
  add(t.font_body, [400, 600, 700]);
  for (const f of t.extra_fonts ?? []) add(f, [400, 700]);
  return [...out.entries()].map(([family, w]) => ({ family, weights: [...w].sort((a, b) => a - b) }));
}

/** Feuille Google Fonts d'une famille (avec ses graisses, ou sans quand elles n'existent pas). */
export function googleFontHref(family: string, weights?: number[]): string {
  const f = family.trim().replace(/ +/g, '+');
  return `https://fonts.googleapis.com/css2?family=${f}${weights?.length ? `:wght@${weights.join(';')}` : ''}&display=swap`;
}

const shadowFor = (kind: Shadow, aRgb: string, hard: string): string => (
  kind === 'soft' ? `0 10px 28px rgba(${aRgb},.38),inset 0 1px 0 rgba(255,255,255,.35)`
    : kind === 'hard' ? `4px 4px 0 ${hard}`
      : kind === 'glow' ? `0 0 0 1px rgba(${aRgb},.55),0 8px 34px rgba(${aRgb},.55)`
        : 'none'
);

/**
 * Les jetons d'une page sur mesure, dans la forme de `tokens()` : le
 * formulaire, la case d'accord, le bouton et « C'est noté » de FanPage s'y
 * lisent exactement comme sur un gabarit.
 */
export function customTokens(theme: CustomTheme): Tokens {
  const t = normalizeTheme(theme);
  const bg = t.bg, ink = t.text, a = t.accent, b = t.accent2 || a;
  const dark = onC(bg) === '#FFFFFF';
  const cardHex = isHex(t.card_bg) ? t.card_bg : '';
  const glass = t.card_bg === 'glass';
  const k = cardHex ? (onC(cardHex) === '#FFFFFF' ? '#F7F2F1' : '#1C1517') : ink;
  const R = {
    bg, bgRgb: rgbs(bg), ink, inkRgb: rgbs(ink), a, b, aRgb: rgbs(a), aFg: t.accent_text || onC(a), k, kRgb: rgbs(k),
    line: rgba(ink, 0.16), soft: rgba(ink, 0.07), kLine: rgba(k, 0.22), kSoft: rgba(k, 0.07), kM: rgba(k, 0.72), inkM: rgba(ink, 0.74), inkF: rgba(ink, 0.5),
  };
  const under = t.input_style === 'underline', pill = t.input_style === 'pill';
  const upper = t.button_case === 'uppercase';
  const boxed = !!cardHex || glass || t.card_border !== 'none' || t.card_shadow !== 'none';
  const hardInk = t.shadow_color || (dark ? a : '#1C1517');
  const s: ResolvedStyle = {
    ...DEFAULT_STYLE,
    hs: 34, hup: t.heading_case, hlh: 1.02,
    inH: 52,
    inRad: under ? '0' : pill ? '99px' : `${t.radius}px`,
    inBw: under ? '0 0 1.5px' : '1.5px',
    inBg: under || t.input_bg === 'transparent' ? 'transparent' : isHex(t.input_bg) ? t.input_bg : R.kSoft,
    inBd: under ? rgba(k, 0.55) : R.kLine,
    chRad: pill ? '99px' : `${t.radius}px`, chBw: '1.5px', chBd: R.kLine,
    bH: t.button_height, bRad: `${t.button_radius}px`,
    bBd: t.button_style === 'outline' ? `1.5px solid ${a}` : 'none',
    bSh: shadowFor(t.button_shadow, R.aRgb, hardInk),
    bTr: 'none', bUp: t.button_case, bFs: 16.5, bLs: upper ? '.06em' : '0',
    bFam: t.button_font === 'heading' ? 'head' : 'body', arrow: t.button_arrow,
    bMode: t.button_style === 'outline' ? 'outline' : 'solid', bPre: '', bSuf: '', grad: t.button_style === 'gradient',
    lbF: t.label_style === 'mono' ? 'mono' : 'body', lbS: t.label_style === 'mono' ? 12 : 13.5,
    lbT: t.label_style === 'normal' ? 'none' : 'uppercase', lbLs: t.label_style === 'normal' ? '0' : '.06em', lbW: 600, lbPre: '',
    wBg: cardHex || (glass ? `rgba(${R.inkRgb},.07)` : 'transparent'),
    wBd: isHex(t.card_border) ? `1.5px solid ${t.card_border}` : glass ? `1px solid rgba(${R.inkRgb},.18)` : 'none',
    wRad: `${t.card_radius}px`,
    wSh: t.card_shadow === 'soft' ? '0 18px 50px rgba(0,0,0,.28)' : t.card_shadow === 'hard' ? `6px 6px 0 ${hardInk}` : t.card_shadow === 'glow' ? `0 0 44px rgba(${R.aRgb},.35)` : 'none',
    wMx: boxed ? '8px 16px 0' : '0',
    wPad: boxed ? '20px' : '14px 20px 22px',
    wBlur: glass ? 'blur(20px)' : 'none',
    wBt: 'none', wFlex: 'none',
    bodyF: `'${t.font_body}'`,
    rootBg: t.bg_css ? `${t.bg_css},linear-gradient(${bg},${bg})` : bg,
  };
  const F: TokenFont = { id: 'custom', f: `'${t.font_heading}'`, sc: 1, w: t.heading_weight, ls: `${t.heading_tracking}em` };
  const kDark = cardHex ? onC(cardHex) === '#FFFFFF' : dark;
  return { ...R, id: 'custom', lay: 'custom', dark, card: cardHex, kDark, errC: kDark ? '#FF948D' : '#C0261D', F, s };
}

/** Les jetons d'une page : ceux de son design sur mesure, sinon ceux de son gabarit. */
export function pageTokens(cfg: { design: Partial<SignupDesign> | null | undefined; custom?: unknown }): Tokens {
  const c = normalizeCustomDesign(cfg.custom);
  return c ? customTokens(c.theme) : tokens(cfg.design);
}

/** Échappement d'un texte destiné à du HTML (utile aux exemples du kit). */
export const escapePageText = escapeSmart;
