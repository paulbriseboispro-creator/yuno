/**
 * Yuno CRM — Scénarios : les modèles de départ et la copie d'une recette
 * (« Personnaliser », décision 2 de Paul). Fonctions PURES : elles rendent un
 * graphe (scenarioGraph.ts) ; les e-mails dont un modèle a besoin sont créés
 * par l'écran, qui passe leurs id (`emails`).
 *
 * Chaque modèle montre l'analyse au travail : familles d'hypothèses
 * CONFIRMÉES sur le compte (sc_family), « Chances de venir » (sc_chance),
 * soirée choisie POUR la personne (event 'for_person'). Une famille qui n'est
 * pas confirmée ne retient personne : la branche suivante prend le relais.
 */
import type { CrmAutoKind } from './automations';
import type { CrmTemplateKind } from './emailTemplates';
import type { CondGroup } from './scenarioConditions';
import type { ScenarioGraph } from './scenarioGraph';

export const SCENARIO_TEMPLATES = [
  'first_second', 'loyal_no_ticket', 'chance_high', 'gl_to_paid', 'absent_buyers', 'welcome_3', 'winback_2',
] as const;
export type ScenarioTemplateKey = (typeof SCENARIO_TEMPLATES)[number];

/** Les e-mails d'un modèle : un id de nœud → la sorte de modèle CRM qui lui donne son e-mail. */
export const TEMPLATE_EMAILS: Record<ScenarioTemplateKey, Record<string, CrmTemplateKind>> = {
  first_second: { e_artist: 'retour', e_concept: 'retour', e_genre: 'retour' },
  loyal_no_ticket: { e1: 'annonce', e2: 'lastcall' },
  chance_high: { e1: 'annonce' },
  gl_to_paid: { e1: 'retour', e2: 'annonce' },
  absent_buyers: { e1: 'manque' },
  welcome_3: { e1: 'bienvenue', e2: 'annonce' },
  winback_2: { e1: 'manque' },
};

/** Les SMS d'un modèle : un id de nœud → la clé de son texte (yc.scn.tpl.<modèle>.<nœud>). */
export const TEMPLATE_SMS: Record<ScenarioTemplateKey, string[]> = {
  first_second: ['s1'],
  loyal_no_ticket: ['s1'],
  chance_high: ['s1'],
  gl_to_paid: [],
  absent_buyers: ['s1'],
  welcome_3: ['s1'],
  winback_2: ['s1'],
};

const and = (...items: CondGroup['items']): CondGroup => ({ op: 'and', items });
const noPlace: CondGroup = { op: 'and', not: true, items: [{ k: 'ev', v: ['$event'] }] };

/**
 * Le graphe d'un modèle. `emails` = id des modèles d'e-mail créés pour ses
 * nœuds ; `sms` = texte de chaque SMS (traduit par l'écran).
 */
export function buildScenarioTemplate(
  key: ScenarioTemplateKey, emails: Record<string, string>, sms: Record<string, string>,
): ScenarioGraph {
  const email = (id: string, event: 'scenario' | 'for_person', next: string) =>
    ({ type: 'email', template_id: emails[id] ?? '', event, next });
  const text = (id: string, event: 'scenario' | 'for_person', next: string) => ({ type: 'sms', body: sms[id] ?? '', event, next });
  switch (key) {
    // 1re → 2e soirée, selon ce qui fait venir : line-up → l'artiste déjà vu ;
    // concept → la prochaine édition ; sinon le genre. Puis un SMS 5 jours plus
    // tard à qui n'a toujours rien acheté (l'objectif fait sortir les acheteurs).
    case 'first_second':
      return {
        v: 1,
        trigger: { type: 'after_event', hours: 48, who: 'entered' },
        entry: { filter: and({ k: 'nb', v: '1' }, { k: 'pass', v: 'no' }), reentry: { mode: 'once' }, holdout: true },
        goal: { type: 'bought_any' },
        start: 'b_artist',
        nodes: {
          b_artist: { type: 'branch', cond: and({ k: 'sc_family', v: 'artist' }), yes: 'e_artist', no: 'b_concept' },
          b_concept: { type: 'branch', cond: and({ k: 'sc_family', v: 'series' }), yes: 'e_concept', no: 'e_genre' },
          e_artist: email('e_artist', 'for_person', 'w1'),
          e_concept: email('e_concept', 'for_person', 'w1'),
          e_genre: email('e_genre', 'for_person', 'w1'),
          w1: { type: 'wait', mode: 'duration', hours: 120, next: 's1' },
          s1: text('s1', 'for_person', 'x'),
          x: { type: 'end' },
        },
      };
    // Les habitués sans place : J-10, J-3, J-1 (SMS).
    case 'loyal_no_ticket':
      return {
        v: 1,
        trigger: { type: 'before_event', days: 10 },
        entry: { filter: and({ k: 'seg', v: 'hab' }, noPlace), reentry: { mode: 'per_event' }, holdout: true },
        goal: { type: 'bought_event' },
        start: 'e1',
        nodes: {
          e1: email('e1', 'scenario', 'w1'),
          w1: { type: 'wait', mode: 'until_event', anchor: 'start', days: -3, at: '18:00', next: 'e2' },
          e2: email('e2', 'scenario', 'w2'),
          w2: { type: 'wait', mode: 'until_event', anchor: 'start', days: -1, at: '18:00', next: 's1' },
          s1: text('s1', 'scenario', 'x'),
          x: { type: 'end' },
        },
      };
    // « Chances de venir » élevées, pas encore de place.
    case 'chance_high':
      return {
        v: 1,
        trigger: { type: 'chance_high' },
        entry: { filter: and(noPlace), reentry: { mode: 'per_event' }, holdout: true },
        goal: { type: 'bought_event' },
        start: 'e1',
        nodes: {
          e1: email('e1', 'scenario', 'w1'),
          w1: { type: 'wait', mode: 'until_event', anchor: 'start', days: -2, at: '18:00', next: 's1' },
          s1: text('s1', 'scenario', 'x'),
          x: { type: 'end' },
        },
      };
    // Invités en guest list, jamais payants → une soirée payante.
    case 'gl_to_paid':
      return {
        v: 1,
        trigger: { type: 'after_event', hours: 24, who: 'entered' },
        entry: { filter: and({ k: 'gl', v: 'only' }), reentry: { mode: 'every_days', days: 60 }, holdout: true },
        goal: { type: 'bought_any' },
        start: 'e1',
        nodes: {
          e1: email('e1', 'for_person', 'w1'),
          w1: { type: 'wait', mode: 'duration', hours: 96, next: 'e2' },
          e2: email('e2', 'for_person', 'x'),
          x: { type: 'end' },
        },
      };
    // Acheteurs absents → la prochaine soirée (seulement si la porte a scanné).
    case 'absent_buyers':
      return {
        v: 1,
        trigger: { type: 'after_event', hours: 24, who: 'absent_buyers' },
        entry: { filter: null, reentry: { mode: 'per_event' }, holdout: true },
        goal: { type: 'bought_any' },
        start: 'e1',
        nodes: {
          e1: email('e1', 'for_person', 'w1'),
          w1: { type: 'wait', mode: 'duration', hours: 120, next: 's1' },
          s1: text('s1', 'for_person', 'x'),
          x: { type: 'end' },
        },
      };
    // Bienvenue après une page d'inscription, en 3 temps (la page se choisit).
    case 'welcome_3':
      return {
        v: 1,
        trigger: { type: 'signup_confirmed', page_id: '' },
        entry: { filter: null, reentry: { mode: 'once' }, holdout: true },
        goal: { type: 'bought_any' },
        start: 'e1',
        nodes: {
          e1: email('e1', 'for_person', 'w1'),
          w1: { type: 'wait', mode: 'duration', hours: 72, next: 'e2' },
          e2: email('e2', 'for_person', 'w2'),
          w2: { type: 'wait', mode: 'duration', hours: 96, next: 's1' },
          s1: text('s1', 'for_person', 'x'),
          x: { type: 'end' },
        },
      };
    // Reconquête en 2 temps : venus 2 fois ou plus, plus revenus depuis 4 mois.
    case 'winback_2':
      return {
        v: 1,
        trigger: { type: 'absence', days: 120 },
        entry: { filter: and({ k: 'nb_min', v: 2 }), reentry: { mode: 'every_days', days: 180 }, holdout: true },
        goal: { type: 'bought_any' },
        start: 'e1',
        nodes: {
          e1: email('e1', 'for_person', 'w1'),
          w1: { type: 'wait', mode: 'duration', hours: 168, next: 's1' },
          s1: text('s1', 'for_person', 'x'),
          x: { type: 'end' },
        },
      };
  }
}

/** Une page blanche : un déclencheur à choisir, un e-mail, la fin. */
export function blankScenario(templateId: string): ScenarioGraph {
  return {
    v: 1,
    trigger: { type: 'before_event', days: 7 },
    entry: { filter: null, reentry: { mode: 'per_event' }, holdout: true },
    goal: { type: 'bought_event' },
    start: 'e1',
    nodes: {
      e1: { type: 'email', template_id: templateId, event: 'scenario', next: 'x' },
      x: { type: 'end' },
    },
  };
}

export interface RecipeLike {
  kind: CrmAutoKind;
  delay_hours: number | null;
  subject: string | null;
  template_id: string | null;
  auto_delay_days?: number | null;
  sms?: { enabled: boolean; body: string | null; delay_days: number } | null;
}

/**
 * « Personnaliser » : la recette devient un scénario qui fait la même chose,
 * modifiable (une étape, une condition de plus). Publier le scénario éteint
 * la recette (crm_scenario_publish).
 */
export function recipeToGraph(r: RecipeLike): ScenarioGraph {
  const tpl = r.template_id ?? '';
  const subject = r.subject?.trim() || undefined;
  const h = r.delay_hours ?? 24;
  const mail = (event: 'scenario' | 'for_person', next: string) => ({ type: 'email', template_id: tpl, event, ...(subject ? { subject } : {}), next });
  const end = { x: { type: 'end' } };
  switch (r.kind) {
    case 'new_event':
      return {
        v: 1, trigger: { type: 'event_published' },
        entry: { filter: { op: 'and', items: [noPlace] }, reentry: { mode: 'per_event' }, holdout: true },
        goal: { type: 'bought_event' }, start: 'w1',
        nodes: { w1: { type: 'wait', mode: 'duration', hours: Math.max(1, h), next: 'e1' }, e1: mail('scenario', 'x'), ...end },
      };
    case 'last_call':
      return {
        v: 1, trigger: { type: 'before_event', days: Math.max(1, Math.ceil(h / 24) + 1) },
        entry: { filter: { op: 'and', items: [noPlace] }, reentry: { mode: 'per_event' }, holdout: true },
        goal: { type: 'bought_event' }, start: 'w1',
        nodes: { w1: { type: 'wait', mode: 'until_event', anchor: 'start', hours: -h, next: 'e1' }, e1: mail('scenario', 'x'), ...end },
      };
    case 'click_no_buy':
      return {
        v: 1, trigger: { type: 'click_no_buy', hours: Math.min(72, Math.max(1, h)) },
        entry: { filter: null, reentry: { mode: 'per_event' }, holdout: true },
        goal: { type: 'bought_event' }, start: 'e1',
        nodes: { e1: mail('scenario', 'x'), ...end },
      };
    case 'post_event_thanks':
    case 'post_event_missed':
      return {
        v: 1, trigger: { type: 'after_event', hours: Math.max(1, h), who: r.kind === 'post_event_thanks' ? 'entered' : 'absent_buyers' },
        entry: { filter: null, reentry: { mode: 'per_event' }, holdout: true },
        goal: { type: 'bought_any' }, start: 'e1',
        nodes: { e1: mail('for_person', 'x'), ...end },
      };
    case 'first_return': {
      const days = r.auto_delay_days ?? 21;
      const withSms = !!r.sms?.enabled && !!r.sms.body?.trim();
      return {
        v: 1, trigger: { type: 'after_event', hours: Math.min(720, days * 24), who: 'entered' },
        entry: { filter: { op: 'and', items: [{ k: 'nb', v: '1' }, { k: 'pass', v: 'no' }, { k: 'up', v: 'no' }] }, reentry: { mode: 'once' }, holdout: true },
        goal: { type: 'bought_any' }, start: 'e1',
        nodes: withSms
          ? {
            e1: mail('for_person', 'w1'),
            w1: { type: 'wait', mode: 'duration', hours: (r.sms?.delay_days ?? 5) * 24, next: 's1' },
            s1: { type: 'sms', body: r.sms?.body ?? '', event: 'for_person', next: 'x' },
            ...end,
          }
          : { e1: mail('for_person', 'x'), ...end },
      };
    }
    case 'regular_lapse':
    case 'win_back':
      return {
        v: 1, trigger: { type: 'absence', days: Math.min(730, Math.max(14, Math.round(h / 24))) },
        entry: {
          filter: r.kind === 'regular_lapse' ? { op: 'and', items: [{ k: 'seg', v: 'hab' }] } : null,
          reentry: { mode: 'every_days', days: 120 }, holdout: true,
        },
        goal: { type: 'bought_any' }, start: 'e1',
        nodes: { e1: mail('for_person', 'x'), ...end },
      };
  }
}

/** Un id de nœud libre, court et lisible (« n4k2 »). */
export function newNodeId(taken: Iterable<string>, prefix = 'n'): string {
  const used = new Set(taken);
  for (let i = 0; i < 1000; i += 1) {
    const id = `${prefix}${Math.random().toString(36).slice(2, 6)}`;
    if (!used.has(id)) return id;
  }
  return `${prefix}${Date.now().toString(36)}`;
}
