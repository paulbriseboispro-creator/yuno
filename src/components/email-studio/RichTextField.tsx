import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { ClipboardEvent, CSSProperties, KeyboardEvent } from 'react';
import type { MarkupAttr, MarkupDoc, MarkupToggle } from '@/lib/email';
import {
  attrAt, clampMarkupSize, clearRange, contrastRatio, escapeHtml, isHexColor, normalizeAttr,
  parseMarkup, patchRange, rangeHas, replaceRange, replaceRangeWithDoc, sameAttr, serializeMarkup,
} from '@/lib/email';

/**
 * Le champ de saisie des blocs texte : on y voit la MISE EN FORME, jamais les
 * signes qui la portent.
 *
 * Avant, c'était un textarea : mettre un mot en gras y écrivait `**mot**` sous
 * les yeux du pro, et un texte collé depuis ailleurs arrivait constellé de
 * `[s=14]` illisibles. Le modèle de données n'a pas bougé pour autant — le bloc
 * stocke toujours du texte brut + le mini-markup de `inlineMarkup` (markup.ts
 * fait la conversion dans les deux sens). Ce qui change, c'est que l'écran
 * montre le résultat au lieu de la recette.
 *
 * Trois règles de fonctionnement :
 *
 * 1. **Le markup reste la source de vérité.** Chaque frappe est relue en
 *    document, re-sérialisée, et c'est cette chaîne qui remonte au bloc. Aucun
 *    HTML saisi par le pro n'entre jamais dans le modèle (c'est l'invariant qui
 *    protège l'email : `inlineMarkup` échappe avant de mettre en forme).
 * 2. **Pendant la frappe on ne redessine PAS.** Réécrire le HTML à chaque
 *    caractère replacerait le curseur en boucle. Le DOM fait foi jusqu'à la
 *    prochaine action de la barre d'outils, qui renormalise tout.
 * 3. **Le collage garde la mise en forme, et on peut la refuser.** Un contenu
 *    copié ailleurs (page web, doc, autre email) arrive avec son gras, ses
 *    couleurs, ses tailles et ses liens : le HTML du presse-papier est relu
 *    par le MÊME analyseur que le champ, puis re-sérialisé en markup — rien
 *    d'autre n'entre dans le modèle. Un texte collé avec ses signes
 *    (`**gras**`, `[c=accent]…[/c]`) arrive lui aussi déjà mis en forme,
 *    signes cachés. Et « coller en texte brut » reste à un geste :
 *    ⇧⌘V (le presse-papier ne livre alors que du texte), ou le bouton qui
 *    apparaît sous le champ juste après un collage.
 */

export interface RichTextHandle {
  toggle(mark: MarkupToggle): void;
  applyColor(color: string): void;
  applySize(size: number): void;
  applyLink(url: string): void;
  clearFormat(): void;
}

interface Props {
  /** Markup du bloc (source de vérité). */
  value: string;
  onChange: (markup: string) => void;
  /** Accent du thème : la couleur réelle derrière `[c=accent]` et les liens. */
  accent: string;
  /**
   * Fond du bloc dans l'email, et encre par défaut de ce bloc. Le champ se
   * peint avec : un texte noir se lit sur le blanc de l'email, pas sur le noir
   * du panneau — et un texte invisible dans l'email l'est aussi ici.
   */
  background?: string;
  ink?: string;
  /** Mot posé quand on clique un style sans rien avoir sélectionné. */
  placeholder: string;
  ariaLabel?: string;
  style?: CSSProperties;
  /** Libellés du rappel « mise en forme collée » (sans eux, pas de rappel). */
  pasteKeptLabel?: string;
  pastePlainLabel?: string;
  /** Libellés de l'alerte « cette couleur ne se lit pas sur ce fond ». */
  unreadableLabel?: string;
  unreadableFixLabel?: string;
}

// ── Document → HTML de l'éditeur ─────────────────────────────────────────────

/** Couleur effective d'un passage (l'accent du thème est résolu à l'affichage). */
const colorOf = (a: MarkupAttr, accent: string): string | undefined => {
  if (a.color) return a.color === 'accent' ? accent : a.color;
  return a.href ? accent : undefined;
};

function runHtml(text: string, a: MarkupAttr, accent: string): string {
  const body = escapeHtml(text);
  if (!a.b && !a.i && !a.s && !a.u && !a.color && !a.size && !a.href) return body;

  const css: string[] = [];
  if (a.b) css.push('font-weight:700');
  if (a.i) css.push('font-style:italic');
  const deco: string[] = [];
  if (a.u || a.href) deco.push('underline');
  if (a.s) deco.push('line-through');
  if (deco.length) css.push(`text-decoration:${deco.join(' ')}`);
  const color = colorOf(a, accent);
  if (color) css.push(`color:${color}`);
  if (a.size) css.push(`font-size:${a.size}px`);

  // Les data-* portent le SENS, le style ne porte que l'apparence : c'est par
  // elles qu'on relit le document sans dépendre de ce que le navigateur a fait
  // de nos couleurs (`rgb(…)`) ni de son propre balisage.
  const data = [
    a.b ? ' data-b="1"' : '',
    a.i ? ' data-i="1"' : '',
    a.u ? ' data-u="1"' : '',
    a.s ? ' data-k="1"' : '',
    a.color ? ` data-color="${escapeHtml(a.color)}"` : '',
    a.size ? ` data-size="${a.size}"` : '',
    a.href ? ` data-href="${escapeHtml(a.href)}" title="${escapeHtml(a.href)}"` : '',
    // Couleur héritée du lien : elle ne doit pas se figer en couleur choisie.
    !a.color && a.href ? ' data-autocolor="1"' : '',
  ].join('');

  return `<span${data} style="${css.join(';')}">${body}</span>`;
}

export function docToHtml(doc: MarkupDoc, accent: string): string {
  const lines: string[] = [];
  let from = 0;
  for (let i = 0; i <= doc.text.length; i++) {
    if (i !== doc.text.length && doc.text[i] !== '\n') continue;
    let html = '';
    let j = from;
    while (j < i) {
      const a = normalizeAttr(doc.attrs[j]);
      let k = j;
      while (k < i && sameAttr(normalizeAttr(doc.attrs[k]), a)) k++;
      html += runHtml(doc.text.slice(j, k), a, accent);
      j = k;
    }
    lines.push(`<div>${html || '<br>'}</div>`);
    from = i + 1;
  }
  return lines.join('');
}

// ── HTML de l'éditeur → document ─────────────────────────────────────────────

interface Segment {
  node: Node;
  start: number;
  len: number;
  /** Ligne vide : le curseur se pose DANS l'élément, pas dans un nœud texte. */
  element?: boolean;
}

interface ScanResult {
  doc: MarkupDoc;
  sel: { start: number; end: number } | null;
  segs: Segment[];
}

const BLOCK_TAGS = new Set([
  'DIV', 'P', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'SECTION', 'ARTICLE',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TABLE', 'TR',
]);

/** `rgb(233, 25, 44)` → `#e9192c`. Ce que rendent les navigateurs pour `style.color`. */
function cssColorToHex(css: string): string | undefined {
  const v = css.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(v)) return `#${v.slice(1).split('').map((c) => c + c).join('')}`.toLowerCase();
  const m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(v);
  if (!m) return undefined;
  return `#${[1, 2, 3].map((i) => Number(m[i]).toString(16).padStart(2, '0')).join('')}`;
}

/** Ce que vaut un titre collé, faute de taille explicite (borné 10 → 40 px). */
const HEADING_SIZE: Record<string, number> = { H1: 30, H2: 26, H3: 22, H4: 20, H5: 18, H6: 16 };

/** Style d'un élément → attribut, en préférant toujours nos propres data-*. */
function attrOf(el: HTMLElement, base: MarkupAttr): MarkupAttr {
  const a: MarkupAttr = { ...base };
  const tag = el.tagName;
  const d = el.dataset;
  const st = el.style;

  if (tag === 'B' || tag === 'STRONG' || d.b) a.b = true;
  if (tag === 'I' || tag === 'EM' || d.i) a.i = true;
  if (tag === 'U' || d.u) a.u = true;
  if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL' || d.k) a.s = true;

  // Un style explicite peut aussi ÉTEINDRE : Google Docs enveloppe tout son
  // presse-papier dans un `<b style="font-weight:normal">`, et sans ce retour
  // en arrière le document entier arrivait en gras.
  const weight = st.fontWeight;
  const numWeight = Number(weight);
  if (weight === 'bold' || weight === 'bolder' || numWeight >= 600) a.b = true;
  else if (weight === 'normal' || weight === 'lighter' || (numWeight && numWeight < 600)) a.b = false;
  if (st.fontStyle === 'italic') a.i = true;
  else if (st.fontStyle === 'normal') a.i = false;
  const deco = `${st.textDecorationLine || ''} ${st.textDecoration || ''}`;
  if (deco.includes('underline')) a.u = true;
  if (deco.includes('line-through')) a.s = true;

  if (d.href) a.href = d.href;
  else if (tag === 'A' && el.getAttribute('href')) a.href = el.getAttribute('href') || undefined;

  if (d.color) a.color = d.color;
  else if (!d.autocolor && st.color) {
    const hex = cssColorToHex(st.color);
    if (hex) a.color = hex;
  }

  if (d.size) a.size = clampMarkupSize(Number(d.size));
  else if (/px$/.test(st.fontSize)) a.size = clampMarkupSize(parseFloat(st.fontSize));
  // Word et Google Docs mesurent en points ; l'email, lui, ne connaît que le px.
  else if (/pt$/.test(st.fontSize)) a.size = clampMarkupSize(parseFloat(st.fontSize) * (4 / 3));
  else if (HEADING_SIZE[tag]) a.size = clampMarkupSize(HEADING_SIZE[tag]);

  // Un titre collé reste un titre : gras, et plus gros que le corps du texte.
  if (HEADING_SIZE[tag]) a.b = true;

  return normalizeAttr(a);
}

/**
 * Lit le contenu éditable : texte, mise en forme, position du curseur, et la
 * carte des nœuds qui permettra de replacer ce curseur après un redessin.
 */
function scan(root: HTMLElement, withSelection: boolean): ScanResult {
  const chars: string[] = [];
  const attrs: MarkupAttr[] = [];
  const segs: Segment[] = [];

  const domSel = withSelection && typeof window !== 'undefined' ? window.getSelection() : null;
  const inside = (n: Node | null | undefined) => !!n && (n === root || root.contains(n));
  const track = !!domSel && domSel.rangeCount > 0 && inside(domSel.anchorNode) && inside(domSel.focusNode);
  let anchor: number | null = null;
  let focus: number | null = null;

  const markTextPoint = (node: Node, base: number, len: number) => {
    if (!track || !domSel) return;
    if (domSel.anchorNode === node) anchor = base + Math.min(domSel.anchorOffset, len);
    if (domSel.focusNode === node) focus = base + Math.min(domSel.focusOffset, len);
  };
  const markElementPoint = (el: Node, index: number) => {
    if (!track || !domSel) return;
    if (domSel.anchorNode === el && domSel.anchorOffset === index) anchor = chars.length;
    if (domSel.focusNode === el && domSel.focusOffset === index) focus = chars.length;
  };

  /**
   * Un saut vient d'être posé : le bloc qui suit ne doit pas en reposer un.
   * Sans ce drapeau, `a<br><div>b</div>` inventerait une ligne vide.
   */
  let justBroke = false;
  const newline = () => { chars.push('\n'); attrs.push({}); justBroke = true; };

  const walkChildren = (el: HTMLElement, a: MarkupAttr) => {
    const kids = Array.from(el.childNodes);
    for (let i = 0; i < kids.length; i++) {
      markElementPoint(el, i);
      walk(kids[i], a);
    }
    markElementPoint(el, kids.length);
  };

  const walk = (node: Node, a: MarkupAttr) => {
    if (node.nodeType === Node.TEXT_NODE) {
      // Le navigateur pose des espaces insécables dès qu'on tape deux espaces ;
      // pour l'email ce sont des espaces ordinaires.
      const raw = (node.nodeValue || '').replace(/\u00a0/g, ' ');
      markTextPoint(node, chars.length, raw.length);
      segs.push({ node, start: chars.length, len: raw.length });
      for (let i = 0; i < raw.length; i++) { chars.push(raw[i]); attrs.push(a); }
      if (raw.length) justBroke = false;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;

    if (el.tagName === 'BR') {
      // Un <br> en fin de bloc n'est qu'un témoin de ligne vide, pas un saut.
      if (el.nextSibling) newline();
      return;
    }

    const block = BLOCK_TAGS.has(el.tagName);
    if (block) {
      // Un saut AVANT chaque bloc, sauf le premier. Tester « le dernier
      // caractère est déjà un saut » avalait les lignes vides : dans
      // `<div>a</div><div><br></div><div>c</div>`, le bloc vide et le suivant
      // partageaient le même saut et la ligne vide disparaissait de l'email.
      if (chars.length && !justBroke) newline();
      justBroke = false;
    }
    const before = chars.length;
    walkChildren(el, attrOf(el, a));
    if (block && chars.length === before) segs.push({ node: el, start: before, len: 0, element: true });
  };

  walkChildren(root, {});

  const sel = track && anchor !== null && focus !== null
    ? { start: Math.min(anchor, focus), end: Math.max(anchor, focus) }
    : null;

  return { doc: { text: chars.join(''), attrs }, sel, segs };
}

/** Repose le curseur (ou la sélection) sur des décalages de texte. */
function setSelection(root: HTMLElement, start: number, end: number) {
  const { segs } = scan(root, false);
  const locate = (offset: number): { node: Node; offset: number } => {
    for (const seg of segs) {
      if (offset >= seg.start && offset <= seg.start + seg.len) {
        return seg.element ? { node: seg.node, offset: 0 } : { node: seg.node, offset: offset - seg.start };
      }
    }
    const last = segs[segs.length - 1];
    if (!last) return { node: root, offset: 0 };
    return last.element ? { node: last.node, offset: 0 } : { node: last.node, offset: last.len };
  };
  const a = locate(start);
  const b = locate(end);
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  try {
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
  } catch {
    return;
  }
  sel.removeAllRanges();
  sel.addRange(range);
}

// ── HTML du presse-papier → document ─────────────────────────────────────────

/**
 * Ce dont le texte ne doit JAMAIS entrer dans un bloc email : une feuille de
 * style copiée avec la page arriverait sinon en clair dans la campagne.
 */
const CLIPBOARD_DROP = 'script,style,noscript,template,head,meta,link,title,iframe,object,embed,svg,img,video,audio,canvas,input,select,textarea';

/**
 * Presse-papier HTML → document, par le MÊME analyseur que le champ.
 *
 * Le HTML est lu hors du document vivant (`DOMParser` n'exécute rien et ne
 * charge rien) : on n'en extrait que du texte et de la mise en forme, jamais
 * du balisage. C'est l'invariant du Studio — le bloc ne stocke que du markup,
 * l'email n'affiche jamais du HTML écrit par quelqu'un d'autre.
 */
function htmlToDoc(html: string, bg?: string): MarkupDoc | null {
  if (typeof DOMParser === 'undefined') return null;
  let body: HTMLElement | null = null;
  try {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    body = parsed.body;
    if (!body) return null;
    body.querySelectorAll(CLIPBOARD_DROP).forEach((n) => n.remove());
    collapseSourceWhitespace(parsed, body);
  } catch {
    return null;
  }
  return dropUnreadableInk(tidyPastedDoc(scan(body, false).doc), bg);
}

/**
 * Une couleur importée qui ne se lit pas sur le fond du bloc est JETÉE, pas
 * collée : copier depuis une page sombre posait sinon du texte blanc sur le
 * blanc de l'email — présent dans le modèle, invisible chez le client. Sans
 * couleur, le passage retombe sur l'encre par défaut du bloc, qui elle suit le
 * fond.
 */
function dropUnreadableInk(doc: MarkupDoc, bg?: string): MarkupDoc {
  if (!bg || !isHexColor(bg)) return doc;
  return {
    text: doc.text,
    attrs: doc.attrs.map((a) => {
      const c = a?.color && isHexColor(a.color) ? a.color.trim() : null;
      if (!c || !unreadableOn(c, bg)) return a;
      const { color: _drop, ...rest } = a;
      return rest;
    }),
  };
}

/**
 * Les retours à la ligne et l'indentation du code source ne sont pas du texte :
 * le navigateur les replie à l'affichage, l'analyseur les prendrait au mot et
 * la campagne hériterait de l'indentation de la page copiée.
 */
function collapseSourceWhitespace(doc: Document, root: HTMLElement) {
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);

  const isBlock = (n: Node | null) =>
    !n || (n.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((n as HTMLElement).tagName));

  for (const node of nodes) {
    if (node.parentElement?.closest('pre')) continue;
    const collapsed = (node.nodeValue || '').replace(/[\t\n\r ]+/g, ' ');
    // Un blanc collé à un bloc n'est qu'une mise en page du source.
    if (!collapsed.trim() && (isBlock(node.previousSibling) || isBlock(node.nextSibling))) {
      node.remove();
      continue;
    }
    node.nodeValue = collapsed;
  }
}

/**
 * Ménage d'un collage : espaces de bord, lignes vides en tête et en queue, et
 * jamais deux lignes vides de suite. Une page web copiée en apporte des
 * dizaines, qui deviendraient autant de paragraphes vides dans l'email.
 */
function tidyPastedDoc(doc: MarkupDoc): MarkupDoc {
  const lines: { text: string; attrs: MarkupAttr[] }[] = [];
  let from = 0;
  for (let i = 0; i <= doc.text.length; i++) {
    if (i !== doc.text.length && doc.text[i] !== '\n') continue;
    let a = from;
    let b = i;
    while (a < b && doc.text[a] === ' ') a++;
    while (b > a && doc.text[b - 1] === ' ') b--;
    lines.push({ text: doc.text.slice(a, b), attrs: doc.attrs.slice(a, b) });
    from = i + 1;
  }
  while (lines.length && !lines[0].text) lines.shift();
  while (lines.length && !lines[lines.length - 1].text) lines.pop();

  const text: string[] = [];
  const attrs: MarkupAttr[] = [];
  let blank = false;
  for (const line of lines) {
    if (!line.text && blank) continue;
    blank = !line.text;
    if (text.length) { text.push('\n'); attrs.push({}); }
    for (let i = 0; i < line.text.length; i++) { text.push(line.text[i]); attrs.push(normalizeAttr(line.attrs[i])); }
  }
  return { text: text.join(''), attrs };
}

/** La couleur RÉELLE d'un passage (`accent` résolu), ou rien. */
function inkOf(attr: MarkupAttr | undefined, accent: string): string | null {
  const c = attr?.color === 'accent' ? accent : attr?.color;
  return c && isHexColor(c) ? c.trim() : null;
}

/**
 * Une couleur ne se lit pas sur un fond quand leur contraste tombe sous 2:1 —
 * du blanc sur blanc, du noir sur noir. En dessous, ce n'est plus une nuance,
 * c'est du texte perdu.
 */
const READABLE_MIN = 2;
const unreadableOn = (color: string, bg: string) =>
  isHexColor(bg) && contrastRatio(color, bg) < READABLE_MIN;

// ── Le champ ─────────────────────────────────────────────────────────────────

const RichTextField = forwardRef<RichTextHandle, Props>(function RichTextField(
  {
    value, onChange, accent, background, ink, placeholder, ariaLabel, style,
    pasteKeptLabel, pastePlainLabel, unreadableLabel, unreadableFixLabel,
  }, handleRef,
) {
  const boxRef = useRef<HTMLDivElement>(null);
  /** Dernier markup connu — ce qui distingue « je viens de l'écrire » de « on me l'impose ». */
  const known = useRef<string | null>(null);
  const shownAccent = useRef(accent);
  /** Dernier collage avec mise en forme — ce qui rend « texte brut » rejouable. */
  const [pasted, setPasted] = useState<{ start: number; end: number; plain: string } | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  /** Redessine à partir du markup, puis repose le curseur. */
  const paint = useCallback((markup: string, selStart?: number, selEnd?: number) => {
    const el = boxRef.current;
    if (!el) return;
    // On redessine le markup SÉRIALISÉ, pas le document en mémoire : l'écran
    // montre alors ce que l'email rendra, y compris quand le markup ne sait pas
    // écrire une combinaison (une étoile dans un passage en gras, par exemple).
    const doc = parseMarkup(markup);
    el.innerHTML = docToHtml(doc, accent);
    known.current = markup;
    shownAccent.current = accent;
    if (selStart !== undefined) {
      const max = doc.text.length;
      setSelection(el, Math.min(selStart, max), Math.min(selEnd ?? selStart, max));
    }
  }, [accent]);

  // Valeur imposée de l'extérieur (ouverture du bloc, undo, changement de
  // thème) : on redessine. Une valeur qu'on vient d'émettre, non — le DOM est
  // déjà à jour et le curseur est dedans.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    if (value === known.current && accent === shownAccent.current) return;
    // Le curseur est repris tel quel (borné à la nouvelle longueur) : c'est ce
    // qui rend ⌘Z utilisable en pleine frappe — sans lui, chaque annulation
    // renvoyait le curseur au début du bloc.
    const sel = scan(el, true).sel;
    paint(value, sel?.start, sel?.end);
    setPasted(null);
  }, [value, accent, paint]);

  /** Frappe ordinaire : on relit le DOM et on remonte le markup, sans redessiner. */
  const readOut = useCallback(() => {
    const el = boxRef.current;
    if (!el) return;
    const markup = serializeMarkup(scan(el, false).doc);
    known.current = markup;
    // La frappe déplace les décalages : le rappel de collage ne vise plus rien.
    setPasted(null);
    onChangeRef.current(markup);
  }, []);

  /** Action de la barre d'outils : modèle → markup → redessin → curseur. */
  const mutate = useCallback((
    fn: (doc: MarkupDoc, start: number, end: number) => { doc: MarkupDoc; start: number; end: number } | null,
  ) => {
    const el = boxRef.current;
    if (!el) return;
    el.focus();
    const { doc, sel } = scan(el, true);
    const start = sel ? sel.start : doc.text.length;
    const end = sel ? sel.end : doc.text.length;
    const next = fn(doc, start, end);
    if (!next) return;
    const markup = serializeMarkup(next.doc);
    paint(markup, next.start, next.end);
    onChangeRef.current(markup);
  }, [paint]);

  /**
   * Un style cliqué sans sélection pose un mot d'exemple déjà mis en forme :
   * sinon le clic n'aurait aucun effet visible et le pro croirait à une panne.
   */
  const applyToSelection = useCallback((patch: Partial<MarkupAttr>) => {
    mutate((doc, start, end) => {
      if (start === end) {
        const attr = normalizeAttr({ ...attrAt(doc, start), ...patch } as MarkupAttr);
        return { doc: replaceRange(doc, start, end, placeholder, attr), start, end: start + placeholder.length };
      }
      return { doc: patchRange(doc, start, end, patch), start, end };
    });
  }, [mutate, placeholder]);

  useImperativeHandle(handleRef, (): RichTextHandle => ({
    toggle: (mark) => {
      const el = boxRef.current;
      if (!el) return;
      const { doc, sel } = scan(el, true);
      const on = sel && sel.end > sel.start ? !rangeHas(doc, sel.start, sel.end, mark) : true;
      applyToSelection({ [mark]: on } as Partial<MarkupAttr>);
    },
    applyColor: (color) => {
      const el = boxRef.current;
      if (!el) return;
      const { doc, sel } = scan(el, true);
      // Recliquer la couleur déjà posée l'enlève : c'est la porte de sortie
      // quand on s'est trompé, sans avoir à retrouver des signes cachés.
      const already = !!sel && sel.end > sel.start && rangeHas(doc, sel.start, sel.end, 'color', color);
      applyToSelection({ color: already ? undefined : color });
    },
    applySize: (size) => {
      const el = boxRef.current;
      if (!el) return;
      const px = clampMarkupSize(size);
      const { doc, sel } = scan(el, true);
      const already = !!sel && sel.end > sel.start && rangeHas(doc, sel.start, sel.end, 'size', px);
      applyToSelection({ size: already ? undefined : px });
    },
    applyLink: (url) => applyToSelection({ href: url }),
    clearFormat: () => mutate((doc, start, end) => (
      start === end ? null : { doc: clearRange(doc, start, end), start, end }
    )),
  }), [applyToSelection, mutate]);

  /**
   * Collage. Le HTML du presse-papier est relu par notre propre analyseur :
   * gras, couleurs, tailles, liens et paragraphes arrivent posés, et rien
   * d'autre que du markup n'entre dans le bloc. À défaut de HTML — « coller
   * et adapter le style » (⇧⌘V) ne livre que du texte — on retombe sur
   * l'analyseur de markup, qui lit les signes écrits à la main.
   */
  const handlePaste = useCallback((e: ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const plain = (e.clipboardData.getData('text/plain') || '').replace(/\r\n?/g, '\n');
    const html = e.clipboardData.getData('text/html');
    const rich = html ? htmlToDoc(html, background) : null;
    const insert = rich && rich.text ? rich : parseMarkup(plain);
    if (!insert.text) return;
    mutate((doc, start, end) => {
      const caret = start + insert.text.length;
      setPasted(rich && rich.text && plain.trim() ? { start, end: caret, plain } : null);
      return { doc: replaceRangeWithDoc(doc, start, end, insert), start: caret, end: caret };
    });
  }, [mutate, background]);

  /** Le même collage, sans rien garder : la porte de sortie du collage riche. */
  const pasteAsPlainText = useCallback(() => {
    const last = pasted;
    if (!last) return;
    setPasted(null);
    mutate((doc) => {
      const insert = parseMarkup(last.plain);
      const end = Math.min(last.end, doc.text.length);
      const caret = last.start + insert.text.length;
      return { doc: replaceRangeWithDoc(doc, last.start, end, insert), start: caret, end: caret };
    });
  }, [mutate, pasted]);

  /** Raccourcis clavier : on les prend nous-mêmes, sinon le navigateur pose son propre HTML. */
  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    const mark: MarkupToggle | null = e.key === 'b' || e.key === 'B' ? 'b'
      : e.key === 'i' || e.key === 'I' ? 'i'
        : e.key === 'u' || e.key === 'U' ? 'u' : null;
    if (!mark) return;
    e.preventDefault();
    const el = boxRef.current;
    if (!el) return;
    const { doc, sel } = scan(el, true);
    const on = sel && sel.end > sel.start ? !rangeHas(doc, sel.start, sel.end, mark) : true;
    applyToSelection({ [mark]: on } as Partial<MarkupAttr>);
  }, [applyToSelection]);

  /** Des couleurs du texte qui ne se lisent pas sur le fond du bloc ? */
  const hasUnreadableInk = useMemo(() => {
    if (!background || !isHexColor(background)) return false;
    const doc = parseMarkup(value);
    return doc.attrs.some((a, i) => {
      if (doc.text[i] === '\n') return false;
      const c = inkOf(a, accent);
      return !!c && unreadableOn(c, background);
    });
  }, [value, background, accent]);

  /** Retire ces couleurs-là : le passage repart sur l'encre du bloc. */
  const clearUnreadableInk = useCallback(() => {
    if (!background) return;
    mutate((doc, start, end) => ({
      doc: {
        text: doc.text,
        attrs: doc.attrs.map((a) => {
          const c = inkOf(a, accent);
          if (!c || !unreadableOn(c, background)) return a;
          const { color: _drop, ...rest } = a;
          return rest;
        }),
      },
      start,
      end,
    }));
  }, [mutate, background, accent]);

  const showPasteUndo = !!pasted && !!pasteKeptLabel && !!pastePlainLabel;
  const showInkWarning = hasUnreadableInk && !!unreadableLabel && !!unreadableFixLabel;

  return (
    <>
      <div
        ref={boxRef}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        spellCheck
        onInput={readOut}
        onBlur={readOut}
        onPaste={handlePaste}
        onKeyDown={handleKeyDown}
        style={{
          whiteSpace: 'pre-wrap',
          overflowWrap: 'break-word',
          outline: 'none',
          ...style,
          // Le champ porte les couleurs de l'EMAIL, pas celles du panneau :
          // c'est la seule façon de voir qu'un texte noir se lit sur le blanc
          // de la campagne, et qu'un texte blanc n'y existe pas.
          ...(background ? { background, caretColor: ink } : null),
          ...(ink ? { color: ink } : null),
        }}
      />
      {showPasteUndo && (
        <NoticeRow label={pasteKeptLabel!} action={pastePlainLabel!} onAct={pasteAsPlainText} />
      )}
      {showInkWarning && (
        <NoticeRow label={unreadableLabel!} action={unreadableFixLabel!} onAct={clearUnreadableInk} warn />
      )}
    </>
  );
});

/** Une ligne de rappel sous le champ : un constat, un bouton qui le règle. */
function NoticeRow({ label, action, onAct, warn }: {
  label: string; action: string; onAct: () => void; warn?: boolean;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      fontSize: 11, color: warn ? '#FCD34D' : 'rgba(255,255,255,0.45)',
    }}>
      <span>{label}</span>
      <button
        type="button"
        // onMouseDown : un bouton qui prend le focus ferait sortir du champ, et
        // le rappel disparaîtrait avant même d'être cliqué.
        onMouseDown={(e) => { e.preventDefault(); onAct(); }}
        style={{
          padding: '3px 8px', borderRadius: 7, cursor: 'pointer',
          background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.085)',
          color: 'rgba(255,255,255,0.72)', fontSize: 11, fontFamily: 'inherit',
        }}
      >{action}</button>
    </div>
  );
}

export default RichTextField;
