/**
 * Mise en forme des corps d'articles du mode d'emploi.
 *
 * Les textes `ohelp.*` sont de la prose avec des conventions légères :
 * paragraphes séparés par `\n`, étapes « 1. … », puces « • … » / « - … »,
 * chemins de navigation « Dashboard → Événements → Billetterie », libellés
 * d'interface entre guillemets, gras `**…**`. Ce module les lit UNE fois et
 * rend une structure que la page dessine : étapes numérotées, listes,
 * chemins en pastilles enchaînées, libellés mis en avant.
 *
 * Il ne touche jamais aux 2 000 clés : c'est le rendu qui s'améliore, pas le
 * texte. Un texte sans aucune convention reste un simple paragraphe.
 */

export type HelpInline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'label'; text: string }
  | { kind: 'path'; steps: string[] };

export type HelpListItem = { tone?: 'ok' | 'no'; inlines: HelpInline[] };

export type HelpBlock =
  | { kind: 'p'; inlines: HelpInline[] }
  | { kind: 'ol'; items: HelpListItem[] }
  | { kind: 'ul'; items: HelpListItem[] };

const ORDERED = /^\s*(\d{1,2})[.)]\s+(.*)$/;
const BULLET = /^\s*(?:[•\-–*·]|✓|✔)\s+(.*)$/;

// Mots qui ferment un segment de chemin (« Allez dans Dashboard → … » : le
// premier segment est « Dashboard », pas « Allez dans Dashboard »).
const STOP_WORDS = new Set([
  'et', 'and', 'y', 'e', 'puis', 'then', 'luego', 'pour', 'to', 'para', 'ou', 'or', 'o', 'u',
  'dans', 'in', 'en', 'sur', 'on', 'où', 'where', 'donde', 'via', 'depuis', 'from', 'desde',
  'sous', 'under', 'bajo', 'avec', 'with', 'con', 'the', 'le', 'la', 'les', 'el', 'los', 'las',
  'un', 'une', 'a', 'an', 'una', 'de', 'du', 'des', 'of', 'del', 'allez', 'go', 've', 'ouvrez', 'open',
  'abre', 'cliquez', 'click', 'haz', 'tap', 'choisissez', 'choose', 'elige', 'sélectionnez', 'select',
  'selecciona', 'rendez-vous', 'menu', 'page', 'onglet', 'tab', 'pestaña', 'section', 'sección',
  'chemin', 'path', 'ruta', 'depuis', 'à', 'au', 'aux', 'at', 'al',
]);

const MAX_PATH_WORDS = 4;

function isStop(word: string): boolean {
  return STOP_WORDS.has(word.toLowerCase().replace(/[.,;:!?()«»"']/g, ''));
}

/** Découpe un segment textuel en éléments inline (gras, libellés, texte). */
function inlineTokens(text: string): HelpInline[] {
  const out: HelpInline[] = [];
  // Gras **…**, libellés "…" ou « … » (courts : un bouton, un menu — pas une phrase).
  const re = /\*\*([^*]+)\*\*|"([^"\n]{1,48})"|«\s?([^»\n]{1,48})\s?»|“([^”\n]{1,48})”/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ kind: 'text', text: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ kind: 'strong', text: m[1] });
    else out.push({ kind: 'label', text: (m[2] ?? m[3] ?? m[4] ?? '').trim() });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out.filter((t) => t.kind !== 'text' || t.text.length > 0);
}

/**
 * Repère les chaînes « A → B → C » et les isole du texte qui les entoure.
 * Le premier et le dernier segment sont bornés par des mots de liaison
 * (« Allez dans », « et activez »), les segments du milieu sont pris entiers.
 */
function splitPaths(text: string): HelpInline[] {
  if (!text.includes('→')) return inlineTokens(text);
  const out: HelpInline[] = [];
  let cursor = 0;
  const arrowRe = /\s*→\s*/g;
  let m: RegExpExecArray | null;
  // Regroupe les flèches consécutives (≤ 60 caractères entre deux flèches).
  const arrows: Array<{ start: number; end: number }> = [];
  while ((m = arrowRe.exec(text))) arrows.push({ start: m.index, end: m.index + m[0].length });
  let i = 0;
  while (i < arrows.length) {
    let j = i;
    while (j + 1 < arrows.length && arrows[j + 1].start - arrows[j].end <= 60 && !/[\n]/.test(text.slice(arrows[j].end, arrows[j + 1].start))) j++;
    const chain = arrows.slice(i, j + 1);
    // Segment de tête : mots capitalisés (≤ 4) juste avant la première flèche.
    const before = text.slice(cursor, chain[0].start);
    const beforeWords = before.split(/(\s+)/);
    const head: string[] = [];
    for (let k = beforeWords.length - 1; k >= 0 && head.length < MAX_PATH_WORDS; k--) {
      const w = beforeWords[k];
      if (/^\s+$/.test(w) || w === '') continue;
      if (/[.,;:!?(]$/.test(w) && head.length > 0) break;
      if (isStop(w)) break;
      // Un mot en minuscules avant un segment déjà commencé est du récit
      // (« groupe Événements → … » : le chemin commence à « Événements »).
      const bare = w.replace(/^[(«"]+/, '');
      if (head.length > 0 && /^[a-zà-ÿ]/.test(bare)) break;
      if (bare !== w) { head.unshift(bare); break; }
      head.unshift(w);
      if (/^[.,;:!?]/.test(w)) break;
    }
    const headText = head.join(' ').trim();
    const headStart = headText ? before.lastIndexOf(headText) : before.length;
    // Segment de queue : mots (≤ 4) après la dernière flèche, jusqu'à une ponctuation ou un mot de liaison.
    const afterStart = chain[chain.length - 1].end;
    const after = text.slice(afterStart);
    const afterWords = after.split(/(\s+)/);
    const tail: string[] = [];
    let consumed = 0;
    for (let k = 0; k < afterWords.length && tail.length < MAX_PATH_WORDS; k++) {
      const w = afterWords[k];
      if (w === '') continue;
      if (/^\s+$/.test(w)) { if (tail.length > 0) consumed += w.length; continue; }
      if (isStop(w)) break;
      const clean = w.replace(/[.,;:!?)»"]+$/, '');
      tail.push(clean);
      consumed += clean.length;
      if (clean.length !== w.length) break;
    }
    const tailText = tail.join(' ').trim();
    const middle = chain.slice(0, -1).map((a, idx) => text.slice(a.end, chain[idx + 1].start).trim());
    const steps = [headText, ...middle, tailText].filter(Boolean);
    if (steps.length >= 2 && steps.every((s) => s.length <= 48)) {
      const pre = text.slice(cursor, cursor + headStart);
      if (pre) out.push(...inlineTokens(pre));
      out.push({ kind: 'path', steps });
      cursor = afterStart + (tailText ? after.indexOf(tailText) + tailText.length : 0);
      void consumed;
    } else {
      // Chaîne illisible en pastilles : on la laisse en texte.
      const end = chain[chain.length - 1].end;
      out.push(...inlineTokens(text.slice(cursor, end)));
      cursor = end;
    }
    i = j + 1;
  }
  if (cursor < text.length) out.push(...inlineTokens(text.slice(cursor)));
  return out;
}

function listItem(raw: string): HelpListItem {
  let text = raw.trim();
  let tone: HelpListItem['tone'];
  if (/^(✅|✔️|✓)\s*/.test(text)) { tone = 'ok'; text = text.replace(/^(✅|✔️|✓)\s*/, ''); }
  else if (/^(❌|✖️|✗|⛔)\s*/.test(text)) { tone = 'no'; text = text.replace(/^(❌|✖️|✗|⛔)\s*/, ''); }
  return { tone, inlines: splitPaths(text) };
}

/** Transforme le corps brut d'une section en blocs prêts à dessiner. */
export function parseHelpBody(body: string): HelpBlock[] {
  const lines = (body ?? '').replace(/\r/g, '').split('\n');
  const blocks: HelpBlock[] = [];
  let list: { kind: 'ol' | 'ul'; items: HelpListItem[] } | null = null;
  const flushList = () => {
    if (list && list.items.length) blocks.push(list);
    list = null;
  };
  for (const line of lines) {
    if (!line.trim()) { flushList(); continue; }
    const ol = ORDERED.exec(line);
    if (ol) {
      if (!list || list.kind !== 'ol') { flushList(); list = { kind: 'ol', items: [] }; }
      list.items.push(listItem(ol[2]));
      continue;
    }
    const ul = BULLET.exec(line);
    if (ul) {
      if (!list || list.kind !== 'ul') { flushList(); list = { kind: 'ul', items: [] }; }
      list.items.push(listItem(ul[1]));
      continue;
    }
    // Ligne de texte collée à une liste : elle continue le dernier élément
    // (retour à la ligne dans une étape), sinon nouveau paragraphe.
    if (list && line.startsWith('   ')) {
      const lastItem = list.items[list.items.length - 1];
      lastItem.inlines.push({ kind: 'text', text: ' ' }, ...splitPaths(line.trim()));
      continue;
    }
    flushList();
    blocks.push({ kind: 'p', inlines: splitPaths(line.trim()) });
  }
  flushList();
  return blocks;
}

/** Temps de lecture (minutes, ≥ 1) à 200 mots/minute. */
export function readingMinutes(texts: string[]): number {
  const words = texts.join(' ').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

/** Texte brut d'un bloc (pour la recherche et les extraits). */
export function inlinePlainText(inlines: HelpInline[]): string {
  return inlines
    .map((i) => (i.kind === 'path' ? i.steps.join(' → ') : i.text))
    .join('')
    .trim();
}
