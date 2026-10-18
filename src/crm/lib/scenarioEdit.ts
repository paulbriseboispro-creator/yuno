/**
 * Yuno CRM — Scénarios : l'édition du graphe, en fonctions PURES (testées).
 *
 * - `flowLayout` range le graphe en FLUX VERTICAL (jamais un canevas libre) :
 *   une suite d'étapes ; une condition, un test A/B ou une attente « jusqu'à »
 *   ouvrent des colonnes qui se rejoignent à l'étape commune la plus proche.
 *   Une étape déjà posée ailleurs devient un renvoi (« continue à … »).
 * - `insertOnEdge` / `insertBefore` posent une étape sur un lien ;
 *   `removeNode` en retire une en recousant le chemin.
 *
 * Rien ici ne valide : `graphErrors` (scenarioGraph.ts) dit ce qui manque.
 */
import { successors, type ScenarioGraph } from './scenarioGraph';

/** Un lien du graphe : le champ `field` du nœud `from` (null = le départ du scénario). */
export interface Edge { from: string | null; field: string }

/** Où se pose une étape ajoutée juste avant un bloc. */
export type Inlet = { type: 'edge'; edge: Edge } | { type: 'before'; target: string };

export type FlowItem =
  | { kind: 'node'; id: string; inlet: Inlet }
  | { kind: 'fork'; id: string; inlet: Inlet; lanes: FlowLane[] }
  /** Étape déjà posée plus haut : le chemin y continue. */
  | { kind: 'goto'; target: string; inlet: Inlet }
  /** Lien vide : l'étape suivante reste à choisir. */
  | { kind: 'open'; edge: Edge };

export interface FlowLane { field: string; items: FlowItem[]; /** Lien qui rejoint l'étape commune (null : le chemin s'arrête seul). */ tail: Edge | null }

export interface FlowLayout { items: FlowItem[]; /** Étapes qu'aucun chemin n'atteint. */ orphans: string[] }

type Nodes = ScenarioGraph['nodes'];

const nodeOf = (g: ScenarioGraph, id: unknown) =>
  (typeof id === 'string' && Object.prototype.hasOwnProperty.call(g.nodes ?? {}, id) ? g.nodes[id] : null);

/** Distances (en étapes) depuis `from`, en suivant tous les liens. */
function distances(g: ScenarioGraph, from: string): Map<string, number> {
  const d = new Map<string, number>([[from, 0]]);
  const q = [from];
  while (q.length) {
    const id = q.shift() as string;
    const n = nodeOf(g, id);
    if (!n) continue;
    for (const s of successors(n)) {
      if (typeof s.id === 'string' && nodeOf(g, s.id) && !d.has(s.id)) {
        d.set(s.id, (d.get(id) as number) + 1);
        q.push(s.id);
      }
    }
  }
  return d;
}

/** L'étape commune la plus proche de plusieurs chemins (null : ils ne se rejoignent pas). */
export function findJoin(g: ScenarioGraph, starts: unknown[]): string | null {
  const ds = starts.filter((s): s is string => typeof s === 'string' && !!nodeOf(g, s)).map((s) => distances(g, s));
  if (ds.length !== starts.length || ds.length < 2) return null;
  let best: string | null = null;
  let bestKey: [number, number] = [Infinity, Infinity];
  for (const [id] of ds[0]) {
    if (!ds.every((m) => m.has(id))) continue;
    const vals = ds.map((m) => m.get(id) as number);
    const key: [number, number] = [Math.max(...vals), vals.reduce((a, b) => a + b, 0)];
    if (key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1]) || (key[0] === bestKey[0] && key[1] === bestKey[1] && best !== null && id < best)) {
      best = id;
      bestKey = key;
    }
  }
  return best;
}

/** Le graphe en flux vertical. Supporte un brouillon incomplet (liens vides, cycles). */
export function flowLayout(g: ScenarioGraph): FlowLayout {
  const placed = new Set<string>();
  const seq = (edge: Edge, first: unknown, stop: Set<string>): { items: FlowItem[]; tail: Edge | null } => {
    const items: FlowItem[] = [];
    let inlet: Inlet = { type: 'edge', edge };
    let last: Edge | null = edge;
    let id: unknown = first;
    for (let guard = 0; guard < 200; guard += 1) {
      if (!nodeOf(g, id)) {
        items.push({ kind: 'open', edge: last ?? edge });
        return { items, tail: null };
      }
      const cur = id as string;
      if (stop.has(cur)) return { items, tail: last };
      if (placed.has(cur)) {
        items.push({ kind: 'goto', target: cur, inlet });
        return { items, tail: null };
      }
      placed.add(cur);
      const n = g.nodes[cur];
      const succ = n.type === 'end' ? [] : successors(n);
      if (succ.length === 0) {
        items.push({ kind: 'node', id: cur, inlet });
        return { items, tail: null };
      }
      if (succ.length === 1) {
        items.push({ kind: 'node', id: cur, inlet });
        last = { from: cur, field: succ[0].field };
        inlet = { type: 'edge', edge: last };
        id = succ[0].id;
        continue;
      }
      const join = findJoin(g, succ.map((s) => s.id));
      const inner = new Set(stop);
      if (join) inner.add(join);
      const lanes = succ.map((s) => {
        const r = seq({ from: cur, field: s.field }, s.id, inner);
        return { field: s.field, items: r.items, tail: r.tail };
      });
      items.push({ kind: 'fork', id: cur, inlet, lanes });
      if (!join || stop.has(join)) return { items, tail: null };
      inlet = { type: 'before', target: join };
      last = null;
      id = join;
    }
    return { items, tail: null };
  };
  const r = seq({ from: null, field: 'start' }, g.start, new Set());
  const orphans = Object.keys(g.nodes ?? {}).filter((id) => !placed.has(id));
  return { items: r.items, orphans };
}

// ── Lecture / écriture d'un lien ───────────────────────────────────────────

export function getEdge(g: ScenarioGraph, e: Edge): unknown {
  if (e.from === null) return g.start;
  const n = nodeOf(g, e.from);
  if (!n) return undefined;
  const m = /^paths\.(\d+)$/.exec(e.field);
  if (m) {
    const ps = Array.isArray(n.paths) ? n.paths as Record<string, unknown>[] : [];
    return ps[Number(m[1])]?.next;
  }
  return n[e.field];
}

/** Copie du graphe où le lien `e` pointe vers `target`. */
export function setEdge(g: ScenarioGraph, e: Edge, target: string): ScenarioGraph {
  if (e.from === null) return { ...g, start: target };
  const n = nodeOf(g, e.from);
  if (!n) return g;
  const m = /^paths\.(\d+)$/.exec(e.field);
  let next: Record<string, unknown> & { type: string };
  if (m) {
    const ps = (Array.isArray(n.paths) ? n.paths as Record<string, unknown>[] : []).map((p, i) => (i === Number(m[1]) ? { ...p, next: target } : p));
    next = { ...n, paths: ps };
  } else {
    next = { ...n, [e.field]: target };
  }
  return { ...g, nodes: { ...g.nodes, [e.from]: next } };
}

/** Tous les liens qui pointent vers `target` (le départ compris). */
export function incoming(g: ScenarioGraph, target: string): Edge[] {
  const out: Edge[] = [];
  if (g.start === target) out.push({ from: null, field: 'start' });
  for (const [id, n] of Object.entries(g.nodes ?? {})) {
    for (const s of successors(n)) if (s.id === target) out.push({ from: id, field: s.field });
  }
  return out;
}

/** Le nœud `node` dont TOUS les liens sortants pointent vers `to`. */
export function withSuccessors(node: Record<string, unknown> & { type: string }, to: string): Record<string, unknown> & { type: string } {
  switch (node.type) {
    case 'end': return node;
    case 'branch': return { ...node, yes: to, no: to };
    case 'split': {
      const ps = Array.isArray(node.paths) && node.paths.length >= 2 ? node.paths as Record<string, unknown>[] : [{ pct: 50 }, { pct: 50 }];
      return { ...node, paths: ps.map((p) => ({ ...p, next: to })) };
    }
    case 'wait': return node.mode === 'until_cond' ? { ...node, next: to, timeout: to } : { ...node, next: to };
    default: return { ...node, next: to };
  }
}

/** Pose une étape sur un lien : ce qui suivait la suit. */
export function insertOnEdge(g: ScenarioGraph, e: Edge, id: string, node: Record<string, unknown> & { type: string }): ScenarioGraph {
  const old = getEdge(g, e);
  const placedNode = typeof old === 'string' && old ? withSuccessors(node, old) : node;
  return setEdge({ ...g, nodes: { ...g.nodes, [id]: placedNode } }, e, id);
}

/** Pose une étape juste avant `target` : TOUS les chemins qui y arrivent passent par elle. */
export function insertBefore(g: ScenarioGraph, target: string, id: string, node: Record<string, unknown> & { type: string }): ScenarioGraph {
  let out: ScenarioGraph = { ...g, nodes: { ...g.nodes, [id]: withSuccessors(node, target) } };
  for (const e of incoming(g, target)) out = setEdge(out, e, id);
  return out;
}

export function insertAt(g: ScenarioGraph, inlet: Inlet, id: string, node: Record<string, unknown> & { type: string }): ScenarioGraph {
  return inlet.type === 'edge' ? insertOnEdge(g, inlet.edge, id, node) : insertBefore(g, inlet.target, id, node);
}

function reachable(g: ScenarioGraph): Set<string> {
  return typeof g.start === 'string' && nodeOf(g, g.start) ? new Set(distances(g, g.start).keys()) : new Set();
}

/**
 * Ce que retirer `id` emporterait : l'étape, et pour une condition ou un
 * test A/B, les étapes de ses chemins qui ne mènent nulle part ailleurs.
 */
export function removalPlan(g: ScenarioGraph, id: string): { graph: ScenarioGraph; removed: string[] } {
  const n = nodeOf(g, id);
  if (!n) return { graph: g, removed: [] };
  const succ = n.type === 'end' ? [] : successors(n);
  // Ce qui reprend après l'étape : son unique suite, sinon l'étape commune de ses chemins.
  const keep = succ.length === 1 ? succ[0].id : findJoin(g, succ.map((s) => s.id));
  const before = reachable(g);
  let out: ScenarioGraph = g;
  for (const e of incoming(g, id)) out = typeof keep === 'string' && keep ? setEdge(out, e, keep) : setEdge(out, e, '');
  const nodes: Nodes = { ...out.nodes };
  delete nodes[id];
  out = { ...out, nodes };
  const after = reachable(out);
  const gone = [...before].filter((x) => x !== id && !after.has(x));
  if (gone.length) {
    const rest: Nodes = { ...out.nodes };
    for (const x of gone) delete rest[x];
    out = { ...out, nodes: rest };
  }
  return { graph: out, removed: [id, ...gone] };
}

/** Une étape neuve, prête à poser (les liens se cousent à l'insertion). */
export function blankNode(type: string, o: { hasEvent: boolean; smsBody: string; templateId?: string }): Record<string, unknown> & { type: string } {
  switch (type) {
    case 'wait': return { type: 'wait', mode: 'duration', hours: 48 };
    case 'branch': return { type: 'branch', cond: { op: 'and', items: [] } };
    case 'split': return { type: 'split', paths: [{ pct: 50 }, { pct: 50 }] };
    case 'email': return { type: 'email', template_id: o.templateId ?? '', event: o.hasEvent ? 'scenario' : 'for_person' };
    case 'sms': return { type: 'sms', body: o.smsBody, event: o.hasEvent ? 'scenario' : 'for_person' };
    case 'tag': return { type: 'tag', op: 'add', tag: '' };
    case 'notify': return { type: 'notify', label: '' };
    default: return { type: 'end' };
  }
}

/** Les étapes d'un type, dans l'ordre du flux (pour « a ouvert l'e-mail … »). */
export function nodesInFlowOrder(g: ScenarioGraph): string[] {
  const out: string[] = [];
  const walk = (items: FlowItem[]) => {
    for (const it of items) {
      if (it.kind === 'node') out.push(it.id);
      else if (it.kind === 'fork') { out.push(it.id); for (const l of it.lanes) walk(l.items); }
    }
  };
  const lay = flowLayout(g);
  walk(lay.items);
  return [...out, ...lay.orphans];
}
