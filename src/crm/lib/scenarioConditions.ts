/**
 * Yuno CRM — Scénarios : le langage de conditions « et / ou ».
 *
 * Un arbre JSON. Groupe : `{ op: 'and' | 'or', not?: boolean, items: [...] }` ;
 * feuille : `{ k, v }`. Profondeur 3 au plus (racine comprise), 20 feuilles au
 * plus. Les feuilles « personne » sont les clés de `_crm_filter_sql` (le
 * chiffre affiché = le filtre = l'envoi) ; les feuilles « scénario » lisent le
 * contexte d'une inscription (soirée du scénario, messages reçus).
 *
 * Le SQL fait foi : `_crm_cond_errors` (migration 20261016100000) rend les
 * MÊMES codes, aux MÊMES chemins, que `condErrors` ici. Les cas partagés vivent
 * dans `__tests__/fixtures/scenario-conditions.json`, lus par vitest ET par le
 * banc (`scripts/crm-bench/scenarios.mjs`).
 *
 * Règle de sûreté : une clé inconnue, une valeur illisible ou une référence
 * perdue rendent l'arbre ENTIER faux à l'exécution, même sous un « non » —
 * l'audience rétrécit, jamais l'inverse. À la publication, ce sont des erreurs.
 *
 * Une définition ne porte jamais de donnée personnelle : ni `emails`, ni `q`.
 */
import { FAMILIES } from './analysis';

export const COND_MAX_DEPTH = 3;
export const COND_MAX_LEAVES = 20;

export interface CondLeaf { k: string; v: unknown }
export interface CondGroup { op: 'and' | 'or'; not?: boolean; items: CondNode[] }
export type CondNode = CondGroup | CondLeaf;

/** Où la condition est posée : le filtre d'ENTRÉE ne connaît pas encore l'inscription. */
export type CondContext = 'entry' | 'step';

export type CondErrorCode =
  | 'root_not_group' | 'not_object' | 'bad_op' | 'bad_not' | 'empty_group'
  | 'too_deep' | 'too_many_leaves' | 'unknown_key' | 'bad_value' | 'not_in_entry' | 'soon';

/** `path` = index des éléments depuis la racine, séparés par des points (« 1.0 ») ; '' = la racine. */
export interface CondError { code: CondErrorCode; path: string }

/** Familles de l'éditeur. */
export type CondFamily = 'profile' | 'nights' | 'why' | 'chance' | 'messages' | 'guestlist' | 'channel';

type Spec =
  | { t: 'enum'; of: readonly string[] }
  | { t: 'set'; of: readonly string[] }
  | { t: 'int'; max: number }
  | { t: 'money' }
  | { t: 'bool' }
  | { t: 'strings'; min: number; max: number }
  | { t: 'pattern'; re: RegExp }
  | { t: 'patterns'; re: RegExp; trim: boolean }
  | { t: 'uuid' }
  | { t: 'events' }
  | { t: 'ntgt' }
  | { t: 'node' }
  | { t: 'soon' };

interface LeafDef { family: CondFamily; scenario?: boolean; entry?: boolean; spec: Spec }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UUID_CI = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NODE_ID = /^[a-z0-9_-]{1,32}$/i;

export const CHANNEL_CODES = ['ys', 'yb', 'yt', 'yl', 'em', 'sm', 'dm', 'so', 'sg', 'au', 'di', 'of', 'gl'] as const;
export const TARGET_AUDIENCES = ['concept', 'lineup', 'genre', 'early', 'last_minute', 'once_local', 'likely'] as const;
export const CHANCE_LABELS = ['high', 'medium', 'low'] as const;

/**
 * Le catalogue des feuilles. Les clés « personne » reprennent mot pour mot le
 * vocabulaire de `_crm_filter_sql` (migration 20261012110000), en plus strict :
 * une liste dont UN élément est illisible est refusée entière.
 */
export const COND_LEAVES: Record<string, LeafDef> = {
  // Profil
  age_min: { family: 'profile', spec: { t: 'int', max: 999 } },
  age_max: { family: 'profile', spec: { t: 'int', max: 999 } },
  gender: { family: 'profile', spec: { t: 'enum', of: ['female', 'male', 'other'] } },
  area: { family: 'profile', spec: { t: 'strings', min: 1, max: 80 } },
  country: { family: 'profile', spec: { t: 'patterns', re: /^[a-z]{2}$/i, trim: true } },
  country_not: { family: 'profile', spec: { t: 'pattern', re: /^[a-z]{2}$/i } },
  dist_min: { family: 'profile', spec: { t: 'int', max: 99999 } },
  dist_max: { family: 'profile', spec: { t: 'int', max: 99999 } },
  pass: { family: 'profile', spec: { t: 'enum', of: ['yes', 'no'] } },
  src: { family: 'profile', spec: { t: 'set', of: ['shotgun', 'utm', 'import', 'page', 'other'] } },
  tags: { family: 'profile', spec: { t: 'strings', min: 1, max: 60 } },
  segment: { family: 'profile', spec: { t: 'uuid' } },
  // Soirées
  seg: { family: 'nights', spec: { t: 'enum', of: ['hab', 'occ', 'nou', 'end', 'none'] } },
  ev: { family: 'nights', spec: { t: 'events' } },
  last: { family: 'nights', spec: { t: 'enum', of: ['0-30', '30-90', '90-180', '180+'] } },
  last_gt_days: { family: 'nights', spec: { t: 'int', max: 9999 } },
  last_lt_days: { family: 'nights', spec: { t: 'int', max: 9999 } },
  nb: { family: 'nights', spec: { t: 'enum', of: ['0', '1', '2', '3-5', '6+'] } },
  nb_min: { family: 'nights', spec: { t: 'int', max: 9999 } },
  nb_max: { family: 'nights', spec: { t: 'int', max: 9999 } },
  sp: { family: 'nights', spec: { t: 'enum', of: ['<50', '50-200', '200+'] } },
  sp_min: { family: 'nights', spec: { t: 'money' } },
  basket_min: { family: 'nights', spec: { t: 'money' } },
  paid_min: { family: 'nights', spec: { t: 'int', max: 9999 } },
  up: { family: 'nights', spec: { t: 'enum', of: ['yes', 'no'] } },
  sc_bought: { family: 'nights', scenario: true, spec: { t: 'bool' } },
  sc_entered: { family: 'nights', scenario: true, spec: { t: 'bool' } },
  // Ce qui fait venir
  hyp: { family: 'why', spec: { t: 'set', of: FAMILIES } },
  sc_family: { family: 'why', scenario: true, entry: true, spec: { t: 'enum', of: FAMILIES } },
  // Comme _crm_filter_sql : l'artiste n'est pas « nettoyé » (espaces compris).
  artist: { family: 'why', spec: { t: 'patterns', re: /^(id|slug|name):.{1,160}$/, trim: false } },
  genre: { family: 'why', spec: { t: 'strings', min: 1, max: 60 } },
  fmt: { family: 'why', spec: { t: 'strings', min: 1, max: 40 } },
  series: { family: 'why', spec: { t: 'strings', min: 1, max: 300 } },
  buy: { family: 'why', spec: { t: 'set', of: ['early', 'launch', 'last_minute', 'door'] } },
  grp: { family: 'why', spec: { t: 'enum', of: ['group', 'solo', 'brought'] } },
  ntgt: { family: 'why', spec: { t: 'ntgt' } },
  // Chances de venir
  sc_chance: { family: 'chance', scenario: true, entry: true, spec: { t: 'set', of: CHANCE_LABELS } },
  // Messages
  msg: { family: 'messages', spec: { t: 'enum', of: ['never_clicked', 'clicked_no_buy', 'never_sent'] } },
  click_lt_days: { family: 'messages', spec: { t: 'int', max: 9999 } },
  sc_opened: { family: 'messages', scenario: true, spec: { t: 'node' } },
  sc_clicked: { family: 'messages', scenario: true, spec: { t: 'node' } },
  sc_sms_delivered: { family: 'messages', scenario: true, spec: { t: 'node' } },
  // Le lien court d'un SMS est partagé par soirée : aucun clic par personne.
  sc_sms_clicked: { family: 'messages', scenario: true, spec: { t: 'soon' } },
  // Guest list
  gl: { family: 'guestlist', spec: { t: 'enum', of: ['any', 'only', 'loyal', 'conv', 'noshow'] } },
  glev: { family: 'guestlist', spec: { t: 'events' } },
  // Canal
  rc: { family: 'channel', spec: { t: 'set', of: ['mail', 'sms', 'none'] } },
  ch: { family: 'channel', spec: { t: 'enum', of: ['both', 'email_only', 'sms_only'] } },
  arr: { family: 'channel', spec: { t: 'set', of: CHANNEL_CODES } },
};

export function isCondGroup(n: unknown): n is CondGroup {
  return !!n && typeof n === 'object' && !Array.isArray(n) && 'op' in n;
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
/** `btrim` de Postgres : seules les espaces sont retirées (miroir exact du SQL). */
const btrim = (x: string) => x.replace(/^ +| +$/g, '');
const isInt = (x: unknown, max: number) => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= max;

function valueOk(spec: Spec, v: unknown): boolean {
  switch (spec.t) {
    case 'enum': return typeof v === 'string' && spec.of.includes(v);
    case 'set': return Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string' && spec.of.includes(x));
    case 'int': return isInt(v, spec.max);
    // Deux décimales au plus, 9 999 999,99 au plus (regex de _crm_filter_sql).
    case 'money': return typeof v === 'number' && /^[0-9]{1,7}(\.[0-9]{1,2})?$/.test(String(v));
    case 'bool': return typeof v === 'boolean';
    case 'strings': return Array.isArray(v) && v.length > 0
      && v.every((x) => typeof x === 'string' && btrim(x).length >= spec.min && btrim(x).length <= spec.max);
    case 'pattern': return typeof v === 'string' && spec.re.test(btrim(v));
    case 'patterns': return Array.isArray(v) && v.length > 0
      && v.every((x) => typeof x === 'string' && spec.re.test(spec.trim ? btrim(x) : x));
    case 'uuid': return typeof v === 'string' && UUID_CI.test(v);
    // Soirées : des id (minuscules, comme _crm_filter_sql), « T » (ce soir), ou « $event » (la soirée du scénario).
    case 'events': return Array.isArray(v) && v.length > 0
      && v.every((x) => typeof x === 'string' && (UUID.test(x) || x === 'T' || x === '$event'));
    case 'ntgt': return isObj(v) && typeof v.e === 'string' && (UUID_CI.test(v.e) || v.e === '$event')
      && typeof v.a === 'string' && (TARGET_AUDIENCES as readonly string[]).includes(v.a) && Object.keys(v).length === 2;
    case 'node': return typeof v === 'string' && NODE_ID.test(v);
    case 'soon': return false;
  }
}

/**
 * Les erreurs d'un arbre, dans l'ordre de lecture (préfixe, éléments dans
 * l'ordre). `null` = pas de condition : aucune erreur.
 */
export function condErrors(tree: unknown, ctx: CondContext): CondError[] {
  const out: CondError[] = [];
  if (tree === null || tree === undefined) return out;
  if (!isCondGroup(tree)) { out.push({ code: 'root_not_group', path: '' }); return out; }
  let leaves = 0;
  const walk = (n: unknown, path: string, depth: number) => {
    if (!isObj(n)) { out.push({ code: 'not_object', path }); return; }
    if ('op' in n) {
      if (depth > COND_MAX_DEPTH) { out.push({ code: 'too_deep', path }); return; }
      if (n.op !== 'and' && n.op !== 'or') out.push({ code: 'bad_op', path });
      if ('not' in n && typeof n.not !== 'boolean') out.push({ code: 'bad_not', path });
      const items = n.items;
      if (!Array.isArray(items) || items.length === 0) { out.push({ code: 'empty_group', path }); return; }
      items.forEach((it, i) => walk(it, path === '' ? String(i) : `${path}.${i}`, depth + 1));
      return;
    }
    leaves += 1;
    const k = n.k;
    const def = typeof k === 'string' && Object.prototype.hasOwnProperty.call(COND_LEAVES, k) ? COND_LEAVES[k] : undefined;
    if (!def) { out.push({ code: 'unknown_key', path }); return; }
    if (def.spec.t === 'soon') { out.push({ code: 'soon', path }); return; }
    if (ctx === 'entry' && def.scenario && !def.entry) { out.push({ code: 'not_in_entry', path }); return; }
    if (!valueOk(def.spec, n.v)) out.push({ code: 'bad_value', path });
  };
  walk(tree, '', 1);
  if (leaves > COND_MAX_LEAVES) out.push({ code: 'too_many_leaves', path: '' });
  return out;
}

/** Nombre de feuilles (pour l'éditeur : « 3 / 20 »). */
export function countLeaves(tree: CondNode | null | undefined): number {
  if (!tree) return 0;
  if (!isCondGroup(tree)) return 1;
  return tree.items.reduce((a, it) => a + countLeaves(it), 0);
}

/** Les id de nœuds cités par les feuilles de messages (le graphe vérifie qu'ils existent). */
export function condNodeRefs(tree: CondNode | null | undefined): { k: 'sc_opened' | 'sc_clicked' | 'sc_sms_delivered'; node: string }[] {
  if (!tree) return [];
  if (isCondGroup(tree)) return (Array.isArray(tree.items) ? tree.items : []).flatMap((it) => condNodeRefs(it));
  if ((tree.k === 'sc_opened' || tree.k === 'sc_clicked' || tree.k === 'sc_sms_delivered') && typeof tree.v === 'string') {
    return [{ k: tree.k, node: tree.v }];
  }
  return [];
}

/** La condition pose-t-elle une feuille qui exige la soirée du scénario ? */
export function condNeedsEvent(tree: CondNode | null | undefined): boolean {
  if (!tree) return false;
  if (isCondGroup(tree)) return (Array.isArray(tree.items) ? tree.items : []).some((it) => condNeedsEvent(it));
  if (tree.k === 'sc_bought' || tree.k === 'sc_entered' || tree.k === 'sc_chance') return true;
  if ((tree.k === 'ev' || tree.k === 'glev') && Array.isArray(tree.v)) return tree.v.includes('$event');
  return tree.k === 'ntgt' && isObj(tree.v) && tree.v.e === '$event';
}
