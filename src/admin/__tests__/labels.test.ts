import { describe, expect, it } from 'vitest';
import { errorKind, humanizeRaw } from '../ui/i18n';
import labels from '@/i18n/locales/admin/modules/labels';

describe('aucune valeur technique à l’écran', () => {
  it('une erreur SQL se dit en mots', () => {
    expect(errorKind('canceling statement due to statement timeout')).toBe('timeout');
    expect(errorKind('permission denied for table x')).toBe('denied');
    expect(errorKind('HTTP 429 Too Many Requests')).toBe('rate');
    expect(errorKind('fetch failed: ECONNRESET')).toBe('network');
    expect(errorKind('')).toBe('none');
    expect(errorKind('weird')).toBe('other');
  });
  it('une clé brute devient des mots', () => {
    expect(humanizeRaw('pro_account_hidden')).toBe('pro account hidden');
    expect(humanizeRaw('adm.mon.iss.type.admin_x')).toBe('admin x');
  });
  it('le dictionnaire a les trois langues, sans tiret long ni écriture inclusive', () => {
    for (const [k, v] of Object.entries(labels)) {
      expect(v, k).toHaveLength(3);
      for (const x of v) { expect(x, k).not.toMatch(/[—]|·e\b|\(s\)/); expect(x.trim(), k).not.toBe(''); }
    }
  });
});

import { fill } from '../ui/i18n';
import { ADMIN_DICT } from '@/i18n/locales/admin/modules';

describe('pluriels', () => {
  it('singulier à 1 (et 0 en français), pluriel sinon, nombre déjà formaté compris', () => {
    const s = '{n} {n|tâche|tâches}';
    expect(fill(s, { n: 0 }, 'fr')).toBe('0 tâche');
    expect(fill(s, { n: 1 }, 'fr')).toBe('1 tâche');
    expect(fill(s, { n: '1 240' }, 'fr')).toBe('1 240 tâches');
    expect(fill('{n} {n|task|tasks}', { n: 0 }, 'en')).toBe('0 tasks');
    expect(fill('{n} {n|task|tasks}', { n: 1 }, 'en')).toBe('1 task');
  });
  it('aucune phrase de l’admin n’écrit « (s) » ni « ·e »', () => {
    const bad = Object.entries(ADMIN_DICT).filter(([, v]) => (v as readonly string[]).some((x) => /\((s|e|es|x)\)|·e\b|·s\b/.test(x)));
    expect(bad.map(([k]) => k)).toEqual([]);
  });
});

import { cleanText } from '../ui/i18n';
describe('identifiants techniques retirés des messages', () => {
  it('références Stripe et UUID', () => {
    expect(cleanText('Session cs_live_a1B2c3D4e5 payée, billet introuvable')).toBe('Session payée, billet introuvable');
    expect(cleanText('Session cs_live_… payée')).toBe('Session payée');
    expect(cleanText('Compte 0f8e3c1a-1111-4222-8333-944445555666 en retard')).toBe('Compte en retard');
    expect(cleanText(null)).toBe('');
  });
});
