import { describe, expect, it } from 'vitest';
import fixture from './fixtures/scenario-graphs.json';
import { graphErrors, sortGraphErrors, type GraphError } from '../scenarioGraph';

/*
 * Les mêmes cas sont rejoués au banc contre _crm_scenario_graph_errors
 * (scripts/crm-bench/scenarios.mjs) : SQL et TypeScript rendent les mêmes
 * erreurs, triées de la même façon, et les mêmes chiffres de chemins.
 */
describe('graphErrors — cas partagés avec le SQL', () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      const r = graphErrors(c.graph);
      expect(r.errors).toEqual(c.errors);
      if ('stats' in c && c.stats) expect(r.stats).toEqual(c.stats);
    });
  }
});

describe('sortGraphErrors', () => {
  it('le scénario d’abord, puis par nœud, champ et code (ordre des octets)', () => {
    const e = (code: string, node: string | null, field: string | null) => ({ code, node, field }) as GraphError;
    expect(sortGraphErrors([e('orphan', 'b', null), e('bad_goal', null, 'goal'), e('bad_ref', 'a', 'next'), e('bad_entry', null, 'entry.holdout'), e('cycle', 'a', 'next')]))
      .toEqual([e('bad_entry', null, 'entry.holdout'), e('bad_goal', null, 'goal'), e('bad_ref', 'a', 'next'), e('cycle', 'a', 'next'), e('orphan', 'b', null)]);
  });
});
