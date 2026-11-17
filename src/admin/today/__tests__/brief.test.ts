import { describe, expect, it } from 'vitest';
import { brief, subjectAccountKey } from '../brief';
import type { TodayItem } from '../queue';

const item = (key: string, urgency: 1 | 2 | 3, mark: TodayItem['mark'] = null): TodayItem => ({
  family: 'lead', kind: 'lead', key, name: 'X', subject_kind: null, subject_id: null, detail: null,
  at: null, due_at: null, urgency, href: '/admin', params: null, mark,
});
const eur = (v: number) => `${v} €`;

describe('brief du jour', () => {
  it('file vide, rien hier, tout tourne', () => {
    const p = brief({ items: [], yesterdaySales: 0, yesterdayAccounts: 0, lights: [{ label: 'Paiements', tone: 'positive' }], fmtEur: eur });
    expect(p.map((x) => x.key)).toEqual(['adm.today.b.none', 'adm.today.b.yNoSales', 'adm.today.b.acc0', 'adm.today.b.allGood']);
  });
  it('compte les décisions ouvertes et les urgentes, ignore les traitées', () => {
    const p = brief({ items: [item('a', 1), item('b', 1), item('c', 2), item('d', 1, { status: 'done', until: null, at: '', reason: null })], yesterdaySales: 612, yesterdayAccounts: 2, lights: null, fmtEur: eur });
    expect(p[0]).toEqual({ key: 'adm.today.b.many', vars: { n: 3 } });
    expect(p[1]).toEqual({ key: 'adm.today.b.uN', vars: { u: 2 } });
    expect(p[2]).toEqual({ key: 'adm.today.b.ySales', vars: { sales: '612 €' } });
    expect(p[3]).toEqual({ key: 'adm.today.b.accN', vars: { n: 2 } });
  });
  it('nomme ce qu\'il faut surveiller', () => {
    const p = brief({ items: [item('a', 3)], yesterdaySales: null, yesterdayAccounts: null, lights: [{ label: 'E-mail', tone: 'warning' }, { label: 'Apps', tone: 'positive' }], fmtEur: eur });
    expect(p.map((x) => x.key)).toEqual(['adm.today.b.one', 'adm.today.b.u0', 'adm.today.b.watch']);
    expect(p[2].vars).toEqual({ what: 'E-mail' });
  });
  it('clé de fiche d\'un sujet', () => {
    expect(subjectAccountKey('venue', 'v1')).toBe('venue:v1');
    expect(subjectAccountKey('crm', 'org:u1')).toBe('org:u1');
    expect(subjectAccountKey('crm', 'abc')).toBeNull();
    expect(subjectAccountKey('person', 'u1')).toBeNull();
  });
});
