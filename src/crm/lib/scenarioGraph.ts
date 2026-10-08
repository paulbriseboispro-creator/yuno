/**
 * Yuno CRM — Scénarios : le graphe (déclencheur, entrée, objectif, nœuds) et
 * sa validation de forme.
 *
 * Le SQL fait foi : `_crm_scenario_graph_errors` (migration 20261016110000)
 * rend les MÊMES erreurs, triées de la même façon, que `graphErrors` ici. Cas
 * partagés : `__tests__/fixtures/scenario-graphs.json`, rejoués au banc.
 * Les contrôles qui lisent la base (modèle d'e-mail du compte, identité de
 * l'expéditeur SMS, segment, page, prix en Yunits) vivent dans la publication
 * (lot J2), pas ici.
 *
 * Rythme : deux messages d'un même chemin sont à 20 h au moins. On ne refuse
 * que ce qui est PROUVÉ trop proche (attentes de durée, attentes relatives à la
 * soirée comparables) ; quand l'écart ne se calcule pas (attente « jusqu'à une
 * condition », deux repères différents), le moteur reporte le message.
 */
import { condErrors, condNeedsEvent, condNodeRefs, isCondGroup, type CondErrorCode, type CondNode } from './scenarioConditions';

export const SCN_MAX_NODES = 30;
export const SCN_MAX_MESSAGES = 6;
export const SCN_MIN_GAP_HOURS = 20;
export const SCN_MAX_PATHS = 512;
/** « Pas de borne », en minutes (un nombre, pour être identique en SQL). */
const INF = 1e9;
/** Le temps se compte en MINUTES entières : aucun flottant, le SQL tombe sur les mêmes chiffres. */
const GAP = SCN_MIN_GAP_HOURS * 60;
const DAY = 1440;

export const TRIGGERS = [
  'event_published', 'before_event', 'after_event', 'ticket_bought', 'segment_joined', 'absence',
  'click_no_buy', 'signup_confirmed', 'chance_high', 'manual_segment',
] as const;
/** Ce que Shotgun ne rend pas : « Bientôt, avec l'intégration partenaire Shotgun ». */
export const SOON_TRIGGERS = ['cart_abandoned', 'shotgun_visit'] as const;
/** Déclencheurs qui donnent au scénario SA soirée. */
export const EVENT_TRIGGERS = ['event_published', 'before_event', 'after_event', 'ticket_bought', 'click_no_buy', 'chance_high', 'signup_confirmed'] as const;

export type TriggerType = (typeof TRIGGERS)[number];
export type NodeType = 'wait' | 'branch' | 'split' | 'email' | 'sms' | 'tag' | 'notify' | 'instagram_dm' | 'end';
export const NODE_TYPES: readonly NodeType[] = ['wait', 'branch', 'split', 'email', 'sms', 'tag', 'notify', 'instagram_dm', 'end'];
export const MESSAGE_TYPES: readonly NodeType[] = ['email', 'sms', 'instagram_dm'];

export interface ScenarioGraph {
  v: 1;
  trigger: Record<string, unknown> & { type: string };
  entry: { filter: unknown; reentry: { mode: 'once' | 'per_event' | 'every_days'; days?: number }; holdout: boolean };
  goal: { type: 'bought_event' | 'bought_any' | 'entered' } | null;
  start: string;
  nodes: Record<string, Record<string, unknown> & { type: string }>;
}

export type GraphErrorCode =
  | 'bad_version' | 'bad_trigger' | 'soon' | 'bad_param' | 'bad_entry' | 'bad_reentry' | 'bad_goal' | 'no_event'
  | 'no_nodes' | 'too_many_nodes' | 'bad_start' | 'bad_node_id' | 'bad_node_type' | 'missing_next' | 'bad_ref'
  | 'cycle' | 'orphan' | 'too_many_paths' | 'too_many_messages' | 'too_close' | 'after_start'
  | 'bad_split' | 'url_in_text' | 'link_without_event' | 'bad_node_ref' | `cond_${CondErrorCode}`;

/** `node` = id du nœud fautif (null : le scénario) ; `field` = le champ (« trigger.days », « cond:1.0 »). */
export interface GraphError { code: GraphErrorCode; node: string | null; field: string | null }

export interface GraphStats { paths: number; maxMessages: number; maxEmails: number; maxSms: number }

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
/** Une valeur TEXTE parmi une liste (jamais `String([...])`, qui joindrait un tableau). */
const oneOf = (x: unknown, list: readonly string[]) => typeof x === 'string' && list.includes(x);
const isInt = (x: unknown, lo: number, hi: number) => typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi;
/** `btrim` de Postgres : seules les espaces sont retirées. */
export const btrim = (x: string) => x.replace(/^ +| +$/g, '');
const isStr = (x: unknown, lo: number, hi: number) => typeof x === 'string' && btrim(x).length >= lo && btrim(x).length <= hi;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const NODE_ID_RE = /^[a-z0-9_-]{1,32}$/;
const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
/** Une adresse web dans un texte (seul le lien court Yuno, {{lien}}, est permis). */
// Sans « \b » : en SQL, \b n'est pas une frontière de mot ; le lookahead s'écrit pareil des deux côtés.
const URL_RE = /(https?:\/\/|www\.|[a-z0-9-]+\.(fr|com|eu|es|net|org|io|be|ch|ly|link|app|me|co)(?![a-z0-9]))/i;

/** Successeurs d'un nœud, dans l'ordre (null = champ absent ou illisible). */
export function successors(n: Record<string, unknown>): { field: string; id: unknown }[] {
  switch (n.type) {
    case 'branch': return [{ field: 'yes', id: n.yes }, { field: 'no', id: n.no }];
    case 'split': return Array.isArray(n.paths) ? n.paths.map((p, i) => ({ field: `paths.${i}`, id: isObj(p) ? p.next : undefined })) : [];
    case 'wait': return n.mode === 'until_cond' ? [{ field: 'next', id: n.next }, { field: 'timeout', id: n.timeout }] : [{ field: 'next', id: n.next }];
    case 'end': return [];
    default: return [{ field: 'next', id: n.next }];
  }
}

const push = (out: GraphError[], code: GraphErrorCode, node: string | null, field: string | null) => {
  if (!out.some((e) => e.code === code && e.node === node && e.field === field)) out.push({ code, node, field });
};

const condInto = (out: GraphError[], tree: unknown, ctx: 'entry' | 'step', node: string | null, prefix: string) => {
  for (const e of condErrors(tree, ctx)) push(out, `cond_${e.code}` as GraphErrorCode, node, `${prefix}:${e.path}`);
};

/** Ordre canonique : le scénario d'abord, puis par nœud, champ, code (ordre des octets, comme COLLATE "C"). */
const cmp = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? -1 : b === null ? 1 : a < b ? -1 : 1);
export function sortGraphErrors(errs: GraphError[]): GraphError[] {
  return [...errs].sort((x, y) => cmp(x.node, y.node) || cmp(x.field, y.field) || cmp(x.code, y.code));
}

interface Pos { anchor: string; frame: 'h' | 'd'; lo: number; hi: number }
interface PathState { since: [number, number] | null; pos: Pos | null; msgs: number; emails: number; sms: number }

function initialPos(t: Record<string, unknown>): Pos | null {
  // Le balayage passe toute la journée J-N : le jour est sûr, l'heure non.
  if (t.type === 'before_event' && isInt(t.days, 1, 60)) return { anchor: 'start', frame: 'd', lo: -DAY * (t.days as number), hi: -DAY * (t.days as number) + DAY };
  if (t.type === 'after_event' && isInt(t.hours, 1, 720)) return { anchor: 'end', frame: 'h', lo: 60 * (t.hours as number), hi: 60 * (t.hours as number) };
  return null;
}

const hoursOk = (n: Record<string, unknown>) => isInt(n.hours, -720, 720);
const daysOk = (n: Record<string, unknown>) => isInt(n.days, -60, 60) && typeof n.at === 'string' && HHMM.test(n.at);

/** Repère d'une attente relative à la soirée (heures si elles sont lisibles, sinon jour + heure). */
function targetPos(n: Record<string, unknown>): Pos {
  const anchor = String(n.anchor);
  if (hoursOk(n)) return { anchor, frame: 'h', lo: 60 * (n.hours as number), hi: 60 * (n.hours as number) };
  const [hh, mm] = String(n.at).split(':').map(Number);
  const t = DAY * (n.days as number) + 60 * hh + mm;
  return { anchor, frame: 'd', lo: t, hi: t };
}

/** Temps écoulé entre deux repères : [min, max], ou null si on ne sait pas comparer. */
function elapsed(from: Pos | null, to: Pos): [number, number] | null {
  if (!from || from.anchor !== to.anchor) return null;
  // Repère « jour » contre repère « heure » de la même soirée : l'heure de la
  // soirée est inconnue (0 à 24 h), l'écart s'élargit d'autant.
  const slack = from.frame === to.frame ? 0 : DAY;
  return [Math.max(0, to.lo - from.hi - slack), Math.max(0, to.hi - from.lo + slack)];
}

const addSince = (s: [number, number] | null, d: [number, number]): [number, number] | null =>
  s === null ? null : [Math.min(INF, s[0] + d[0]), Math.min(INF, s[1] + d[1])];
const shiftPos = (p: Pos | null, d: [number, number]): Pos | null => (p ? { ...p, lo: p.lo + d[0], hi: p.hi + d[1] } : null);

/**
 * Les erreurs de forme d'un graphe, triées (`sortGraphErrors`), et ce que ses
 * chemins coûtent au plus (`stats`, pour l'écran « Avant de publier »).
 */
export function graphErrors(g: unknown): { errors: GraphError[]; stats: GraphStats } {
  const out: GraphError[] = [];
  const stats: GraphStats = { paths: 0, maxMessages: 0, maxEmails: 0, maxSms: 0 };
  if (!isObj(g) || g.v !== 1) { push(out, 'bad_version', null, 'v'); return { errors: out, stats }; }

  // ── Déclencheur ──────────────────────────────────────────────────────────
  const t = isObj(g.trigger) ? g.trigger : null;
  const tt = t && typeof t.type === 'string' ? t.type : null;
  // Un déclencheur illisible ne fait pas pleuvoir les « sans soirée » sur tout le graphe.
  let hasEvent = false;
  let trigOk = false;
  if (!t || !tt) push(out, 'bad_trigger', null, 'trigger');
  else if ((SOON_TRIGGERS as readonly string[]).includes(tt)) push(out, 'soon', null, 'trigger');
  else if (!(TRIGGERS as readonly string[]).includes(tt)) push(out, 'bad_trigger', null, 'trigger');
  else {
    trigOk = true;
    hasEvent = (EVENT_TRIGGERS as readonly string[]).includes(tt);
    const bad = (f: string) => push(out, 'bad_param', null, `trigger.${f}`);
    if (tt === 'before_event' && !isInt(t.days, 1, 60)) bad('days');
    if (tt === 'after_event') {
      if (!isInt(t.hours, 1, 720)) bad('hours');
      if (!oneOf(t.who, ['entered', 'absent_buyers', 'all'])) bad('who');
    }
    if (tt === 'absence' && !isInt(t.days, 14, 730)) bad('days');
    if (tt === 'click_no_buy' && !isInt(t.hours, 1, 72)) bad('hours');
    if (tt === 'ticket_bought' && typeof t.first !== 'boolean') bad('first');
    if ((tt === 'segment_joined' || tt === 'manual_segment') && !(typeof t.segment_id === 'string' && UUID.test(t.segment_id))) bad('segment_id');
    if (tt === 'signup_confirmed' && !(typeof t.page_id === 'string' && UUID.test(t.page_id))) bad('page_id');
    if ((tt === 'before_event' || tt === 'ticket_bought') && t.series !== undefined && t.series !== null && !isStr(t.series, 1, 300)) bad('series');
    if (tt === 'before_event' && t.genre !== undefined && t.genre !== null && !isStr(t.genre, 1, 60)) bad('genre');
  }

  // ── Entrée et objectif ───────────────────────────────────────────────────
  const entry = isObj(g.entry) ? g.entry : null;
  if (!entry) push(out, 'bad_entry', null, 'entry');
  else {
    condInto(out, entry.filter ?? null, 'entry', null, 'entry.filter');
    if (trigOk && !hasEvent && isCondGroup(entry.filter) && condNeedsEvent(entry.filter as CondNode)) push(out, 'no_event', null, 'entry.filter');
    const re = isObj(entry.reentry) ? entry.reentry : null;
    if (!re || !oneOf(re.mode, ['once', 'per_event', 'every_days'])) push(out, 'bad_reentry', null, 'entry.reentry');
    else if (re.mode === 'every_days' && !isInt(re.days, 7, 365)) push(out, 'bad_reentry', null, 'entry.reentry');
    else if (re.mode === 'per_event' && trigOk && !hasEvent) push(out, 'no_event', null, 'entry.reentry');
    if (typeof entry.holdout !== 'boolean') push(out, 'bad_entry', null, 'entry.holdout');
  }
  if (g.goal !== null && g.goal !== undefined) {
    const gt = isObj(g.goal) ? g.goal.type : undefined;
    if (!oneOf(gt, ['bought_event', 'bought_any', 'entered'])) push(out, 'bad_goal', null, 'goal');
    else if (gt !== 'bought_any' && trigOk && !hasEvent) push(out, 'no_event', null, 'goal');
  }

  // ── Nœuds ─────────────────────────────────────────────────────────────────
  const nodes = isObj(g.nodes) ? g.nodes : null;
  const ids = nodes ? Object.keys(nodes) : [];
  if (!nodes || ids.length === 0) { push(out, 'no_nodes', null, 'nodes'); return { errors: sortGraphErrors(out), stats }; }
  if (ids.length > SCN_MAX_NODES) push(out, 'too_many_nodes', null, 'nodes');
  const node = (id: unknown) => (typeof id === 'string' && Object.prototype.hasOwnProperty.call(nodes, id) && isObj(nodes[id]) ? nodes[id] as Record<string, unknown> : null);
  const typeOf = (id: string) => { const ty = node(id)?.type; return typeof ty === 'string' ? ty : ''; };

  for (const id of ids) {
    const n = node(id);
    if (!NODE_ID_RE.test(id)) push(out, 'bad_node_id', id, null);
    if (!n || !NODE_TYPES.includes(n.type as NodeType)) { push(out, 'bad_node_type', id, 'type'); continue; }
    if (n.type === 'instagram_dm') push(out, 'soon', id, 'type');
    for (const s of successors(n)) {
      if (s.id === undefined || s.id === null || s.id === '') push(out, 'missing_next', id, s.field);
      else if (!node(s.id)) push(out, 'bad_ref', id, s.field);
    }
    const bad = (f: string) => push(out, 'bad_param', id, f);
    switch (n.type) {
      case 'wait':
        if (n.mode === 'duration') { if (!isInt(n.hours, 1, 2160)) bad('hours'); }
        else if (n.mode === 'until_event') {
          if (!oneOf(n.anchor, ['start', 'end', 'sale_open'])) bad('anchor');
          const byHours = n.hours !== undefined;
          if (byHours ? !isInt(n.hours, -720, 720) || n.days !== undefined || n.at !== undefined
            : !isInt(n.days, -60, 60) || !(typeof n.at === 'string' && HHMM.test(n.at))) bad('when');
          else if (n.anchor === 'start' && ((byHours && (n.hours as number) > 0) || (!byHours && (n.days as number) > 0))) push(out, 'after_start', id, 'when');
          if (trigOk && !hasEvent) push(out, 'no_event', id, 'anchor');
        } else if (n.mode === 'until_cond') {
          if (!isInt(n.max_hours, 1, 744)) bad('max_hours');
          if (!isCondGroup(n.cond)) push(out, 'cond_root_not_group', id, 'cond:');
          else condInto(out, n.cond, 'step', id, 'cond');
        } else bad('mode');
        break;
      case 'branch':
        if (!isCondGroup(n.cond)) push(out, 'cond_root_not_group', id, 'cond:');
        else condInto(out, n.cond, 'step', id, 'cond');
        break;
      case 'split': {
        const ps = Array.isArray(n.paths) ? n.paths : null;
        if (!ps || ps.length < 2 || ps.length > 4 || !ps.every((p) => isObj(p) && isInt(p.pct, 1, 99))
          || ps.reduce((a, p) => a + (isObj(p) && typeof p.pct === 'number' ? p.pct : 0), 0) !== 100) push(out, 'bad_split', id, 'paths');
        break;
      }
      case 'email':
        if (!(typeof n.template_id === 'string' && UUID.test(n.template_id))) bad('template_id');
        if (n.subject !== undefined && n.subject !== null && !(typeof n.subject === 'string' && btrim(n.subject).length <= 140)) bad('subject');
        else if (typeof n.subject === 'string' && URL_RE.test(n.subject)) push(out, 'url_in_text', id, 'subject');
        if (!oneOf(n.event, ['scenario', 'fixed', 'for_person'])) bad('event');
        else if (n.event === 'fixed' && !(typeof n.event_id === 'string' && UUID.test(n.event_id))) bad('event_id');
        else if (n.event === 'scenario' && trigOk && !hasEvent) push(out, 'no_event', id, 'event');
        break;
      case 'sms':
        if (!isStr(n.body, 1, 480)) bad('body');
        else {
          if (URL_RE.test(String(n.body))) push(out, 'url_in_text', id, 'body');
          if (String(n.body).includes('{{lien}}') && n.event === 'none') push(out, 'link_without_event', id, 'body');
        }
        if (!oneOf(n.event, ['scenario', 'fixed', 'for_person', 'none'])) bad('event');
        else if (n.event === 'fixed' && !(typeof n.event_id === 'string' && UUID.test(n.event_id))) bad('event_id');
        else if (n.event === 'scenario' && trigOk && !hasEvent) push(out, 'no_event', id, 'event');
        break;
      case 'tag':
        if (!oneOf(n.op, ['add', 'remove'])) bad('op');
        if (!isStr(n.tag, 1, 40)) bad('tag');
        break;
      case 'notify':
        if (!isStr(n.label, 1, 80)) bad('label');
        break;
    }
    // Une feuille de message cite un nœud du bon type ; une feuille de la soirée exige un déclencheur qui en donne une.
    if ((n.type === 'branch' || n.type === 'wait') && isCondGroup(n.cond)) {
      if (trigOk && !hasEvent && condNeedsEvent(n.cond as CondNode)) push(out, 'no_event', id, 'cond');
      for (const r of condNodeRefs(n.cond)) {
        const want = r.k === 'sc_sms_delivered' ? 'sms' : 'email';
        if (typeOf(r.node) !== want) push(out, 'bad_node_ref', id, `cond:${r.k}`);
      }
    }
  }

  // ── Structure : départ, cycles, nœuds orphelins ──────────────────────────
  const start = typeof g.start === 'string' ? g.start : null;
  if (!start || !node(start)) { push(out, 'bad_start', null, 'start'); return { errors: sortGraphErrors(out), stats }; }
  const color = new Map<string, 1 | 2>();
  let cyclic = false;
  const visit = (id: string) => {
    color.set(id, 1);
    for (const s of successors(node(id) ?? { type: 'end' })) {
      if (typeof s.id !== 'string' || !node(s.id)) continue;
      const c = color.get(s.id);
      if (c === 1) { cyclic = true; push(out, 'cycle', id, s.field); }
      else if (c === undefined) visit(s.id);
    }
    color.set(id, 2);
  };
  visit(start);
  for (const id of ids) if (!color.has(id)) push(out, 'orphan', id, null);
  if (cyclic) return { errors: sortGraphErrors(out), stats };

  // ── Chemins : messages, rythme ───────────────────────────────────────────
  let tooMany = false;
  const walk = (id: string, st: PathState) => {
    if (tooMany) return;
    const n = node(id);
    if (!n) return;
    let s = st;
    if (MESSAGE_TYPES.includes(n.type as NodeType)) {
      if (s.since && s.since[1] < GAP) push(out, 'too_close', id, null);
      const msgs = s.msgs + 1;
      if (msgs > SCN_MAX_MESSAGES) push(out, 'too_many_messages', id, null);
      s = { since: [0, 0], pos: s.pos, msgs, emails: s.emails + (n.type === 'email' ? 1 : 0), sms: s.sms + (n.type === 'sms' ? 1 : 0) };
    }
    if (n.type === 'end') {
      stats.paths += 1;
      if (stats.paths > SCN_MAX_PATHS) { tooMany = true; push(out, 'too_many_paths', null, 'nodes'); return; }
      stats.maxMessages = Math.max(stats.maxMessages, s.msgs);
      stats.maxEmails = Math.max(stats.maxEmails, s.emails);
      stats.maxSms = Math.max(stats.maxSms, s.sms);
      return;
    }
    for (const nx of successors(n)) {
      if (typeof nx.id !== 'string') continue;
      let next = s;
      if (n.type === 'wait') {
        // Une attente illisible ne compte pas (on ne l'invente pas) : le validateur l'a déjà signalée.
        if (n.mode === 'duration' && isInt(n.hours, 1, 2160)) {
          const m = 60 * (n.hours as number);
          next = { ...s, since: addSince(s.since, [m, m]), pos: shiftPos(s.pos, [m, m]) };
        } else if (n.mode === 'until_event' && oneOf(n.anchor, ['start', 'end', 'sale_open'])
          && (hoursOk(n) || daysOk(n))) {
          const to = targetPos(n);
          const d = elapsed(s.pos, to);
          next = { ...s, since: s.since === null ? null : d ? addSince(s.since, d) : [s.since[0], INF], pos: to };
        } else if (n.mode === 'until_cond' && isInt(n.max_hours, 1, 744)) {
          const m = 60 * (n.max_hours as number);
          const d: [number, number] = nx.field === 'timeout' ? [m, m] : [0, m];
          next = { ...s, since: addSince(s.since, d), pos: shiftPos(s.pos, d) };
        }
      }
      walk(nx.id, next);
    }
  };
  walk(start, { since: null, pos: initialPos(t ?? {}), msgs: 0, emails: 0, sms: 0 });
  return { errors: sortGraphErrors(out), stats };
}
