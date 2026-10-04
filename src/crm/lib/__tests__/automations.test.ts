import { describe, expect, it } from 'vitest';
import {
  autoState, bestPerPerson, delayParts, periodDelta, quietSendAt, receivedSubject, runwayWeeks, weeklyYunits,
} from '@/crm/lib/automations';

describe('automatisations CRM', () => {
  it('lit un délai dans la bonne unité', () => {
    expect(delayParts('new_event', 6)).toEqual({ n: 6, unit: 'h' });
    expect(delayParts('last_call', 48)).toEqual({ n: 2, unit: 'd' });
    expect(delayParts('regular_lapse', 1008)).toEqual({ n: 6, unit: 'w' });
    expect(delayParts('win_back', 2160)).toEqual({ n: 90, unit: 'd' });
  });

  it('distingue allumée, en pause, réglée et à créer', () => {
    expect(autoState({ id: null, enabled: false, enabled_at: null })).toBe('none');
    expect(autoState({ id: 'a', enabled: true, enabled_at: '2026-01-01' })).toBe('on');
    expect(autoState({ id: 'a', enabled: false, enabled_at: '2026-01-01' })).toBe('off');
    expect(autoState({ id: 'a', enabled: false, enabled_at: null })).toBe('ready');
  });

  it('compte les Yunits des seules recettes allumées', () => {
    const w = weeklyYunits([{ enabled: true, week_avg: 300 }, { enabled: false, week_avg: 50 }, { enabled: true, week_avg: 7.5 }], 1);
    expect(w).toBe(307.5);
    expect(runwayWeeks(1000, 250)).toBe(4);
    expect(runwayWeeks(1000, 0)).toBeNull();
    expect(runwayWeeks(-20, 10)).toBe(0);
  });

  it('ne désigne une recette rentable qu’à partir de 30 personnes', () => {
    const rows = [
      { kind: 'new_event' as const, contacted: 400, purchases: 30, revenue: 480 },
      { kind: 'last_call' as const, contacted: 300, purchases: 29, revenue: 600 },
      { kind: 'win_back' as const, contacted: 10, purchases: 5, revenue: 900 },
    ];
    expect(bestPerPerson(rows, true)?.r.kind).toBe('last_call');
    expect(bestPerPerson(rows, false)?.r.kind).toBe('last_call');
    expect(bestPerPerson([{ kind: 'new_event' as const, contacted: 100, purchases: 0, revenue: 0 }], true)).toBeNull();
  });

  it('compare deux périodes', () => {
    expect(periodDelta(10, 0)).toBeNull();
    expect(periodDelta(150, 100)).toEqual({ stable: false, up: true, pct: 50 });
    expect(periodDelta(69, 100)).toEqual({ stable: false, up: false, pct: 31 });
    expect(periodDelta(1001, 1000)?.stable).toBe(true);
  });

  it('montre l’objet tel que la personne l’a reçu', () => {
    expect(receivedSubject('Ça fait longtemps, {{prénom}}', 'Malo')).toBe('Ça fait longtemps, Malo');
    expect(receivedSubject('{{ prenom }}, la prévente ouvre', 'Léa')).toBe('Léa, la prévente ouvre');
    expect(receivedSubject('Merci pour hier soir', null)).toBe('Merci pour hier soir');
    expect(receivedSubject('{{inconnue}} reste visible', 'Tom')).toBe('{{inconnue}} reste visible');
  });

  it('repousse un envoi des heures calmes à 9 h, heure de Paris', () => {
    // 23 h à Paris (été, UTC+2) : part le lendemain à 9 h.
    expect(quietSendAt('2026-10-09T21:00:00Z').toISOString()).toBe('2026-10-10T07:00:00.000Z');
    // 5 h à Paris : part le jour même à 9 h.
    expect(quietSendAt('2026-10-10T03:00:00Z').toISOString()).toBe('2026-10-10T07:00:00.000Z');
    // Hiver (UTC+1), fin de mois : 23 h 30 le 31 → 1er à 9 h.
    expect(quietSendAt('2026-12-31T22:30:00Z').toISOString()).toBe('2027-01-01T08:00:00.000Z');
    // En journée : inchangé.
    expect(quietSendAt('2026-10-10T15:00:00Z').toISOString()).toBe('2026-10-10T15:00:00.000Z');
    // 9 h pile : déjà permis.
    expect(quietSendAt('2026-10-10T07:00:00Z').toISOString()).toBe('2026-10-10T07:00:00.000Z');
  });
});
