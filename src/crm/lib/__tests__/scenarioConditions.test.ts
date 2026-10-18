import { describe, expect, it } from 'vitest';
import fixture from './fixtures/scenario-conditions.json';
import {
  COND_LEAVES, condErrors, condNeedsEvent, condNodeRefs, countLeaves,
  type CondContext, type CondNode,
} from '../scenarioConditions';

/*
 * Les mêmes cas sont rejoués au banc contre _crm_cond_errors
 * (scripts/crm-bench/scenarios.mjs) : SQL et TypeScript rendent les mêmes
 * erreurs, aux mêmes chemins, dans le même ordre.
 */
describe('condErrors — cas partagés avec le SQL', () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      expect(condErrors(c.tree, c.ctx as CondContext)).toEqual(c.errors);
    });
  }
});

describe('catalogue des feuilles', () => {
  it("n'accepte jamais de donnée personnelle", () => {
    expect(COND_LEAVES.emails).toBeUndefined();
    expect(COND_LEAVES.q).toBeUndefined();
  });
  it('range chaque feuille dans une famille de l’éditeur', () => {
    const fams = new Set(['profile', 'nights', 'why', 'chance', 'messages', 'guestlist', 'channel']);
    for (const def of Object.values(COND_LEAVES)) expect(fams.has(def.family)).toBe(true);
  });
  it("à l'entrée, seules les feuilles scénario sans inscription sont permises", () => {
    const entry = Object.entries(COND_LEAVES).filter(([, d]) => d.scenario && d.entry).map(([k]) => k).sort();
    expect(entry).toEqual(['sc_chance', 'sc_family']);
  });
});

describe('outils de l’éditeur', () => {
  const tree: CondNode = {
    op: 'and', items: [
      { k: 'nb_min', v: 1 },
      { op: 'or', items: [{ k: 'sc_opened', v: 'e1' }, { k: 'sc_sms_delivered', v: 's1' }, { k: 'ntgt', v: { e: '$event', a: 'lineup' } }] },
    ],
  };
  it('compte les feuilles', () => {
    expect(countLeaves(tree)).toBe(4);
    expect(countLeaves(null)).toBe(0);
  });
  it('liste les nœuds cités', () => {
    expect(condNodeRefs(tree)).toEqual([{ k: 'sc_opened', node: 'e1' }, { k: 'sc_sms_delivered', node: 's1' }]);
  });
  it('sait quand la soirée du scénario est nécessaire', () => {
    expect(condNeedsEvent(tree)).toBe(true);
    expect(condNeedsEvent({ op: 'and', items: [{ k: 'nb_min', v: 1 }] })).toBe(false);
    expect(condNeedsEvent({ op: 'and', items: [{ k: 'ev', v: ['$event'] }] })).toBe(true);
    expect(condNeedsEvent({ op: 'and', items: [{ k: 'sc_bought', v: true }] })).toBe(true);
  });
});
