import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import legalDict from '@/i18n/locales/admin/modules/legal';
import shellDict from '@/i18n/locales/admin/modules/shell';
import { ADMIN_NAV, activeEntry, entryLabelKey } from '../../nav';
import { legacyAdminTarget } from '../../redirects';
import {
  DAC7_MARKERS, dac7Reached, daysUntil, missingDocs, obligations, personHref, proHref, requestDeadline, requestState,
  sellerGaps, sellersCsv, type OverviewPayload, type SellerRow,
} from '../rules';

const V = { terms_pro: '2026-07-06', confidentiality: '2026-07-06', terms_crm: '2026-11-02', dpa: '2026-10-29' };

describe('missingDocs', () => {
  it('asks Tickets pros for pro terms and confidentiality only', () => {
    expect(missingDocs(['suite'], {}, V)).toEqual(['confidentiality', 'terms_pro']);
    expect(missingDocs(['suite'], { terms_pro: { v: '2026-07-06' }, confidentiality: { v: '2026-07-06' } }, V)).toEqual([]);
  });
  it('flags an older version as missing', () => {
    expect(missingDocs(['crm'], { terms_crm: { v: '2026-10-08' }, dpa: { v: '2026-10-29' } }, V)).toEqual(['terms_crm']);
  });
  it('adds the CRM documents for an account with both products', () => {
    expect(missingDocs(['suite', 'crm'], { terms_pro: { v: '2026-07-06' }, confidentiality: { v: '2026-07-06' } }, V)).toEqual(['dpa', 'terms_crm']);
  });
});

describe('requestDeadline', () => {
  it('is one month after reception, plus the extension', () => {
    expect(requestDeadline('2026-11-16T10:00:00Z').toISOString().slice(0, 10)).toBe('2026-12-16');
    expect(requestDeadline('2026-11-16T10:00:00Z', 2).toISOString().slice(0, 10)).toBe('2027-02-16');
  });
  it('keeps the last day of a shorter month', () => {
    expect(requestDeadline('2026-01-31T10:00:00Z').toISOString().slice(0, 10)).toBe('2026-02-28');
  });
});

describe('requestState and daysUntil', () => {
  const now = Date.parse('2026-11-16T12:00:00Z');
  it('is late once the deadline passed on an open request', () => {
    expect(requestState({ closed: false, deadline: '2026-11-10T00:00:00Z' }, now)).toBe('late');
    expect(requestState({ closed: false, deadline: '2026-12-10T00:00:00Z' }, now)).toBe('todo');
    expect(requestState({ closed: true, deadline: '2026-11-10T00:00:00Z' }, now)).toBe('ok');
  });
  it('counts full days, negative when passed', () => {
    expect(daysUntil('2026-11-20T12:00:00Z', now)).toBe(4);
    expect(daysUntil('2026-11-14T12:00:00Z', now)).toBe(-2);
    expect(daysUntil(null, now)).toBeNull();
  });
});

describe('obligations', () => {
  const base: OverviewPayload = {
    requests: { open: 0, overdue: 0, next: null }, incidents: { open: 0, cnil_pending: 0, overdue: 0, next: null },
    terms: { pros: 10, missing: 0 }, sellers: { with_stripe: 3, incomplete: 0 },
    support: { grants: 0, sessions: 0 }, reports: { pending: 0, total: 0 },
  };
  it('is all compliant on an empty payload', () => {
    expect(obligations(base).every((o) => o.state === 'ok')).toBe(true);
  });
  it('marks overdue requests late and open accesses to handle', () => {
    const o = obligations({ ...base, requests: { open: 2, overdue: 1, next: null }, support: { grants: 3, sessions: 1 } });
    expect(o.find((x) => x.id === 'requests')?.state).toBe('late');
    expect(o.find((x) => x.id === 'support')).toMatchObject({ state: 'todo', count: 4 });
  });
  it('every obligation leads to a page', () => {
    for (const o of obligations(base)) expect(o.path.startsWith('/admin/')).toBe(true);
  });
});

describe('sellers', () => {
  const s: SellerRow = {
    key: 'org:1', kind: 'organizer', name: 'Amoris', email: null, is_demo: false, legal_name: null, siret: null, rna: null,
    vat_number: null, legal_address: null, vat_regime: null, vat_rate: 20, stripe_account: true, charges: true, payouts: true,
    sales: 29, amount: 1999.99, invoiced: 29, missing_invoices: 0, invoices_issued: 29,
  };
  it('reads the DAC7 markers as « either »', () => {
    expect(DAC7_MARKERS).toEqual({ sales: 30, amount: 2000 });
    expect(dac7Reached(s)).toBe(false);
    expect(dac7Reached({ ...s, sales: 30 })).toBe(true);
    expect(dac7Reached({ ...s, amount: 2000 })).toBe(true);
  });
  it('lists the missing fields, never more', () => {
    expect(sellerGaps(s)).toEqual(['legal_name', 'id', 'address', 'vat']);
    expect(sellerGaps({ ...s, legal_name: 'X', rna: 'W1', legal_address: 'a', vat_regime: 'subject' })).toEqual([]);
    expect(sellerGaps({ ...s, kind: 'club', legal_name: 'X', siret: '1', legal_address: 'a', charges: false })).toEqual(['stripe']);
  });
  it('exports a CSV that escapes separators', () => {
    const csv = sellersCsv([{ ...s, name: 'A; B "C"' }], 2026).split('\r\n');
    expect(csv[0].split(';')[0]).toBe('year');
    expect(csv[1]).toContain('"A; B ""C"""');
    expect(csv[1].endsWith(';no;no')).toBe(true);
  });
});

describe('links', () => {
  it('opens the lot 2 account file and the lot 3 person file', () => {
    expect(proHref('venue:abc')).toBe('/admin/pros/venue:abc');
    expect(proHref('org:00000000-0000-0000-0000-000000000000')).toBe('/admin/pros/org:00000000-0000-0000-0000-000000000000');
    expect(proHref('nope')).toBeNull();
    expect(personHref(' Jo@Ex.com ')).toBe('/admin/clients/jo%40ex.com');
    expect(personHref('')).toBeNull();
  });
});

describe('menu and addresses', () => {
  const legal = ADMIN_NAV.find((r) => r.id === 'legal');
  it('has the ten entries in order', () => {
    expect(legal?.entries.map((e) => e.key)).toEqual(['overview', 'requests', 'consents', 'terms', 'sellers', 'incidents', 'reports', 'documents', 'audit']);
  });
  it('labels every entry in three languages', () => {
    for (const e of legal?.entries ?? []) expect(shellDict[entryLabelKey('legal', e.key)]).toHaveLength(3);
  });
  it('lights the right entry', () => {
    expect(activeEntry('/admin/legal').entry?.key).toBe('overview');
    expect(activeEntry('/admin/legal/sellers').entry?.key).toBe('sellers');
  });
  it('keeps the old legal addresses alive', () => {
    expect(legacyAdminTarget('/admin/crm/legal')).toBe('/admin/legal');
    expect(legacyAdminTarget('/admin/audit')).toBe('/admin/legal/audit');
  });
});

describe('texts', () => {
  const dir = join(__dirname, '..');
  const src = readdirSync(dir).filter((f) => /\.tsx?$/.test(f)).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');

  it('every static key used by the pages exists', () => {
    const used = [...src.matchAll(/'(adm\.lg2\.[A-Za-z0-9_.]+)'/g)].map((m) => m[1]);
    const missing = [...new Set(used)].filter((k) => !(k in legalDict));
    expect(missing).toEqual([]);
  });

  it('every templated key family is complete', () => {
    const fams: [string, string[]][] = [
      ['adm.lg2.state', ['ok', 'todo', 'late']],
      ['adm.lg2.ob', ['requests', 'incidents', 'terms', 'sellers', 'support', 'reports']],
      ['adm.lg2.rq.kind', ['access', 'erasure', 'objection', 'rectification', 'portability', 'other']],
      ['adm.lg2.rq.status', ['open', 'in_progress', 'done', 'refused']],
      ['adm.lg2.rq.src', ['manual', 'account_deleted', 'meta', 'ticketing_erasure', 'crm_erasure']],
      ['adm.lg2.rp.decision', ['pending', 'removed', 'restricted', 'no_action']],
      ['adm.lg2.rp.kind', ['event', 'pro', 'content', 'other']],
      ['adm.lg2.in.product', ['tickets', 'crm', 'both']],
      ['adm.lg2.product', ['tickets', 'crm', 'platform']],
      ['adm.lg2.au.src', ['all', 'admin', 'support', 'agent']],
      ['adm.lg2.sl.gap', ['legal_name', 'id', 'address', 'vat', 'stripe']],
      ['adm.lg2.doc', ['cgu', 'cgv_users', 'terms_pro', 'confidentiality', 'demo_confidentiality', 'privacy', 'terms_crm', 'dpa']],
    ];
    const missing = fams.flatMap(([p, ks]) => ks.map((k) => `${p}.${k}`)).filter((k) => !(k in legalDict));
    expect(missing).toEqual([]);
    for (const k of ['requests', 'incidents', 'terms', 'sellers', 'support', 'reports']) expect(`adm.lg2.ob.${k}.src` in legalDict).toBe(true);
  });

  it('never uses an em dash', () => {
    const bad = Object.entries(legalDict).filter(([, v]) => v.some((s) => s.includes('—'))).map(([k]) => k);
    expect(bad).toEqual([]);
  });
});
