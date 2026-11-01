import { describe, expect, it } from 'vitest';
import { CRM_LEGAL_DOCS, CRM_LEGAL_RECORDED, actingName, fillWord, legalGateNeeded, recordContext } from '../legalGate';
import { LEGAL_VERSIONS } from '@/lib/legal';
import { legalContent } from '@/data/legalContent';

describe('legalGateNeeded', () => {
  it('s’ouvre dès qu’un document contractuel manque', () => {
    expect(legalGateNeeded({})).toBe(true);
    expect(legalGateNeeded({ terms_crm: true })).toBe(true);
    expect(legalGateNeeded({ dpa: true })).toBe(true);
  });

  it('ne redemande rien quand les deux documents contractuels sont acceptés', () => {
    expect(legalGateNeeded({ terms_crm: true, dpa: true })).toBe(false);
    expect(legalGateNeeded({ terms_crm: true, dpa: true, privacy: false })).toBe(false);
  });
});

describe('CRM_LEGAL_DOCS', () => {
  it('ne cite que des types versionnés et des textes qui existent dans les trois langues', () => {
    for (const d of CRM_LEGAL_DOCS) {
      expect(LEGAL_VERSIONS[d.docType]).toBeTruthy();
      for (const lang of ['en', 'fr', 'es'] as const) {
        expect(legalContent[d.section][lang].content.length).toBeGreaterThan(200);
      }
      expect(d.path).toBe(`/legal/${d.section}`);
    }
  });

  it('l’Accord marketing est un extrait des Conditions : affiché, sans preuve à part', () => {
    const m = CRM_LEGAL_DOCS.find((d) => d.id === 'marketing');
    expect(m?.extractOf).toBe('terms');
    expect(m?.contractual).toBe(false);
    expect(CRM_LEGAL_RECORDED.map((d) => d.id)).toEqual(['terms', 'dpa', 'privacy']);
    // un extrait renvoie au même texte que son document
    const parent = CRM_LEGAL_DOCS.find((d) => d.id === m?.extractOf);
    expect(m?.docType).toBe(parent?.docType);
    expect(m?.path).toBe(parent?.path);
  });

  it('consigne l’Accord marketing sur la ligne des Conditions, et sur elle seule', () => {
    const base = { surface: 'crm_gate', scope: 'venue:1' };
    const ctx = (id: string) => recordContext(CRM_LEGAL_DOCS.find((d) => d.id === id)!, base);
    expect(ctx('terms')).toEqual({ ...base, includes: [{ id: 'marketing', article: '7' }] });
    expect(ctx('dpa')).toEqual(base);
    expect(ctx('privacy')).toEqual(base);
    // reste sous la limite de 2 048 octets de la fonction d'enregistrement
    expect(JSON.stringify(ctx('terms')).length).toBeLessThan(2048);
  });

  it('a des identifiants uniques', () => {
    expect(new Set(CRM_LEGAL_DOCS.map((d) => d.id)).size).toBe(CRM_LEGAL_DOCS.length);
  });
});

describe('textes', () => {
  it('nomme l’espace, sinon la formule neutre', () => {
    expect(actingName('  Amoris ', 'ma structure')).toBe('Amoris');
    expect(actingName('', 'ma structure')).toBe('ma structure');
    expect(actingName(null, 'ma structure')).toBe('ma structure');
  });

  it('remplace chaque {w}', () => {
    expect(fillWord('au nom de {w}', 'Amoris')).toBe('au nom de Amoris');
  });
});
