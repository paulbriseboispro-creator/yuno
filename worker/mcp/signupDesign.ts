// Pages d'inscription dessinées par l'IA : de la demande de l'IA (réglages,
// thème, sections HTML avec balises Yuno, blocs Yuno) au contenu d'une page
// (crm_signup_page_save + custom_design), contrôlé avant d'être écrit.
//
// Le Worker prépare et contrôle ; l'écriture, ses droits et ses débits vivent
// dans mcp_write (migration 20261009160000). Le nettoyage, les balises et le
// contrôle sont ceux de la Console (src/crm/signup/custom.ts) : une seule
// définition. Pur et testé (worker/mcp/__tests__/signup.test.ts).

import {
  PAGE_BLOCKS, SHOW_ON, buildPageTagData, isAllowedAssetUrl, lintCustomDesign, normalizeCustomDesign, normalizeTheme,
  pageSectionText, sanitizePageCss, sanitizePageHtml,
  type CustomDesign, type CustomTheme, type PageIssue, type PageSection,
} from '../../src/crm/signup/custom';

export const PAGE_KINDS = ['prevente', 'venue', 'attente', 'communaute'] as const;
export const TEMPLATES = ['soiree', 'affiche', 'brutal', 'edito', 'ticket', 'affichage', 'verre', 'epure', 'flyer', 'terminal'] as const;
export const TEMPLATE_FONTS = ['brico', 'anton', 'serif', 'space', 'black', 'mono'] as const;
export const CLOSES = ['sale', 'eve', 'manual', 'never', 'date'] as const;
export const CONTACTS = ['both', 'email', 'phone', 'all'] as const;
export const REWARD_PRESETS = ['prio', 'drink', 'pre', 'custom'] as const;
export const REWARD_ICONS = ['gift', 'ticket', 'bolt', 'users', 'clock'] as const;

/** Fermetures permises par type de page (KIND_META de la Console). */
const KIND_CLOSES: Record<string, readonly string[]> = {
  prevente: ['sale', 'date'], venue: ['eve', 'date'], attente: ['manual', 'date'], communaute: ['never', 'date'],
};

const HEX = /^#[0-9a-fA-F]{6}$/;
const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);

// ── Entrées de l'IA ──────────────────────────────────────────────────────────

export interface PageSectionInput {
  html?: string;
  css?: string;
  yuno_block?: typeof PAGE_BLOCKS[number];
  label?: string;
  show_on?: typeof SHOW_ON[number];
  tagline?: boolean;
}

export interface PageSectionUpdate extends PageSectionInput {
  id?: string;
  index?: number;
  action?: 'edit' | 'remove' | 'insert_before' | 'insert_after' | 'move';
  move_to?: number;
}

export interface TemplateInput {
  name?: typeof TEMPLATES[number];
  palette?: string;
  background?: string;
  accent?: string;
  font?: typeof TEMPLATE_FONTS[number];
}

export interface FieldsInput {
  contact?: typeof CONTACTS[number];
  extra_fields?: Partial<Record<'last_name' | 'birthdate' | 'instagram' | 'city', 'off' | 'optional' | 'required'>>;
  questions?: { label: string; options: string[]; multiple?: boolean; party_size?: boolean }[];
}

export interface RewardInput {
  on?: boolean;
  preset?: typeof REWARD_PRESETS[number];
  label?: string;
  how?: string;
  icon?: typeof REWARD_ICONS[number];
}

export interface PageArgs {
  space?: string;
  page_id?: string;
  page_version?: string;
  kind?: string;
  event?: string;
  language?: string;
  title?: string;
  tagline?: string;
  button_label?: string;
  thanks_message?: string;
  poster_url?: string;
  fields?: FieldsInput;
  reward?: RewardInput;
  show_count?: boolean;
  countdown?: boolean;
  opens_at?: string;
  sale_opens_at?: string;
  closes_mode?: string;
  closes_at?: string;
  template?: TemplateInput;
  design_mode?: 'custom' | 'template';
  theme?: Partial<CustomTheme>;
  sections?: PageSectionInput[];
  section_updates?: PageSectionUpdate[];
}

// ── Sections ────────────────────────────────────────────────────────────────

function sectionId(i: number): string {
  const r = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `ai_${i}_${r}`;
}

interface Made { section: PageSection; removed: string[] }

/** Une section de l'IA → une section du design (HTML et CSS nettoyés, éléments retirés notés). */
function makeSection(s: PageSectionInput, id: string): Made {
  if (s.yuno_block) {
    const y: PageSection = { id: s.yuno_block === 'form' ? 'form' : id, type: 'yuno', block: s.yuno_block };
    if (s.label) y.label = s.label.slice(0, 60);
    if (s.show_on && s.show_on !== 'always' && s.yuno_block !== 'form') y.show_on = s.show_on;
    if (s.yuno_block === 'form' && s.tagline === false) y.tagline = false;
    return { section: y, removed: [] };
  }
  const html = sanitizePageHtml(String(s.html || ''));
  const css = s.css ? sanitizePageCss(s.css) : null;
  const h: PageSection = { id, type: 'html', html: html.text.trim() };
  if (css?.text) h.css = css.text;
  if (s.label) h.label = s.label.slice(0, 60);
  if (s.show_on && s.show_on !== 'always') h.show_on = s.show_on;
  return { section: h, removed: [...html.removed, ...(css?.removed ?? [])] };
}

export interface PreparedDesign {
  design: CustomDesign;
  removed: { section: number; elements: string[] }[];
  notes: string[];
  error?: { code: string; message: string };
}

const formCount = (list: PageSectionInput[]) => list.filter((s) => s.yuno_block === 'form').length;

/** Sections + thème de l'IA → design sur mesure (Yuno pose son formulaire s'il manque). */
export function buildDesign(theme: Partial<CustomTheme> | undefined, sections: PageSectionInput[], base?: CustomTheme): PreparedDesign {
  const notes: string[] = [];
  const removed: PreparedDesign['removed'] = [];
  if (formCount(sections) > 1) {
    return { design: emptyDesign(), removed, notes, error: { code: 'form_block', message: 'Place the Yuno form block ({"yuno_block": "form"}) once only.' } };
  }
  const made = sections.map((s, i) => {
    const m = makeSection(s, sectionId(i));
    if (m.removed.length) removed.push({ section: i, elements: m.removed });
    return m.section;
  });
  if (!formCount(sections)) notes.push('No form block was placed: Yuno added its form after the last section. Place {"yuno_block": "form"} where the sign-up belongs (usually right after the hero).');
  const design = normalizeCustomDesign({ v: 1, theme: { ...(base ?? {}), ...(theme ?? {}) }, sections: made })!;
  return { design, removed, notes };
}

function emptyDesign(): CustomDesign {
  return normalizeCustomDesign({ v: 1, theme: {}, sections: [] })!;
}

export interface SectionsUpdateResult {
  design?: CustomDesign;
  error?: { code: string; message: string };
  changes: string[];
  removed: { section: number; elements: string[] }[];
}

const describe = (s: PageSection) => (s.label ? `"${s.label}"` : s.type === 'yuno' ? `the ${s.block} block` : 'a section');

/**
 * Modifications ciblées d'un design (update_signup_page), dans l'ordre donné.
 * Une section se désigne par son `id` (stable) ou son `index` lu dans
 * get_signup_page, converti en id avant de commencer.
 */
export function applyPageSectionUpdates(current: CustomDesign, updates: PageSectionUpdate[], theme?: Partial<CustomTheme>): SectionsUpdateResult {
  const next: PageSection[] = current.sections.map((s) => ({ ...s }));
  const changes: string[] = [];
  const removed: SectionsUpdateResult['removed'] = [];
  const fail = (code: string, message: string): SectionsUpdateResult => ({ error: { code, message }, changes: [], removed: [] });
  const targets: string[] = [];
  for (const u of updates) {
    if (typeof u.id === 'string' && u.id) {
      if (!current.sections.some((s) => s.id === u.id)) return fail('section_not_found', `No section with id "${u.id}" on this page. Read it again with get_signup_page.`);
      targets.push(u.id);
    } else if (Number.isInteger(u.index)) {
      const s = current.sections[u.index as number];
      if (!s) return fail('section_not_found', `Index ${u.index} does not exist (the page has ${current.sections.length} sections, numbered from 0).`);
      targets.push(s.id);
    } else {
      return fail('invalid_args', 'Each section update needs "id" (preferred) or "index" from get_signup_page.');
    }
  }
  let n = 0;
  for (let k = 0; k < updates.length; k++) {
    const u = updates[k];
    const id = targets[k];
    const at = next.findIndex((s) => s.id === id);
    if (at < 0) continue;
    const action = u.action ?? 'edit';
    if (action === 'remove') {
      if (next[at].type === 'yuno' && (next[at] as { block: string }).block === 'form') {
        return fail('form_block', 'The Yuno form block cannot be removed: it carries the fields and the consent box. Move it instead.');
      }
      changes.push(`removed ${describe(next[at])}`);
      next.splice(at, 1);
      continue;
    }
    if (action === 'move') {
      if (!Number.isInteger(u.move_to)) return fail('invalid_args', 'move needs move_to (new position, 0 = top).');
      const [s] = next.splice(at, 1);
      const to = Math.max(0, Math.min(next.length, u.move_to as number));
      next.splice(to, 0, s);
      changes.push(`moved ${describe(s)} to position ${to}`);
      continue;
    }
    if (action === 'insert_before' || action === 'insert_after') {
      if (!u.html && !u.yuno_block) return fail('invalid_args', `${action} needs html (a new section) or yuno_block.`);
      if (u.yuno_block && next.some((s) => s.type === 'yuno' && s.block === u.yuno_block)) {
        return fail('invalid_args', `The page already has a ${u.yuno_block} block: move it instead of inserting another.`);
      }
      const made = makeSection(u, sectionId(100 + n++));
      if (made.removed.length) removed.push({ section: at, elements: made.removed });
      next.splice(action === 'insert_before' ? at : at + 1, 0, made.section);
      changes.push(`inserted ${describe(made.section)} ${action === 'insert_before' ? 'above' : 'below'} ${describe(next[action === 'insert_before' ? at + 1 : at])}`);
      continue;
    }
    // edit
    const cur = next[at];
    if (u.yuno_block && !(cur.type === 'yuno' && cur.block === u.yuno_block)) {
      if (cur.type === 'yuno' && cur.block === 'form') return fail('form_block', 'The form block cannot become another block. Insert the new block instead.');
      if (next.some((s) => s.type === 'yuno' && s.block === u.yuno_block)) return fail('invalid_args', `The page already has a ${u.yuno_block} block.`);
      const made = makeSection({ ...u, html: undefined }, cur.id);
      next[at] = made.section;
      changes.push(`replaced ${describe(cur)} with the ${u.yuno_block} block`);
    } else if (u.html !== undefined || u.css !== undefined) {
      if (cur.type !== 'html' && u.html === undefined) return fail('invalid_args', 'css applies to an HTML section only.');
      if (cur.type === 'yuno' && cur.block === 'form') return fail('form_block', 'The form block cannot become a custom section. Insert a section above or below it instead.');
      const made = makeSection({ html: u.html ?? (cur.type === 'html' ? cur.html : ''), css: u.css ?? (cur.type === 'html' ? cur.css : undefined), label: cur.label, show_on: cur.show_on }, cur.id);
      if (made.removed.length) removed.push({ section: at, elements: made.removed });
      next[at] = made.section;
      changes.push(`rewrote ${describe(made.section)}`);
    }
    const s = next[at];
    if (u.label !== undefined) s.label = u.label.slice(0, 60) || undefined;
    if (u.show_on !== undefined && !(s.type === 'yuno' && s.block === 'form')) {
      if (u.show_on === 'always') delete s.show_on;
      else s.show_on = u.show_on;
    }
    if (u.tagline !== undefined && s.type === 'yuno' && s.block === 'form') {
      if (u.tagline === false) s.tagline = false;
      else delete s.tagline;
    }
    if ((u.label !== undefined || u.show_on !== undefined || u.tagline !== undefined) && u.html === undefined && u.css === undefined && !u.yuno_block) {
      changes.push(`updated settings of ${describe(s)}`);
    }
  }
  const design = normalizeCustomDesign({ v: 1, theme: { ...current.theme, ...(theme ?? {}) }, sections: next })!;
  return { design, changes, removed };
}

// ── Réglages : de l'IA à crm_signup_page_save ───────────────────────────────

export interface SettingsResult {
  patch: Record<string, unknown>;
  errors: PageIssue[];
}

/** Réglages de l'IA → patch de la Console (mêmes clés et formes que l'assistant). */
export function settingsPatch(a: PageArgs, kind: string): SettingsResult {
  const patch: Record<string, unknown> = {};
  const errors: PageIssue[] = [];
  const err = (code: string, message: string) => errors.push({ code, level: 'error', message });
  if (a.kind) patch.kind = a.kind;
  for (const [k, max] of [['title', 40], ['tagline', 140], ['button_label', 30], ['thanks_message', 200]] as const) {
    if (a[k] !== undefined) patch[k] = str(a[k], max);
  }
  if (a.language) patch.lang = a.language;
  if (a.poster_url !== undefined) {
    if (a.poster_url === '' || /^none$/i.test(a.poster_url)) patch.poster_url = null;
    else if (!isAllowedAssetUrl(a.poster_url)) err('poster_not_on_yuno', 'poster_url must be an image hosted on Yuno (the URL returned by add_email_image, or the event poster from the kit). Images from other sites do not load on Yuno pages.');
    else patch.poster_url = a.poster_url;
  }
  if (a.show_count !== undefined) patch.show_count = a.show_count;
  if (a.countdown !== undefined) patch.countdown = a.countdown;
  for (const k of ['opens_at', 'sale_opens_at', 'closes_at'] as const) {
    const v = a[k];
    if (v === undefined) continue;
    if (v === '' || /^none$/i.test(v)) { patch[k] = null; continue; }
    if (Number.isNaN(Date.parse(v))) err('invalid_dates', `${k} is not a date: use ISO 8601 with a timezone offset ("2026-10-24T18:00:00+02:00").`);
    else patch[k] = new Date(v).toISOString();
  }
  if (a.closes_mode) {
    if (!(KIND_CLOSES[kind] ?? CLOSES).includes(a.closes_mode)) err('invalid_dates', `closes_mode "${a.closes_mode}" does not fit a ${kind} page: use ${(KIND_CLOSES[kind] ?? CLOSES).join(' or ')}.`);
    else patch.closes_mode = a.closes_mode;
    if (a.closes_mode === 'date' && !a.closes_at) err('invalid_dates', 'closes_mode "date" needs closes_at.');
  }
  if (a.kind === 'prevente' && a.sale_opens_at === undefined && a.countdown) {
    // Rien : la Console accepte une prévente sans date (le compte à rebours se tait).
  }
  if (a.fields) {
    const f = a.fields;
    const extra: Record<string, { on: boolean; req: boolean }> = {};
    const map = { last_name: 'nom', birthdate: 'naissance', instagram: 'insta', city: 'ville' } as const;
    for (const [k, id] of Object.entries(map)) {
      const v = f.extra_fields?.[k as keyof typeof map];
      if (v === 'optional' || v === 'required') extra[id] = { on: true, req: v === 'required' };
    }
    const qs = (f.questions ?? []).slice(0, 3);
    if (qs.length > 2) err('invalid_fields', 'Two questions at most (each one costs sign-ups).');
    for (const q of qs) {
      if (!q.label?.trim() || q.label.length > 60) err('invalid_fields', 'A question needs a label of 60 characters at most.');
      if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 6 || q.options.some((o) => !String(o).trim() || String(o).length > 40)) {
        err('invalid_fields', `Question "${q.label}": 2 to 6 answers, 40 characters each at most.`);
      }
    }
    patch.fields = {
      contact: f.contact ?? 'both',
      extra,
      questions: qs.slice(0, 2).map((q) => ({ label: q.label.trim(), options: q.options.map((o) => String(o).trim()), multi: !!q.multiple, ...(q.party_size ? { party: true } : {}) })),
    };
  }
  if (a.reward) {
    const r = a.reward;
    const preset = r.preset ?? (r.label ? 'custom' : 'drink');
    if (preset === 'custom' && r.on !== false && !r.label?.trim()) err('invalid_reward', 'A custom reward needs a label (40 characters at most).');
    patch.reward = { on: r.on !== false, preset, label: str(r.label, 40) ?? '', how: str(r.how, 70) ?? '', icon: r.icon ?? 'gift' };
  }
  if (a.template) {
    const t = a.template;
    const design: Record<string, unknown> = { tpl: t.name ?? 'soiree', pal: t.palette ?? (t.background || t.accent ? 'custom' : 'p0'), bg: '', acc: '', font: t.font ?? '' };
    if (t.background) { if (HEX.test(t.background)) design.bg = t.background; else err('invalid_args', 'template.background must be #rrggbb.'); }
    if (t.accent) { if (HEX.test(t.accent)) design.acc = t.accent; else err('invalid_args', 'template.accent must be #rrggbb.'); }
    // La palette par défaut d'un gabarit : sa première ('red' pour Soirée, 'p0' ailleurs).
    if (design.pal === 'p0' && design.tpl === 'soiree') design.pal = 'red';
    patch.design = design;
  }
  return { patch, errors };
}

/** Gabarit de repli d'une page sur mesure : Soirée aux couleurs du thème (si le pro revient aux gabarits). */
export function templateFallback(t: CustomTheme): Record<string, unknown> {
  return { tpl: 'soiree', pal: 'custom', bg: t.bg, acc: t.accent, font: '' };
}

// ── Lecture d'une page : ce que l'IA voit de chaque section ─────────────────

export function sectionView(s: PageSection, index: number): Record<string, unknown> {
  const out: Record<string, unknown> = { index, id: s.id };
  if (s.label) out.label = s.label;
  out.show_on = s.show_on ?? 'always';
  if (s.type === 'yuno') {
    out.yuno_block = s.block;
    if (s.block === 'form') out.tagline = s.tagline !== false;
    return out;
  }
  out.text = pageSectionText(s.html).slice(0, 400);
  out.html = s.html;
  if (s.css) out.css = s.css;
  return out;
}

// ── Contrôle ─────────────────────────────────────────────────────────────────

export interface PageCheck { errors: PageIssue[]; warnings: PageIssue[]; tag_preview?: Record<string, unknown> }

export interface EventFactsLite {
  title?: string; start_at?: string; tz?: string; venue?: string | null; city?: string | null;
  cover_url?: string | null; ticket_url?: string | null; sold_out?: boolean;
}

/** Contrôle complet avant écriture : le design (balises, structure, poids, contraste) et les réglages. */
export function checkPage(input: { design: CustomDesign | null; removed: PreparedDesign['removed']; hasEvent: boolean; settingErrors: PageIssue[]; notes?: string[] }): PageCheck {
  const issues: PageIssue[] = [...input.settingErrors];
  if (input.design) issues.push(...lintCustomDesign(input.design, { hasEvent: input.hasEvent, removed: input.removed }));
  for (const n of input.notes ?? []) issues.push({ code: 'note', level: 'warning', message: n });
  return { errors: issues.filter((i) => i.level === 'error'), warnings: issues.filter((i) => i.level === 'warning') };
}

/** Ce que les balises écrivent aujourd'hui pour cette page (aperçu de l'IA). */
export function pageTagPreview(input: {
  lang: 'fr' | 'en' | 'es'; kind: string; title?: string; tagline?: string; button?: string; poster?: string | null;
  host: { name: string; logo?: string | null; city?: string | null; instagram?: string | null }; event: EventFactsLite | null; saleAt?: string | null;
}): Record<string, unknown> {
  const locale = input.lang === 'en' ? 'en-GB' : input.lang === 'es' ? 'es-ES' : 'fr-FR';
  const ev = input.event && input.event.title && input.event.start_at ? {
    title: input.event.title, start_at: input.event.start_at, tz: input.event.tz ?? 'Europe/Paris', venue: input.event.venue,
    city: input.event.city, poster: input.event.cover_url, ticket_url: input.event.ticket_url, sold_out: input.event.sold_out,
  } : null;
  const d = buildPageTagData({
    locale, lang: input.lang, kind: (PAGE_KINDS as readonly string[]).includes(input.kind) ? input.kind as never : 'prevente',
    title: input.title || '(page title)', tagline: input.tagline || '(page tagline)', button: input.button || '(button label)',
    poster: input.poster ?? null, pageUrl: 'https://crm.yunoapp.eu/j/your-page', host: input.host, event: ev,
    count: 128, saleAt: input.saleAt ?? null, saleOpen: false, reward: { on: true, label: '(reward label)', how: '' }, scene: 'form',
  });
  return { ...d, note: 'Values shown for the form scene; page.count is an example (128). The page reads the real values when it is displayed.' };
}

// ── Liens ────────────────────────────────────────────────────────────────────

export function pageConsoleUrl(pageId: string, edit = false): string {
  return `https://crm.yunoapp.eu/crm/signup-pages/${pageId}${edit ? '/edit' : ''}`;
}

export function pagePublicUrl(slug: string): string {
  return `https://crm.yunoapp.eu/j/${slug}`;
}

export { normalizeCustomDesign, normalizeTheme };
