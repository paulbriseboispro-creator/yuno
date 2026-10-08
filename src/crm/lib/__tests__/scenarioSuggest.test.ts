import { describe, expect, it } from 'vitest';
import { applySuggestion, scenarioSuggestions, suggestVerdict, type SuggestReport } from '../scenarioSuggest';
import { holdoutVerdict } from '../holdout';
import { graphErrors, type ScenarioGraph } from '../scenarioGraph';
import { buildScenarioTemplate } from '../scenarioTemplates';

const T = '3f2a6c1e-9b7d-4e2f-8a1c-5d6e7f8a9b01';
const loyal = buildScenarioTemplate('loyal_no_ticket', { e1: T, e2: T }, { s1: 'Demain : {{lien}}' }) as ScenarioGraph;
const welcome = buildScenarioTemplate('welcome_3', { e1: T, e2: T }, { s1: 'Bienvenue {{lien}}' }) as ScenarioGraph & { trigger: { page_id: string } };
welcome.trigger.page_id = '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';

const node = (o: Partial<SuggestReport['nodes'][string]> = {}) => ({ entered: 100, sent: 0, opened: 0, reasons: {}, ...o });
const holdout = (o: Partial<SuggestReport['holdout']> = {}): SuggestReport['holdout'] =>
  ({ done: true, contacted: { n: 400, buyers: 60 }, control: { n: 44, buyers: 5 }, z: 1.2, ...o });

describe('pistes d’amélioration d’un scénario', () => {
  it('se taisent tant que le témoin n’a pas de verdict', () => {
    const rep = { nodes: { e2: node({ reasons: { 'expired:pressure_24h': 50 } }) }, holdout: holdout({ done: false }) };
    expect(scenarioSuggestions(loyal, rep)).toEqual({ verdict: 'pending', suggestions: [] });
    expect(scenarioSuggestions(loyal, { ...rep, holdout: holdout({ control: { n: 6, buyers: 1 } }) }).verdict).toBe('few');
  });

  it('message retenu par la pression : l’attente d’avant passe plus tard (plus près de la soirée)', () => {
    const rep = { nodes: { e2: node({ entered: 200, reasons: { 'expired:pressure_24h': 30, 'held:spacing': 15 } }) }, holdout: holdout() };
    const s = scenarioSuggestions(loyal, rep).suggestions;
    expect(s).toEqual([{ kind: 'later', node: 'e2', wait: 'w1', field: 'days', from: -3, to: -2, count: 45, entered: 200, pct: 23 }]);
    const g = applySuggestion(loyal, s[0]);
    expect((g.nodes.w1 as unknown as { days: number }).days).toBe(-2);
    expect((loyal.nodes.w1 as unknown as { days: number }).days).toBe(-3);
  });

  it('message arrivé trop tard : l’attente d’avant raccourcit d’un jour', () => {
    const rep = { nodes: { e2: node({ entered: 80, reasons: { 'expired:late': 20 } }) }, holdout: holdout() };
    const [s] = scenarioSuggestions(welcome, rep).suggestions;
    expect(s).toMatchObject({ kind: 'earlier', wait: 'w1', field: 'hours', from: 72, to: 48, pct: 25 });
    expect(graphErrors(applySuggestion(welcome, s)).errors).toEqual(graphErrors(welcome).errors);
  });

  it('e-mail peu ouvert : proposer un autre objet, sans correctif', () => {
    const rep = { nodes: { e1: node({ sent: 400, opened: 40 }) }, holdout: holdout() };
    const [s] = scenarioSuggestions(loyal, rep).suggestions;
    expect(s).toEqual({ kind: 'subject', node: 'e1', opened: 40, sent: 400, pct: 10 });
    expect(applySuggestion(loyal, s)).toEqual(loyal);
  });

  it('moins d’achats chez les contactés : n’y faire entrer que ceux qui ont cliqué dans les 90 jours', () => {
    const rep = { nodes: {}, holdout: holdout({ z: -2.4 }) };
    const { verdict, suggestions } = scenarioSuggestions(loyal, rep);
    expect(verdict).toBe('loss');
    expect(suggestions.map((x) => x.kind)).toEqual(['narrow']);
    const g = applySuggestion(loyal, suggestions[0]);
    expect(JSON.stringify(g.entry.filter)).toContain('"click_lt_days"');
    expect(graphErrors(g).errors).toEqual([]);
    expect(scenarioSuggestions(g, rep).suggestions).toEqual([]);
  });

  it('compte démo : aucune piste, quel que soit le tirage du témoin', () => {
    const rep = { nodes: { e2: node({ entered: 200, reasons: { 'expired:pressure_24h': 80 } }) }, holdout: holdout({ z: -3, demo: true }) };
    expect(scenarioSuggestions(loyal, rep)).toEqual({ verdict: 'demo', suggestions: [] });
  });

  it('une étape trop petite ne fait rien proposer', () => {
    const rep = { nodes: { e2: node({ entered: 12, reasons: { 'expired:pressure_24h': 10 } }) }, holdout: holdout() };
    expect(scenarioSuggestions(loyal, rep).suggestions).toEqual([]);
  });

  it('le verdict est le même que celui de l’écran', () => {
    const cases: SuggestReport['holdout'][] = [
      holdout(), holdout({ done: false }), holdout({ z: 2.1 }), holdout({ z: -3 }), holdout({ z: null }), holdout({ contacted: { n: 9, buyers: 1 } }),
    ];
    for (const h of cases) expect(suggestVerdict(h)).toBe(holdoutVerdict(h));
  });
});
