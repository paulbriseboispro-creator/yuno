import { describe, expect, it } from 'vitest';
import {
  announceBounds, campaignCost, fromLocalInput, stepState, tapRate, timelineFor, toLocalInput,
  type PushCenterEvent, type PushCenterStep,
} from '../pushEngine';

const step = (over: Partial<PushCenterStep> = {}): PushCenterStep => ({
  rule: 'new_event', sent: 0, taps: 0, buyers: 0, entries: 0, influenced: 0, revenue: null,
  queued: 0, nextAt: null, held: 0, boughtBefore: 0, lastAt: null, ...over,
});
const NOW = new Date('2026-10-01T12:00:00Z');

describe('stepState', () => {
  it('envoyée dès qu’au moins une notification est partie', () => {
    expect(stepState(step({ sent: 3, queued: 10 }), NOW)).toBe('sent');
  });
  it('programmée si l’envoi est pour plus tard, en cours sinon', () => {
    expect(stepState(step({ queued: 5, nextAt: '2026-10-02T18:00:00Z' }), NOW)).toBe('scheduled');
    expect(stepState(step({ queued: 5, nextAt: '2026-10-01T11:00:00Z' }), NOW)).toBe('sending');
  });
  it('retenue quand la politique a tout gardé, à venir sans rien', () => {
    expect(stepState(step({ held: 4 }), NOW)).toBe('held');
    expect(stepState(undefined, NOW)).toBe('upcoming');
  });
});

describe('timelineFor', () => {
  const base: Pick<PushCenterEvent, 'upcoming' | 'announced' | 'steps' | 'visibility'> = {
    upcoming: true, announced: false, steps: [], visibility: 'public',
  };
  const all = () => true;
  it('une soirée à venir montre l’annonce, le jour J et le merci', () => {
    expect(timelineFor(base, all, NOW).map((i) => i.rule)).toEqual(['new_event', 'event_day_reminder', 'after_thanks']);
  });
  it('une soirée privée n’a pas d’annonce', () => {
    expect(timelineFor({ ...base, visibility: 'private' }, all, NOW).map((i) => i.rule)).toEqual(['event_day_reminder', 'after_thanks']);
  });
  it('les étapes qui ont eu lieu s’ajoutent dans l’ordre du cycle de vie', () => {
    const ev = { ...base, announced: true, steps: [step({ rule: 'last_tickets', sent: 12 }), step({ rule: 'new_event', sent: 80 })] };
    expect(timelineFor(ev, all, NOW).map((i) => i.rule)).toEqual(['new_event', 'last_tickets', 'event_day_reminder', 'after_thanks']);
  });
  it('une règle coupée par Yuno disparaît… sauf si elle a déjà envoyé', () => {
    const off = (k: string) => k !== 'after_thanks';
    expect(timelineFor(base, off, NOW).map((i) => i.rule)).not.toContain('after_thanks');
    const past = { upcoming: false, announced: true, visibility: 'public', steps: [step({ rule: 'after_thanks', sent: 5 })] };
    expect(timelineFor(past, off, NOW).map((i) => i.rule)).toEqual(['after_thanks']);
  });
});

describe('petits calculs', () => {
  it('taux d’ouverture arrondi, null sans envoi', () => {
    expect(tapRate(3, 40)).toBe(8);
    expect(tapRate(0, 0)).toBeNull();
  });
  it('une campagne marketing coûte un crédit, l’info soirée est gratuite', () => {
    expect(campaignCost('followers')).toBe(1);
    expect(campaignCost('segment:abc')).toBe(1);
    expect(campaignCost('event_tickets')).toBe(0);
    expect(campaignCost('checked_in')).toBe(0);
  });
  it('datetime-local aller-retour', () => {
    const iso = '2026-10-02T16:00:00.000Z';
    expect(fromLocalInput(toLocalInput(iso))).toBe(iso);
    expect(fromLocalInput('')).toBeNull();
  });
  it('l’annonce se programme au plus tard 3 h avant la soirée', () => {
    const b = announceBounds('2026-10-01T20:00:00Z', NOW);
    expect(fromLocalInput(b.max)).toBe('2026-10-01T17:00:00.000Z');
  });
});
