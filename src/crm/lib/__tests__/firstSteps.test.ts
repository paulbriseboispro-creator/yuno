import { describe, expect, it } from 'vitest';
import {
  AUTO_SHOW_DAYS, CORE_STEPS, allCoreDone, autoShow, buildSteps, canOpenGuide, emailHref, founderUntil,
  nextStep, onStepPage, progressOf, stepAfter, type FirstStepsData,
} from '../firstSteps';

const NOW = '2026-10-19T12:00:00Z';

function fresh(over: Partial<FirstStepsData['steps']> = {}, rest: Partial<FirstStepsData> = {}): FirstStepsData {
  return {
    now: NOW,
    steps: {
      shotgun: { done: false, state: 'off', org: null, tickets: null, events: null, buyers: null },
      identity: { done: false, missing: ['sender_name', 'legal_name', 'postal_address'] },
      email: { done: false, n: 0, draft: null },
      automation: { done: false, recipes: 0, scenarios: 0 },
      claude: { done: false },
      segments: { done: false, n: 0 },
      team: { done: false, n: 0 },
      ...over,
    },
    outcome: null,
    next_night: null,
    offer: { status: 'trialing', offer: 'founder', offer_until: '2027-04-19T00:00:00Z', trial_ends_at: '2027-04-19T00:00:00Z' },
    opened_at: '2026-10-19T09:00:00Z',
    yunits: 15000,
    holder: { is_me: true, first_name: 'Jules' },
    pref: { dismissed_at: null, snoozed_until: null, finished_at: null },
    ...rest,
  };
}

const HOLDER = { holder: true, write: true };
const EDITOR = { holder: false, write: true };

describe('étapes', () => {
  it('cinq étapes dans la barre, Shotgun en premier', () => {
    expect(CORE_STEPS).toEqual(['shotgun', 'identity', 'email', 'automation', 'claude']);
    const steps = buildSteps(fresh(), HOLDER);
    expect(steps.filter((s) => s.core)).toHaveLength(5);
    expect(steps.filter((s) => !s.core).map((s) => s.key)).toEqual(['segments', 'team']);
  });

  it('« Votre espace est ouvert » est offerte : 1 sur 6 au premier jour', () => {
    expect(progressOf(buildSteps(fresh(), HOLDER))).toEqual({ done: 1, total: 6 });
  });

  it('un import Shotgun en cours compte comme branché', () => {
    const steps = buildSteps(fresh({ shotgun: { done: true, state: 'importing', org: '3AM', tickets: 120, events: 2, buyers: null } }), HOLDER);
    expect(steps[0].status).toBe('running');
    expect(progressOf(steps).done).toBe(2);
    expect(nextStep(steps)?.key).toBe('identity');
  });

  it('une connexion cassée reste à refaire', () => {
    const steps = buildSteps(fresh({ shotgun: { done: false, state: 'broken', org: '3AM', tickets: null, events: null, buyers: null } }), HOLDER);
    expect(steps[0].status).toBe('broken');
    expect(nextStep(steps)?.key).toBe('shotgun');
  });

  it('les étapes facultatives ne comptent pas dans la barre', () => {
    const steps = buildSteps(fresh({ segments: { done: true, n: 4 }, team: { done: true, n: 1 } }), HOLDER);
    expect(progressOf(steps).done).toBe(1);
  });

  it('tout fait : 6 sur 6, plus de prochaine étape', () => {
    const d = fresh({
      shotgun: { done: true, state: 'on', org: '3AM', tickets: 1200, events: 2, buyers: 900 },
      identity: { done: true, missing: [] },
      email: { done: true, n: 1, draft: null },
      automation: { done: true, recipes: 1, scenarios: 0 },
      claude: { done: true },
    });
    const steps = buildSteps(d, HOLDER);
    expect(progressOf(steps)).toEqual({ done: 6, total: 6 });
    expect(allCoreDone(steps)).toBe(true);
    expect(nextStep(steps)).toBeNull();
  });
});

describe('qui fait quoi', () => {
  it('un membre de l’équipe ne branche pas Shotgun : sa prochaine étape est la suivante', () => {
    const steps = buildSteps(fresh(), EDITOR);
    expect(steps[0].notMine).toBe(true);
    expect(nextStep(steps)?.key).toBe('identity');
  });

  it('un membre de l’équipe qui n’a plus que l’étape du titulaire la voit quand même', () => {
    const d = fresh({
      identity: { done: true, missing: [] }, email: { done: true, n: 1, draft: null },
      automation: { done: true, recipes: 1, scenarios: 0 }, claude: { done: true },
    });
    expect(nextStep(buildSteps(d, EDITOR))?.key).toBe('shotgun');
  });

  it('l’étape suivante saute ce qui est fait et ce qui n’est pas à soi', () => {
    const steps = buildSteps(fresh({ identity: { done: true, missing: [] } }), EDITOR);
    expect(stepAfter(steps, 'shotgun')?.key).toBe('email');
    expect(stepAfter(steps, 'claude')?.key).toBe('email');
  });

  it('un lecteur n’ouvre pas le guide', () => {
    expect(canOpenGuide({ holder: false, write: false })).toBe(false);
    expect(canOpenGuide(EDITOR)).toBe(true);
  });
});

describe('liens', () => {
  it('Shotgun à brancher ouvre l’assistant, branché la page Connecteurs', () => {
    expect(buildSteps(fresh(), HOLDER)[0].href).toBe('/crm/connectors?v=wizard&s=1');
    expect(buildSteps(fresh({ shotgun: { done: true, state: 'on', org: null, tickets: 1, events: 1, buyers: 1 } }), HOLDER)[0].href).toBe('/crm/connectors');
  });

  it('le premier e-mail part de la prochaine soirée, ou reprend le brouillon', () => {
    const night = { id: 'ev-1', title: 'Act III', start_at: '2026-11-14T22:00:00Z', days_to: 26 };
    expect(emailHref(fresh({}, { next_night: night }))).toBe('/crm/emails/templates?event=ev-1');
    expect(emailHref(fresh())).toBe('/crm/emails/templates');
    expect(emailHref(fresh({ email: { done: false, n: 0, draft: { id: 'c-1', name: 'Act III', updated_at: NOW } } }))).toBe('/crm/emails/studio/c-1');
  });

  it('la carte d’aide d’une étape se montre sur ses pages seulement', () => {
    expect(onStepPage('shotgun', '/crm/connectors')).toBe(true);
    expect(onStepPage('email', '/crm/emails/templates')).toBe(true);
    expect(onStepPage('identity', '/crm/emails/settings/')).toBe(true);
    expect(onStepPage('identity', '/crm/emails')).toBe(false);
    expect(onStepPage('team', '/crm/account/team')).toBe(true);
    expect(onStepPage('automation', '/crm/clients')).toBe(false);
  });
});

describe('quand le guide se montre de lui-même', () => {
  const ctx = { holder: true, write: true, passive: false };

  it('au titulaire d’un compte neuf', () => {
    expect(autoShow(fresh(), ctx)).toBe(true);
  });

  it('jamais à l’équipe, jamais en aperçu ni en accès assisté', () => {
    expect(autoShow(fresh(), { ...ctx, holder: false })).toBe(false);
    expect(autoShow(fresh(), { ...ctx, passive: true })).toBe(false);
  });

  it('masqué ou terminé : il ne revient pas tout seul', () => {
    expect(autoShow(fresh({}, { pref: { dismissed_at: NOW, snoozed_until: null, finished_at: null } }), ctx)).toBe(false);
    expect(autoShow(fresh({}, { pref: { dismissed_at: null, snoozed_until: null, finished_at: NOW } }), ctx)).toBe(false);
  });

  it('reporté : il revient le lendemain', () => {
    const d = fresh({}, { pref: { dismissed_at: null, snoozed_until: '2026-10-20T04:00:00Z', finished_at: null } });
    expect(autoShow(d, ctx)).toBe(false);
    expect(autoShow(d, { ...ctx, now: new Date('2026-10-20T05:00:00Z') })).toBe(true);
  });

  it(`pas sur un compte de plus de ${AUTO_SHOW_DAYS} jours`, () => {
    expect(autoShow(fresh({}, { opened_at: '2026-07-22T17:00:00Z' }), ctx)).toBe(false);
  });
});

describe('offre fondateur', () => {
  it('se dit tant qu’elle court', () => {
    expect(founderUntil(fresh())).toBe('2027-04-19T00:00:00Z');
    expect(founderUntil(fresh(), new Date('2027-05-01T00:00:00Z'))).toBeNull();
    expect(founderUntil(fresh({}, { offer: { status: 'active', offer: null, offer_until: null, trial_ends_at: null } }))).toBeNull();
  });
});
