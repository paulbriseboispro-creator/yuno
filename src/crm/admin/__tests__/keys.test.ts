import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ADMIN_DICT } from '@/i18n/locales/admin/modules';

/** Chaque clé `adm.crm.*` écrite en toutes lettres dans l'Admin CRM existe en trois langues. */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? (f === '__tests__' ? [] : files(p)) : /\.tsx?$/.test(f) ? [p] : [];
  });
}

describe('Admin CRM : dictionnaire', () => {
  const used = new Set<string>();
  for (const f of files(join(process.cwd(), 'src/crm/admin'))) {
    for (const m of readFileSync(f, 'utf8').matchAll(/['"`](adm\.crm\.[A-Za-z0-9_.]+)['"`]/g)) used.add(m[1]);
  }
  it('trouve des clés à vérifier', () => { expect(used.size).toBeGreaterThan(40); });
  it('toutes les clés écrites en dur existent', () => {
    const missing = [...used].filter((k) => !(k in ADMIN_DICT));
    expect(missing).toEqual([]);
  });
  it('chaque entrée a ses trois langues renseignées', () => {
    const bad = Object.entries(ADMIN_DICT).filter(([k, v]) => k.startsWith('adm.crm.') && (v as unknown as string[]).some((x) => !x || !x.trim())).map(([k]) => k);
    expect(bad).toEqual([]);
  });
  it('les familles dynamiques sont complètes', () => {
    const fam: Record<string, string[]> = {
      'adm.crm.st.': ['trial', 'paid', 'granted', 'late', 'paused', 'churned'],
      'adm.crm.type.': ['club', 'organizer', 'association'],
      'adm.crm.ob.': ['0', '1', '2', '3', '4', '5', '6'],
      'adm.crm.h.': ['0', '1', '2', '3', '0d', '1d', '2d', '3d'],
      'adm.crm.sync.': ['ok', 'error', 'none'],
      'adm.crm.device.': ['desktop', 'mobile', 'tablet'],
      'adm.crm.ck.f.': ['started', 'account', 'console', 'connected', 'sent', 'paid'],
      'adm.crm.ck.step.': ['opened', 'role', 'structure', 'account', 'created', 'console'],
      'adm.crm.cl.f.': ['all', 'paid', 'trial', 'late', 'risk', 'off'],
      'adm.crm.cl.s.': ['health', 'bought', 'size', 'recent', 'name'],
      'adm.crm.nav.': ['cockpit', 'acquisition', 'sales', 'clients', 'clientsAll', 'clientsRisk', 'clientsOb', 'product', 'money', 'platform', 'legal', 'settings'],
      'adm.crm.nav.kw.': ['cockpit', 'acquisition', 'sales', 'clients', 'product', 'money', 'platform', 'legal', 'settings'],
      'adm.crm.group.': ['pilot', 'grow', 'serve', 'hold'],
      'adm.crm.ac.plan.': ['month', 'year'],
      'adm.crm.ac.move.': ['credit', 'debit', 'refund', 'expire'],
      'adm.crm.ac.a.': ['crm_grant_yunits', 'crm_extend_trial', 'crm_freeze_sending', 'crm_unfreeze_sending'],
    };
    const missing = Object.entries(fam).flatMap(([p, ks]) => ks.map((k) => p + k)).filter((k) => !(k in ADMIN_DICT));
    expect(missing).toEqual([]);
  });
});
