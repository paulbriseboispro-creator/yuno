import { describe, expect, it } from 'vitest';
import {
  ago, atRisk, blockedStep, buildTodo, countStates, healthTone, matchesFilter, maskEmail, searchAccounts, sortAccounts, topBlocker,
  type AdminAccount,
} from '../admin';

const base: AdminAccount = {
  id: 'org:1', kind: 'org', venue_id: null, organizer_user_id: '1', name: 'Le Bunker', city: 'Paris', type: 'club', contact: 'Nina S.', email: 'nina@lebunker.fr',
  phone: null, state: 'paid', sub_status: 'active', interval: 'month', founder: true, trial_ends_at: null, trial_left: null, period_end: null, cancel_at_end: false,
  paid: true, granted: false, signup_at: '2026-09-01T00:00:00Z', sub_created: null, mrr: 24, provider: 'shotgun', conn_status: 'active', sync: 'ok', sync_at: null,
  sync_error: null, sync_error_at: null, contacts: 100, reach: 80, sends30: 3, last_send_at: '2026-10-03T00:00:00Z', balance: 8000, buys: 0, buys_eur: 0,
  last_buy_at: null, last_login: null, source: null, ob: [true, true, true, true, true, true, true], recipes: 3, team: 1, health: 90, h: [40, 30, 15, 15],
  frozen_at: null, frozen_reason: null, deletion_requested_at: null, is_demo: false,
};
const a = (o: Partial<AdminAccount>): AdminAccount => ({ ...base, ...o });
const NOW = new Date('2026-10-04T12:00:00Z').getTime();

describe('admin CRM : santé et filtres', () => {
  it('range la santé en trois tons', () => {
    expect([95, 80, 79, 60, 59, 0].map(healthTone)).toEqual(['good', 'good', 'mid', 'mid', 'bad', 'bad']);
  });
  it('un résilié n’est jamais « à risque »', () => {
    expect(atRisk(a({ health: 0, state: 'churned' }))).toBe(false);
    expect(atRisk(a({ health: 44, state: 'paused' }))).toBe(true);
    expect(atRisk(a({ health: 60 }))).toBe(false);
  });
  it('compte les statuts et filtre', () => {
    const rows = [a({}), a({ id: 'b', state: 'trial', health: 30 }), a({ id: 'c', state: 'late' }), a({ id: 'd', state: 'churned', health: 0 }), a({ id: 'e', state: 'paused', health: 40 })];
    expect(countStates(rows)).toEqual({ all: 5, paid: 1, trial: 1, late: 1, risk: 2, off: 2 });
    expect(rows.filter((r) => matchesFilter(r, 'off')).map((r) => r.id)).toEqual(['d', 'e']);
  });
  it('trie et cherche', () => {
    const rows = [a({ id: 'x', name: 'B', health: 50, contacts: 5 }), a({ id: 'y', name: 'A', health: 10, contacts: 9 })];
    expect(sortAccounts(rows, 'health').map((r) => r.id)).toEqual(['y', 'x']);
    expect(sortAccounts(rows, 'size').map((r) => r.id)).toEqual(['y', 'x']);
    expect(searchAccounts(rows, 'paris').length).toBe(2);
    expect(searchAccounts(rows, 'zzz').length).toBe(0);
  });
  it('masque une adresse', () => {
    expect(maskEmail('evan.dupont@gmail.com')).toBe('ev•••@gmail.com');
    expect(maskEmail(null)).toBeNull();
  });
});

describe('admin CRM : à faire aujourd’hui', () => {
  it('relève un essai qui finit sans billetterie, une synchro en erreur, un retard de paiement', () => {
    const t = buildTodo([
      a({ id: 'a', state: 'trial', trial_left: 2, sync: 'none' }),
      a({ id: 'b', sync: 'error', sync_error_at: '2026-10-01T12:00:00Z' }),
      a({ id: 'c', state: 'late' }),
      a({ id: 'd', state: 'churned' }),
    ], NOW);
    expect(t.map((x) => x.kind).sort()).toEqual(['late', 'sync_error', 'trial_no_conn']);
    expect(t.find((x) => x.kind === 'sync_error')?.n).toBe(3);
    expect(t.every((x) => x.sev === 'red')).toBe(true);
  });
  it('un payant qui n’envoie plus depuis 30 jours passe en orange ; un solde vide aussi', () => {
    const t = buildTodo([a({ id: 'a', last_send_at: '2026-08-20T00:00:00Z' }), a({ id: 'b', balance: 100 })], NOW);
    expect(t.map((x) => `${x.account.id}:${x.kind}`).sort()).toEqual(['a:silent_paid', 'b:low_yunits']);
  });
  it('trie du plus urgent au moins urgent', () => {
    const t = buildTodo([a({ id: 'a', balance: 10 }), a({ id: 'b', state: 'late' }), a({ id: 'c', frozen_at: '2026-10-01T00:00:00Z' })], NOW);
    expect(t.map((x) => x.sev)).toEqual(['red', 'amber', 'grey']);
  });
});

describe('admin CRM : onboarding', () => {
  it('l’étape bloquante est la première non faite', () => {
    expect(blockedStep([true, true, false, true, false, false, false])).toBe(2);
    expect(blockedStep([true, true, true, true, true, true, true])).toBeNull();
  });
  it('le point de blocage n°1 est l’étape qui retient le plus de comptes', () => {
    const rows = [a({ ob: [true, false, false, false, false, false, false] }), a({ ob: [true, false, false, false, false, false, false] }), a({ ob: [true, true, false, false, false, false, false] })];
    expect(topBlocker(rows)).toEqual({ step: 1, n: 2 });
    expect(topBlocker([a({})])).toBeNull();
  });
});

describe('admin CRM : relatif', () => {
  it('découpe en minutes, heures, jours', () => {
    expect(ago('2026-10-04T11:59:00Z', NOW)).toEqual({ unit: 'now', n: 1 });
    expect(ago('2026-10-04T11:30:00Z', NOW)).toEqual({ unit: 'min', n: 30 });
    expect(ago('2026-10-04T09:00:00Z', NOW)).toEqual({ unit: 'h', n: 3 });
    expect(ago('2026-10-01T12:00:00Z', NOW)).toEqual({ unit: 'd', n: 3 });
    expect(ago(null, NOW)).toEqual({ unit: 'never', n: 0 });
  });
});
