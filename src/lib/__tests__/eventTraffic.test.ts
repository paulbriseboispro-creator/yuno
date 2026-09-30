import { describe, expect, it } from 'vitest';
import {
  biggestLeak, buildStages, failureLabelKey, formatDuration, overallStages, pillarStages, visitConversion, withConversion,
} from '../eventTraffic';

const funnel = { tracked: true, sessions: 400, selected: 180, checkout: 120, details: 60, purchased: 52, failedOpen: 3 };

describe('tunnel d’achat', () => {
  it('chaque étape dit la part de la précédente et de la première', () => {
    const s = overallStages(funnel);
    expect(s.map((x) => x.count)).toEqual([400, 180, 120, 60, 52]);
    expect(s[0]).toMatchObject({ ofPrev: null, ofTop: 100, lost: 0 });
    expect(s[1]).toMatchObject({ ofPrev: 45, ofTop: 45, lost: 220 });
    expect(s[3]).toMatchObject({ ofPrev: 50, lost: 60 });
    expect(s[4]).toMatchObject({ ofTop: 13, lost: 8 });
  });

  it('une étape vide ne divise pas par zéro', () => {
    const s = buildStages([{ key: 'selected', count: 0 }, { key: 'checkout', count: 0 }]);
    expect(s[1].ofPrev).toBeNull();
    expect(s[1].ofTop).toBeNull();
  });

  it('le tunnel d’un pilier part du choix ; la guest list n’a pas d’étape « coordonnées »', () => {
    const t = pillarStages({ pillar: 'tickets', selected: 100, checkout: 80, details: 60, purchased: 50 });
    expect(t.map((x) => x.key)).toEqual(['selected', 'checkout', 'details', 'purchased']);
    const g = pillarStages({ pillar: 'guest_list', selected: 40, checkout: 35, details: 0, purchased: 30 });
    expect(g.map((x) => x.key)).toEqual(['selected', 'checkout', 'purchased']);
  });
});

describe('plus grosse fuite', () => {
  it('prend l’étape qui perd le plus de monde après le choix', () => {
    const leak = biggestLeak(overallStages(funnel));
    expect(leak).toEqual({ at: 'details', lost: 60, lostPct: 50 });
  });

  it('ne traite pas « vu sans rien choisir » comme une fuite quand une autre étape perd', () => {
    expect(biggestLeak(overallStages(funnel))?.at).not.toBe('selected');
  });

  it('se tait sous 10 personnes perdues', () => {
    const small = overallStages({ tracked: true, sessions: 12, selected: 10, checkout: 8, details: 6, purchased: 5, failedOpen: 0 });
    expect(biggestLeak(small)).toBeNull();
  });
});

describe('conversion et lignes', () => {
  it('une conversion se lit au dixième et se tait sous 10 visites', () => {
    expect(visitConversion(4, 1000)).toBe(0.4);
    expect(visitConversion(3, 9)).toBeNull();
  });

  it('une source ou un appareil ne donne sa conversion qu’à partir de 10 sessions suivies', () => {
    const rows = withConversion([
      { source: 'social', visits: 300, sessions: 120, checkout: 40, purchased: 18 },
      { source: 'email', visits: 20, sessions: 6, checkout: 3, purchased: 2 },
    ], (r) => r.source);
    expect(rows[0].conversion).toBe(15);
    expect(rows[1].conversion).toBeNull();
  });
});

describe('motifs de refus et durées', () => {
  it('un code inconnu devient « autre raison »', () => {
    expect(failureLabelKey('sold_out')).toBe('evl.fail.sold_out');
    expect(failureLabelKey('stripe_exploded')).toBe('evl.fail.other');
  });

  it('écrit les durées médianes', () => {
    const u = { min: 'min', sec: 's' };
    expect(formatDuration(45, u)).toBe('45 s');
    expect(formatDuration(120, u)).toBe('2 min');
    expect(formatDuration(125, u)).toBe('2 min 05');
  });
});
