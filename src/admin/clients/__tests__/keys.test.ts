import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ADMIN_DICT } from '@/i18n/locales/admin/modules';

/** Chaque texte que les pages Clients demandent existe en trois langues. */
describe('clients i18n keys', () => {
  const dir = join(__dirname, '..');
  const src = readdirSync(dir).filter((f) => f.endsWith('.tsx')).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
  const dict = ADMIN_DICT as Record<string, unknown>;

  it('has every literal key', () => {
    const keys = [...new Set([...src.matchAll(/'(adm\.[A-Za-z0-9_.]+)'/g)].map((m) => m[1]))];
    expect(keys.length).toBeGreaterThan(100);
    expect(keys.filter((k) => !(k in dict))).toEqual([]);
  });

  it('has every dynamic key', () => {
    const want: string[] = [];
    for (const s of ['champions', 'loyal', 'promising', 'new', 'at_risk', 'dormant', 'lost']) want.push(`adm.cl.seg.${s}`, `adm.cl.seg.${s}.rule`);
    for (const s of ['platinum', 'gold', 'silver', 'bronze']) want.push(`adm.cl.tier.${s}`);
    for (const s of ['tickets', 'tables', 'mixed', 'guestlist']) want.push(`adm.cl.pillar.${s}`);
    for (const s of ['active_30d', 'cooling', 'lapsed']) want.push(`adm.cl.activity.${s}`);
    for (const s of ['yes', 'no']) want.push(`adm.cl.yn.${s}`);
    for (const s of ['email', 'sms', 'push', 'none']) want.push(`adm.cl.reach.${s}`);
    for (const s of ['total_spent', 'last_at', 'first_at', 'visit_nights', 'rev_90d']) want.push(`adm.cl.sort.${s}`);
    for (const s of ['all', 'upcoming', 'pending', 'cancelled']) want.push(`adm.cl.ev.f.${s}`);
    for (const s of ['approve', 'reject', 'publish', 'unpublish', 'cancel']) want.push(`adm.cl.ev.dlg.${s}`, `adm.cl.ev.dlg.${s}.desc`, `adm.cl.ev.done.${s}`);
    for (const s of ['ticket', 'table', 'guestlist']) want.push(`adm.cl.p.kind.${s}`);
    for (const s of ['pending', 'approved', 'rejected']) want.push(`adm.events.mod.${s}`);
    for (const s of ['rejected', 'draft', 'private', 'demo', 'no_poster', 'short_title', 'short_description', 'no_date']) want.push(`adm.events.why.${s}`);
    for (const s of ['bouncer', 'vip_host', 'cloakroom', 'manager', 'barman']) want.push(`adm.people.role.${s}`);
    for (const s of ['client', 'admin', 'owner', 'bouncer', 'vip_host', 'cloakroom', 'manager', 'promoter', 'dj', 'organizer']) want.push(`adm.role.${s}.label`);
    expect(want.filter((k) => !(k in dict))).toEqual([]);
  });

  it('never uses an em dash in a translation', () => {
    const bad = Object.entries(dict).filter(([k, v]) => k.startsWith('adm.cl.') && (v as string[]).some((x) => /[—–]/.test(x)));
    expect(bad.map(([k]) => k)).toEqual([]);
  });
});
