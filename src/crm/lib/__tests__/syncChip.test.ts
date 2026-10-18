import { describe, expect, it } from 'vitest';
import { syncChip } from '../syncChip';
import type { CrmShell } from '@/crm/data/shell';
import shellDict from '@/i18n/locales/crm/modules/shell';
import connectorsDict from '@/i18n/locales/crm/modules/connectors';

const crmLocale: Record<string, readonly string[]> = { ...shellDict, ...connectorsDict };

// Audit du 18/10 (UI-01) : la barre du haut disait « synchronisé » pendant le
// premier import (chiffres partiels) et pour une connexion coupée ou en pause.
type Conn = NonNullable<CrmShell['connection']>;
const base: Conn = {
  provider: 'shotgun', status: 'active', state: 'ok', external_org_name: 'Club', last_ok_at: '2026-10-18T09:30:00Z',
  last_error_at: null, last_error: null, fail_count: 0, initial_import_done_at: '2026-10-17T14:36:47Z', running: false, broken_since: null,
};

describe('état de la synchro en haut de la Console', () => {
  it('à jour', () => expect(syncChip(base)).toBe('ok'));
  it('pas de connexion', () => expect(syncChip(null)).toBe('none'));
  it('premier import pas fini : « import en cours », même entre deux passes réussies', () => {
    expect(syncChip({ ...base, initial_import_done_at: null })).toBe('importing');
    expect(syncChip({ ...base, initial_import_done_at: null, state: 'running' })).toBe('importing');
  });
  it('connexion coupée : jamais « synchronisé »', () => {
    expect(syncChip({ ...base, status: 'disconnected' })).toBe('off');
    expect(syncChip({ ...base, status: 'disconnected', initial_import_done_at: null })).toBe('off');
  });
  it('compte en pause : « en pause », pas « synchronisé »', () => expect(syncChip({ ...base, state: 'paused' })).toBe('paused'));
  it('une panne passe devant l’import en cours (le pro doit agir)', () => {
    expect(syncChip({ ...base, state: 'broken', initial_import_done_at: null })).toBe('broken');
  });
  it('passe en cours après le premier import', () => expect(syncChip({ ...base, state: 'running' })).toBe('running'));

  it('chaque libellé existe en anglais, français et espagnol', () => {
    for (const k of ['yc.top.sync.importing', 'yc.top.sync.paused', 'yc.top.sync.off', 'yc.top.import', 'yc.top.importSub', 'yc.top.importLink',
      'yc.co.err.orgChange', 'yc.co.err.notConnected', 'yc.co.err.signedOut']) {
      const v = crmLocale[k];
      expect(v, k).toBeDefined();
      expect(v).toHaveLength(3);
      expect(v.every((s) => s.trim().length > 0), k).toBe(true);
    }
  });
});
