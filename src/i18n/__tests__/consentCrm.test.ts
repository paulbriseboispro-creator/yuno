import { describe, it, expect } from 'vitest';
import { loadLocale } from '../data';

// Fenêtre d'autorisation d'une IA (/connect-ai) : un compte Yuno CRM a sa
// version des textes (aiConsent.crm.*), au vouvoiement, et coupe l'accès dans
// Yuno CRM › Connecteurs. La Billetterie garde le tutoiement.
const LANGS = ['fr', 'en', 'es'] as const;

describe('consent window, CRM wording', () => {
  it('every language has the same CRM keys', async () => {
    const dicts = await Promise.all(LANGS.map((l) => loadLocale(l)));
    const keys = dicts.map((d) => Object.keys(d).filter((k) => k.startsWith('aiConsent.crm.')).sort());
    expect(keys[0].length).toBe(17);
    expect(keys[1]).toEqual(keys[0]);
    expect(keys[2]).toEqual(keys[0]);
  });

  it('the CRM texts never use the familiar form', async () => {
    const [fr, , es] = await Promise.all(LANGS.map((l) => loadLocale(l)));
    for (const [k, v] of Object.entries(fr)) {
      if (k.startsWith('aiConsent.crm.')) expect(v, k).not.toMatch(/\b(tu|ton|ta|tes|toi)\b/i);
    }
    for (const [k, v] of Object.entries(es)) {
      if (k.startsWith('aiConsent.crm.')) expect(v, k).not.toMatch(/\b(tú|tu|tus|te|ti)\b/i);
    }
  });

  it('access is cut in Connectors, and the Claude path is current', async () => {
    const [fr, en, es] = await Promise.all(LANGS.map((l) => loadLocale(l)));
    expect(fr['aiConsent.crm.manageLater']).toContain('Yuno CRM → Connecteurs');
    expect(en['aiConsent.crm.manageLater']).toContain('Yuno CRM → Connectors');
    expect(es['aiConsent.crm.manageLater']).toContain('Yuno CRM → Conectores');
    for (const key of ['aiConsent.autoAllowTip', 'aiConsent.crm.autoAllowTip']) {
      expect(fr[key]).toContain('Personnaliser → Connecteurs → Yuno');
      expect(en[key]).toContain('Customize → Connectors → Yuno');
      expect(es[key]).toContain('Personalizar → Conectores → Yuno');
    }
  });
});
