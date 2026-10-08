import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateBuild, type BuildContext, type BuildExpect } from '../builderEval';
import type { ScenarioGraph } from '../scenarioGraph';

interface EvalCase { id: string; request: string; ctx: BuildContext; expect: BuildExpect; recorded: { name: string; graph: ScenarioGraph }; fails: string[] }
const { cases } = JSON.parse(readFileSync(join(__dirname, 'fixtures/builder-evals.json'), 'utf8')) as { cases: EvalCase[] };

describe('bâtisseur de scénarios : jeu d’évaluation (réponses enregistrées)', () => {
  it('au moins 10 demandes, dont des réponses fautives que le contrôle doit attraper', () => {
    expect(cases.length).toBeGreaterThanOrEqual(10);
    expect(cases.filter((c) => c.fails.length === 0).length).toBeGreaterThanOrEqual(10);
    expect(cases.filter((c) => c.fails.length > 0).length).toBeGreaterThanOrEqual(3);
  });

  for (const c of cases) {
    it(`${c.id} — « ${c.request} »`, () => {
      expect(evaluateBuild(c.recorded.name, c.recorded.graph, c.expect, c.ctx).sort()).toEqual([...c.fails].sort());
    });
  }
});
