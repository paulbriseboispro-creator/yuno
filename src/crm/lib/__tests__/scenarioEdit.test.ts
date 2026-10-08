import { describe, expect, it } from 'vitest';
import { graphErrors, type ScenarioGraph } from '../scenarioGraph';
import { blankNode, findJoin, flowLayout, insertAt, insertBefore, insertOnEdge, nodesInFlowOrder, removalPlan, type FlowItem } from '../scenarioEdit';
import { buildScenarioTemplate } from '../scenarioTemplates';

const U = '3f2a6c1e-9b7d-4e2f-8a1c-5d6e7f8a9b0c';

const linear = (): ScenarioGraph => ({
  v: 1, trigger: { type: 'before_event', days: 7 },
  entry: { filter: null, reentry: { mode: 'per_event' }, holdout: true }, goal: { type: 'bought_event' },
  start: 'e1',
  nodes: { e1: { type: 'email', template_id: U, event: 'scenario', next: 'w1' }, w1: { type: 'wait', mode: 'duration', hours: 48, next: 'x' }, x: { type: 'end' } },
});

/** Le flux à plat, pour comparer : « id », « fork(id)[lane|lane] », « goto:id », « open ». */
const flat = (items: FlowItem[]): string[] => items.map((it) => {
  if (it.kind === 'node') return it.id;
  if (it.kind === 'goto') return `goto:${it.target}`;
  if (it.kind === 'open') return 'open';
  return `${it.id}[${it.lanes.map((l) => flat(l.items).join(',')).join('|')}]`;
});

describe('flowLayout', () => {
  it('une suite se lit dans l’ordre', () => {
    expect(flat(flowLayout(linear()).items)).toEqual(['e1', 'w1', 'x']);
  });
  it('« 1re → 2e soirée » : les trois e-mails en colonnes, puis l’attente commune', () => {
    const g = buildScenarioTemplate('first_second', {}, {});
    expect(flat(flowLayout(g).items)).toEqual(['b_artist[e_artist|b_concept[e_concept|e_genre]]', 'w1', 's1', 'x']);
    expect(findJoin(g, ['e_artist', 'b_concept'])).toBe('w1');
  });
  it('un lien vide se montre « à choisir »', () => {
    const g = linear();
    g.nodes.w1 = { type: 'wait', mode: 'duration', hours: 48 };
    expect(flat(flowLayout(g).items)).toEqual(['e1', 'w1', 'open']);
  });
  it('un cycle ne boucle pas : renvoi vers l’étape déjà posée', () => {
    const g = linear();
    g.nodes.w1 = { type: 'wait', mode: 'duration', hours: 48, next: 'e1' };
    expect(flat(flowLayout(g).items)).toEqual(['e1', 'w1', 'goto:e1']);
  });
  it('les étapes non reliées sont listées à part', () => {
    const g = linear();
    g.nodes.z = { type: 'end' };
    expect(flowLayout(g).orphans).toEqual(['z']);
  });
});

describe('insertion', () => {
  it('sur un lien : ce qui suivait la suit', () => {
    const g = insertOnEdge(linear(), { from: 'e1', field: 'next' }, 'b1', blankNode('branch', { hasEvent: true, smsBody: '' }));
    expect(g.nodes.e1.next).toBe('b1');
    expect(g.nodes.b1).toMatchObject({ yes: 'w1', no: 'w1' });
    expect(flat(flowLayout(g).items)).toEqual(['e1', 'b1[|]', 'w1', 'x']);
  });
  it('au départ', () => {
    const g = insertOnEdge(linear(), { from: null, field: 'start' }, 'w0', blankNode('wait', { hasEvent: true, smsBody: '' }));
    expect(g.start).toBe('w0');
    expect(g.nodes.w0.next).toBe('e1');
  });
  it('avant une étape commune : tous les chemins passent par la nouvelle', () => {
    const base = buildScenarioTemplate('first_second', {}, {});
    const g = insertBefore(base, 'w1', 't1', { type: 'tag', op: 'add', tag: 'vu' });
    for (const id of ['e_artist', 'e_concept', 'e_genre']) expect(g.nodes[id].next).toBe('t1');
    expect(g.nodes.t1.next).toBe('w1');
    expect(flat(flowLayout(g).items)).toEqual(['b_artist[e_artist|b_concept[e_concept|e_genre]]', 't1', 'w1', 's1', 'x']);
  });
  it('un test A/B posé sur un lien garde le graphe valide', () => {
    const g = insertAt(linear(), { type: 'edge', edge: { from: 'w1', field: 'next' } }, 'ab', blankNode('split', { hasEvent: true, smsBody: '' }));
    expect(graphErrors(g).errors).toEqual([]);
  });
});

describe('removalPlan', () => {
  it('retire une étape et recoud le chemin', () => {
    const r = removalPlan(linear(), 'w1');
    expect(r.removed).toEqual(['w1']);
    expect(r.graph.nodes.e1.next).toBe('x');
    expect(graphErrors(r.graph).errors).toEqual([]);
  });
  it('retirer la première étape déplace le départ', () => {
    expect(removalPlan(linear(), 'e1').graph.start).toBe('w1');
  });
  it('retirer une condition emporte ses chemins, pas l’étape commune', () => {
    const r = removalPlan(buildScenarioTemplate('first_second', {}, {}), 'b_artist');
    expect(r.removed.sort()).toEqual(['b_artist', 'b_concept', 'e_artist', 'e_concept', 'e_genre']);
    expect(r.graph.start).toBe('w1');
    expect(flat(flowLayout(r.graph).items)).toEqual(['w1', 's1', 'x']);
  });
  it('l’ordre du flux suit la lecture', () => {
    expect(nodesInFlowOrder(buildScenarioTemplate('first_second', {}, {})))
      .toEqual(['b_artist', 'e_artist', 'b_concept', 'e_concept', 'e_genre', 'w1', 's1', 'x']);
  });
});
