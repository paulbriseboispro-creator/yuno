import { describe, expect, it } from 'vitest';
import { CRM_AUTO_KINDS } from '../automations';
import { graphErrors } from '../scenarioGraph';
import {
  SCENARIO_TEMPLATES, TEMPLATE_EMAILS, TEMPLATE_SMS, blankScenario, buildScenarioTemplate, newNodeId, recipeToGraph,
} from '../scenarioTemplates';

const U = '3f2a6c1e-9b7d-4e2f-8a1c-5d6e7f8a9b0c';

describe('modèles de scénarios', () => {
  for (const key of SCENARIO_TEMPLATES) {
    it(`« ${key} » est un graphe valide dès sa création`, () => {
      const emails = Object.fromEntries(Object.keys(TEMPLATE_EMAILS[key]).map((id) => [id, U]));
      const sms = Object.fromEntries(TEMPLATE_SMS[key].map((id) => [id, 'On vous attend {{lien}}']));
      const g = buildScenarioTemplate(key, emails, sms);
      const errs = graphErrors(g).errors;
      // La bienvenue attend le choix de SA page d'inscription.
      if (key === 'welcome_3') expect(errs).toEqual([{ code: 'bad_param', node: null, field: 'trigger.page_id' }]);
      else expect(errs).toEqual([]);
    });
    it(`« ${key} » : chaque e-mail et chaque SMS déclarés existent dans le graphe`, () => {
      const g = buildScenarioTemplate(key, {}, {});
      for (const id of Object.keys(TEMPLATE_EMAILS[key])) expect(g.nodes[id]?.type).toBe('email');
      for (const id of TEMPLATE_SMS[key]) expect(g.nodes[id]?.type).toBe('sms');
    });
  }
  it('la page blanche est valide', () => {
    expect(graphErrors(blankScenario(U)).errors).toEqual([]);
  });
  it('« 1re → 2e soirée » lit les familles confirmées, puis le genre', () => {
    const g = buildScenarioTemplate('first_second', {}, {});
    expect(g.nodes.b_artist.cond).toEqual({ op: 'and', items: [{ k: 'sc_family', v: 'artist' }] });
    expect(g.nodes.b_concept.cond).toEqual({ op: 'and', items: [{ k: 'sc_family', v: 'series' }] });
    expect(g.nodes.e_genre.event).toBe('for_person');
  });
});

describe('« Personnaliser » une recette', () => {
  for (const kind of CRM_AUTO_KINDS) {
    it(`« ${kind} » devient un scénario valide`, () => {
      const g = recipeToGraph({ kind, delay_hours: 24, subject: 'Objet', template_id: U, auto_delay_days: 21,
        sms: kind === 'first_return' ? { enabled: true, body: 'On vous attend {{lien}}', delay_days: 5 } : null });
      expect(graphErrors(g).errors).toEqual([]);
    });
  }
  it('« 1re soirée » garde son SMS quand il est allumé', () => {
    const g = recipeToGraph({ kind: 'first_return', delay_hours: 504, subject: null, template_id: U, auto_delay_days: 14,
      sms: { enabled: true, body: 'Revenez {{lien}}', delay_days: 3 } });
    expect(g.nodes.s1).toMatchObject({ type: 'sms', body: 'Revenez {{lien}}' });
    expect(g.nodes.w1).toMatchObject({ hours: 72 });
  });
});

describe('newNodeId', () => {
  it('ne reprend jamais un id pris', () => {
    const taken = new Set<string>();
    for (let i = 0; i < 200; i += 1) taken.add(newNodeId(taken));
    expect(taken.size).toBe(200);
    for (const id of taken) expect(id).toMatch(/^[a-z0-9_-]{1,32}$/);
  });
});
