import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import pros from '@/i18n/locales/admin/modules/pros';
import {
  LIFECYCLE, accountHref, accountKpis, citiesOf, consoleLanding, matchesFilters, parseAccountKey, venueIdFromName,
  DEFAULT_FILTERS, type AccountRow,
} from '../accounts';

const row = (p: Partial<AccountRow>): AccountRow => ({
  key: 'venue:x', type: 'club', ref: 'x', name: 'X', city: 'Paris', products: ['tickets'], status: 'selling', hidden: false, is_demo: false,
  owner_id: null, owner_name: null, owner_email: null, owner_phone: null, created_at: '2026-01-01T00:00:00Z', last_login: null, last_seen: null,
  stripe_ready: true, sales_period: 0, sales_prev: 0, sales_30d: 0, sales_total: 0, revenue_period: 0, revenue_prev: 0, revenue_total: 0,
  last_sale_at: null, upcoming: 0, events_total: 0, crm: null, support: null, note: null, tags: [], ...p,
});

describe('account keys', () => {
  it('parses the three kinds and nothing else', () => {
    expect(parseAccountKey('venue:womber')).toEqual({ kind: 'venue', ref: 'womber' });
    expect(parseAccountKey('org:6f1c')).toEqual({ kind: 'org', ref: '6f1c' });
    expect(parseAccountKey('agency:a1')).toEqual({ kind: 'agency', ref: 'a1' });
    expect(parseAccountKey('venues')).toBeNull();
    expect(parseAccountKey('sales')).toBeNull();
    expect(parseAccountKey('person:1')).toBeNull();
    expect(parseAccountKey('venue:')).toBeNull();
  });
  it('builds the card address', () => {
    expect(accountHref('venue:club 1')).toBe('/admin/pros/venue:club%201');
    expect(accountHref('nope')).toBe('/admin/pros');
  });
  it('derives a club id from its name', () => {
    expect(venueIdFromName('  Le Café Noir ! ')).toBe('le-cafe-noir');
  });
});

describe('filters and figures', () => {
  const rows = [
    row({ key: 'venue:a', city: 'Paris', sales_period: 3, sales_prev: 1, created_at: '2026-11-10T00:00:00Z' }),
    row({ key: 'org:b', type: 'organizer', city: 'paris ', products: ['tickets', 'crm'], status: 'at_risk', sales_prev: 2,
      crm: { state: 'paid', mrr: 24, health: 30, balance: 0, trial_left: null, sync: 'ok', paid: true, granted: false, frozen: false } }),
    row({ key: 'org:c', type: 'association', city: 'Lyon', products: ['crm'], status: 'closed', created_at: '2026-10-20T00:00:00Z' }),
  ];
  it('filters by type, product, status and city', () => {
    expect(rows.filter((r) => matchesFilters(r, { ...DEFAULT_FILTERS, product: 'both' })).map((r) => r.key)).toEqual(['org:b']);
    expect(rows.filter((r) => matchesFilters(r, { ...DEFAULT_FILTERS, product: 'crm' })).length).toBe(2);
    expect(rows.filter((r) => matchesFilters(r, { ...DEFAULT_FILTERS, city: 'Paris' })).length).toBe(2);
    expect(rows.filter((r) => matchesFilters(r, { ...DEFAULT_FILTERS, status: 'closed', type: 'association' })).length).toBe(1);
  });
  it('lists cities by number of accounts, case-insensitive', () => {
    expect(citiesOf(rows)).toEqual(['Paris', 'Lyon']);
  });
  it('computes the five figures against the previous period', () => {
    const k = accountKpis(rows, '2026-11-01T00:00:00Z', '2026-10-01T00:00:00Z');
    expect(k.total).toBe(2);
    expect(k.totalPrev).toBe(1);
    expect(k.selling).toBe(1);
    expect(k.sellingPrev).toBe(2);
    expect(k.newOnes).toBe(1);
    expect(k.newPrev).toBe(1);
    expect(k.atRisk).toBe(1);
    expect(k.paidCrm).toBe(1);
    expect(k.mrr).toBe(24);
  });
  it('lands the assisted session on the right Console', () => {
    expect(consoleLanding({ type: 'club', products: ['tickets'] })).toBe('/owner');
    expect(consoleLanding({ type: 'organizer', products: ['crm'] })).toBe('/crm');
    expect(consoleLanding({ type: 'association', products: ['tickets', 'crm'] })).toBe('/organizer-app');
    expect(consoleLanding({ type: 'agency', products: ['tickets'] })).toBe('/agency-app');
  });
});

/** Toutes les clés `adm.pros.*` écrites dans la rubrique existent, avec leurs variantes dynamiques. */
describe('texts', () => {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) { if (f !== '__tests__') walk(p); } else if (f.endsWith('.tsx') || f.endsWith('.ts')) files.push(p);
    }
  };
  walk(join(__dirname, '..'));
  const src = files.map((f) => readFileSync(f, 'utf8')).join('\n');
  it('has every static key, in three languages, without an em dash', () => {
    const keys = new Set([...src.matchAll(/'(adm\.pros\.[A-Za-z0-9_.]+[A-Za-z0-9_])'/g)].map((m) => m[1]));
    for (const k of keys) expect(pros[k], k).toBeDefined();
    for (const [k, v] of Object.entries(pros)) {
      expect(v.length, k).toBe(3);
      for (const s of v) expect(s.includes('—'), k).toBe(false);
    }
  });
  it('has every dynamic variant', () => {
    const dyn = [
      ...LIFECYCLE.flatMap((s) => [`adm.pros.st.${s}`, `adm.pros.st.${s}.def`]),
      ...['club', 'organizer', 'association', 'agency'].map((x) => `adm.pros.type.${x}`),
      ...['tickets', 'crm', 'both'].map((x) => `adm.pros.product.${x}`),
      ...['type', 'product', 'status', 'city'].map((x) => `adm.pros.filter.${x}`),
      ...['trial', 'paid', 'late', 'churned', 'paused'].map((x) => `adm.pros.crm.${x}`),
      ...['none', 'requested', 'granted', 'declined'].map((x) => `adm.pros.crm.sms.${x}`),
      ...['pending', 'active', 'revoked', 'expired'].map((x) => `adm.pros.sl.grant.${x}`),
      ...['pending', 'accepted', 'expired', 'revoked'].map((x) => `adm.pros.inv.s.${x}`),
      ...['tickets', 'crm', 'founder'].map((x) => `adm.pros.inv.p.${x}`),
      ...['links', 'signup', 'crm'].map((x) => `adm.pros.pr.src.${x}`),
      ...['owner', 'manager', 'admin', 'editor', 'scanner'].map((x) => `adm.pros.role.${x}`),
      ...['added', 'invited', 'gifted', 'grant_ended'].map((x) => `adm.pros.pa.${x}`),
      ...['pending_signatures', 'active', 'locked'].map((x) => `adm.pros.collab.${x}`),
      ...['pending', 'active'].map((x) => `adm.pros.support.${x}`),
    ];
    for (const k of dyn) expect(pros[k], k).toBeDefined();
  });
});
