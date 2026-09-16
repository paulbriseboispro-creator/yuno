/**
 * Le modèle d'ÉDITION du mini-markup inline des blocs texte.
 *
 * `inlineMarkup` (render.ts) transforme les signes en HTML pour l'email. Ici on
 * fait le chemin inverse et retour : une chaîne de markup devient un document
 * « texte + un attribut par caractère », et ce document redevient du markup.
 * C'est ce qui permet à l'éditeur de CACHER les signes (`**`, `[s=14]`, …) tout
 * en montrant leur effet : ce que le pro voit est ce que l'email rendra, et un
 * texte collé avec ses signes s'affiche déjà mis en forme.
 *
 * Deux invariants tiennent tout :
 *
 * 1. **L'analyse est le miroir exact d'`inlineMarkup`** — mêmes expressions,
 *    même ORDRE, et surtout même MÉCANIQUE : des passes successives sur toute
 *    la chaîne, pas une descente récursive. C'est ce qui fait que `***x***`
 *    donne « gras + italique » ici comme à l'envoi, et que `*a **b** c*` met
 *    bien `b` en gras DANS un passage italique.
 * 2. **On ne sérialise jamais du markup qui se relirait autrement.** Les signes
 *    markdown (`**`, `*`, `~~`, `__`) ne se composent pas : `**a *b***` n'est
 *    lisible par personne. L'éditeur écrit donc la forme à crochets
 *    (`[b] [i] [u] [k]`), qui s'imbrique proprement et que l'email comprend
 *    exactement pareil. Les signes markdown restent LUS (brouillons existants,
 *    copier-coller), ils ne sont simplement plus écrits.
 */

/** Mise en forme portée par UN caractère. */
export interface MarkupAttr {
  /** Gras. */
  b?: boolean;
  /** Italique. */
  i?: boolean;
  /** Barré. */
  s?: boolean;
  /** Souligné. */
  u?: boolean;
  /** `accent` (couleur du thème) ou `#rrggbb`. */
  color?: string;
  /** Taille en px, bornée comme dans `inlineMarkup` (10 → 40). */
  size?: number;
  /** Lien (`[url=…]…[/url]`). */
  href?: string;
}

/** Texte brut + un attribut par caractère (indices alignés sur `text`). */
export interface MarkupDoc {
  text: string;
  attrs: MarkupAttr[];
}

/** Les quatre mises en forme qui s'allument et s'éteignent d'un bouton. */
export type MarkupToggle = 'b' | 'i' | 's' | 'u';

/** Bornes de `[s=…]`, identiques à `inlineMarkup`. */
export const MARKUP_SIZE_MIN = 10;
export const MARKUP_SIZE_MAX = 40;

export const clampMarkupSize = (n: number): number =>
  Math.max(MARKUP_SIZE_MIN, Math.min(MARKUP_SIZE_MAX, Math.round(n) || MARKUP_SIZE_MIN));

/** Deux caractères appartiennent au même passage quand tout leur style est égal. */
export function sameAttr(a: MarkupAttr, b: MarkupAttr): boolean {
  return !!a.b === !!b.b && !!a.i === !!b.i && !!a.s === !!b.s && !!a.u === !!b.u
    && (a.color || '') === (b.color || '')
    && (a.size || 0) === (b.size || 0)
    && (a.href || '') === (b.href || '');
}

/** Attribut nettoyé : pas de clé fantôme, pour que `sameAttr` et les tests collent. */
export function normalizeAttr(a: MarkupAttr | undefined): MarkupAttr {
  const out: MarkupAttr = {};
  if (!a) return out;
  if (a.b) out.b = true;
  if (a.i) out.i = true;
  if (a.s) out.s = true;
  if (a.u) out.u = true;
  if (a.color) out.color = a.color;
  if (a.size) out.size = clampMarkupSize(a.size);
  if (a.href) out.href = a.href;
  return out;
}

const normColor = (c: string): string => c.trim().toLowerCase();

interface Rule {
  re: RegExp;
  /** Numéro du groupe qui porte le contenu. */
  inner: number;
  /** Délimiteur de fin, littéral : il donne les bornes exactes du contenu. */
  close: string;
  apply: (a: MarkupAttr, m: RegExpExecArray) => MarkupAttr;
}

/**
 * Les règles, dans l'ordre EXACT des passes d'`inlineMarkup`. L'ordre n'est pas
 * cosmétique : c'est lui qui décide, quand deux signes se chevauchent, lequel
 * est lu en premier — donc ce que l'email affichera.
 */
const RULES: Rule[] = [
  {
    re: /\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/i,
    inner: 2,
    close: '[/url]',
    apply: (a, m) => ({ ...a, href: m[1].trim() }),
  },
  {
    re: /\[c=(accent|#[0-9a-fA-F]{3,8})\]([\s\S]*?)\[\/c\]/i,
    inner: 2,
    close: '[/c]',
    apply: (a, m) => ({ ...a, color: normColor(m[1]) }),
  },
  {
    re: /\[s=(\d{1,3})\]([\s\S]*?)\[\/s\]/i,
    inner: 2,
    close: '[/s]',
    apply: (a, m) => ({ ...a, size: clampMarkupSize(Number(m[1])) }),
  },
  { re: /\[b\]([\s\S]*?)\[\/b\]/i, inner: 1, close: '[/b]', apply: (a) => ({ ...a, b: true }) },
  { re: /\[i\]([\s\S]*?)\[\/i\]/i, inner: 1, close: '[/i]', apply: (a) => ({ ...a, i: true }) },
  { re: /\[u\]([\s\S]*?)\[\/u\]/i, inner: 1, close: '[/u]', apply: (a) => ({ ...a, u: true }) },
  { re: /\[k\]([\s\S]*?)\[\/k\]/i, inner: 1, close: '[/k]', apply: (a) => ({ ...a, s: true }) },
  { re: /\*\*([^*]+)\*\*/, inner: 1, close: '**', apply: (a) => ({ ...a, b: true }) },
  { re: /~~([^~]+)~~/, inner: 1, close: '~~', apply: (a) => ({ ...a, s: true }) },
  { re: /__([^_]+)__/, inner: 1, close: '__', apply: (a) => ({ ...a, u: true }) },
  { re: /\*([^*\n]+)\*/, inner: 1, close: '*', apply: (a) => ({ ...a, i: true }) },
];

/** Garde-fou : un corps de texte n'a jamais des milliers de passages formatés. */
const MAX_PASSES = 4000;

/**
 * Markup → document.
 *
 * Une passe par règle, comme `inlineMarkup` : à chaque match on marque le
 * contenu et on RETIRE les délimiteurs, exactement comme le rendu les remplace
 * par des balises (qui, elles non plus, ne contiennent aucun signe de markup).
 * Ce qui ne matche rien reste du texte, signes compris.
 */
export function parseMarkup(src: string): MarkupDoc {
  // Découpage en unités UTF-16 (pas en points de code) : c'est l'unité des
  // index de `RegExp` ET celle des décalages de sélection du DOM. Un emoji
  // compte donc pour deux cases, avec le même attribut — invisible à l'usage,
  // mais l'éditeur et le modèle parlent la même arithmétique.
  const chars = String(src ?? '').split('');
  const attrs: MarkupAttr[] = chars.map(() => ({}));

  for (const rule of RULES) {
    for (let guard = 0; guard < MAX_PASSES; guard++) {
      const m = rule.re.exec(chars.join(''));
      if (!m) break;
      const innerLen = m[rule.inner].length;
      const innerStart = m.index + (m[0].length - rule.close.length - innerLen);
      const innerEnd = innerStart + innerLen;
      const end = m.index + m[0].length;
      for (let i = innerStart; i < innerEnd; i++) attrs[i] = normalizeAttr(rule.apply(attrs[i], m));
      // Fin d'abord : retirer le début décalerait les indices de la fin.
      chars.splice(innerEnd, end - innerEnd);
      attrs.splice(innerEnd, end - innerEnd);
      chars.splice(m.index, innerStart - m.index);
      attrs.splice(m.index, innerStart - m.index);
    }
  }

  return { text: chars.join(''), attrs };
}

// ── Sérialisation ────────────────────────────────────────────────────────────

/** Qui enveloppe qui. L'ordre décide de l'imbrication, jamais du résultat visuel. */
const PRIORITY: (keyof MarkupAttr)[] = ['href', 'color', 'size', 'b', 'i', 'u', 's'];

const OPEN: Record<string, (v: string | number | boolean) => string> = {
  href: (v) => `[url=${v}]`,
  color: (v) => `[c=${v}]`,
  size: (v) => `[s=${v}]`,
  b: () => '[b]',
  i: () => '[i]',
  u: () => '[u]',
  s: () => '[k]',
};

const CLOSE: Record<string, string> = {
  href: '[/url]', color: '[/c]', size: '[/s]', b: '[/b]', i: '[/i]', u: '[/u]', s: '[/k]',
};

/** Une mise en forme est écrivable si sa valeur est exprimable dans le markup. */
function usable(attr: MarkupAttr, key: keyof MarkupAttr): boolean {
  const v = attr[key];
  if (v === undefined || v === false || v === '' || v === 0) return false;
  if (key === 'href') return !String(v).includes(']');
  if (key === 'color') return /^(accent|#[0-9a-fA-F]{3,8})$/.test(String(v));
  if (key === 'size') return Number(v) >= MARKUP_SIZE_MIN && Number(v) <= MARKUP_SIZE_MAX;
  return true;
}

function emitRange(doc: MarkupDoc, from: number, to: number, applied: Set<string>): string {
  let out = '';
  let i = from;
  const open = (idx: number) =>
    PRIORITY.find((k) => !applied.has(k) && usable(doc.attrs[idx] || {}, k));

  while (i < to) {
    const key = open(i);
    if (!key) {
      let j = i;
      while (j < to && !open(j)) j++;
      out += doc.text.slice(i, j);
      i = j;
      continue;
    }
    const value = (doc.attrs[i] || {})[key];
    let j = i;
    while (j < to && (doc.attrs[j] || {})[key] === value) j++;
    const inner = emitRange(doc, i, j, new Set([...applied, key]));
    // Le texte porte déjà la balise fermante : l'envelopper la couperait en deux.
    out += doc.text.slice(i, j).includes(CLOSE[key])
      ? inner
      : OPEN[key](value as string | number | boolean) + inner + CLOSE[key];
    i = j;
  }
  return out;
}

/**
 * Document → markup. Chaque ligne est close sur elle-même : le rendu découpe
 * les paragraphes AVANT d'appliquer le markup, une balise à cheval sur un saut
 * de ligne s'afficherait donc en clair dans l'email.
 */
export function serializeMarkup(doc: MarkupDoc): string {
  const lines: string[] = [];
  let start = 0;
  for (let i = 0; i <= doc.text.length; i++) {
    if (i === doc.text.length || doc.text[i] === '\n') {
      lines.push(emitRange(doc, start, i, new Set()));
      start = i + 1;
    }
  }
  return lines.join('\n');
}

// ── Manipulations de document (barre de mise en forme) ───────────────────────

const clampRange = (doc: MarkupDoc, start: number, end: number): [number, number] => {
  const n = doc.text.length;
  const a = Math.max(0, Math.min(n, Math.min(start, end)));
  const b = Math.max(0, Math.min(n, Math.max(start, end)));
  return [a, b];
};

/** Applique une propriété sur une plage ; `undefined` ou `false` la retire. */
export function patchRange(
  doc: MarkupDoc,
  start: number,
  end: number,
  patch: Partial<MarkupAttr>,
): MarkupDoc {
  const [a, b] = clampRange(doc, start, end);
  const attrs = doc.attrs.slice();
  for (let i = a; i < b; i++) {
    const next: MarkupAttr = { ...(attrs[i] || {}), ...patch };
    for (const k of Object.keys(patch) as (keyof MarkupAttr)[]) {
      if (patch[k] === undefined || patch[k] === false) delete next[k];
    }
    attrs[i] = normalizeAttr(next);
  }
  return { text: doc.text, attrs };
}

/** true quand TOUTE la plage porte déjà cette propriété (sinon le clic l'ajoute). */
export function rangeHas(
  doc: MarkupDoc,
  start: number,
  end: number,
  key: keyof MarkupAttr,
  value?: string | number,
): boolean {
  const [a, b] = clampRange(doc, start, end);
  if (b <= a) return false;
  let seen = 0;
  for (let i = a; i < b; i++) {
    if (doc.text[i] === '\n') continue;
    seen++;
    const v = (doc.attrs[i] || {})[key];
    if (value === undefined ? !v : v !== value) return false;
  }
  return seen > 0;
}

/** Retire toute mise en forme d'une plage. */
export function clearRange(doc: MarkupDoc, start: number, end: number): MarkupDoc {
  const [a, b] = clampRange(doc, start, end);
  const attrs = doc.attrs.slice();
  for (let i = a; i < b; i++) attrs[i] = {};
  return { text: doc.text, attrs };
}

/** Remplace une plage par du texte portant un attribut donné. */
export function replaceRange(
  doc: MarkupDoc,
  start: number,
  end: number,
  text: string,
  attr: MarkupAttr = {},
): MarkupDoc {
  return replaceRangeWithDoc(doc, start, end, {
    text,
    attrs: Array.from({ length: text.length }, () => normalizeAttr(attr)),
  });
}

/** Remplace une plage par un document entier (collage d'un texte déjà formaté). */
export function replaceRangeWithDoc(doc: MarkupDoc, start: number, end: number, insert: MarkupDoc): MarkupDoc {
  const [a, b] = clampRange(doc, start, end);
  return {
    text: doc.text.slice(0, a) + insert.text + doc.text.slice(b),
    attrs: [
      ...doc.attrs.slice(0, a).map(normalizeAttr),
      ...insert.attrs.map(normalizeAttr),
      ...doc.attrs.slice(b).map(normalizeAttr),
    ],
  };
}

/** Attribut « courant » d'une position — celui du caractère qui précède le curseur. */
export function attrAt(doc: MarkupDoc, pos: number): MarkupAttr {
  if (!doc.attrs.length) return {};
  const i = Math.max(0, Math.min(doc.attrs.length - 1, pos - 1));
  return normalizeAttr(doc.attrs[i]);
}
