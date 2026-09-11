import { describe, expect, it } from 'vitest';
import { ADMIN_DICT, pickLanguage } from '../locales/admin/modules';
import { loadLocale, loadLocaleSection, hasLocaleSection } from '../data';

/**
 * Le dictionnaire du super admin est une SECTION à part : il ne doit jamais
 * entrer dans le chunk de langue qu'un client télécharge avant son premier
 * écran, et chaque clé doit exister dans les trois langues (une chaîne vide
 * afficherait un libellé fantôme, pas une erreur).
 */
describe('admin locale section', () => {
  it('every key carries three non-empty translations', () => {
    const holes: string[] = [];
    for (const [key, triple] of Object.entries(ADMIN_DICT)) {
      if (!Array.isArray(triple) || triple.length !== 3) { holes.push(`${key}: ${Array.isArray(triple) ? triple.length : 'not an array'}`); continue; }
      triple.forEach((value, i) => { if (typeof value !== 'string' || value.trim() === '') holes.push(`${key}[${i}]`); });
    }
    expect(holes).toEqual([]);
    expect(Object.keys(ADMIN_DICT).length).toBeGreaterThan(500);
  });

  it('each language projection keeps every key', () => {
    const en = pickLanguage(0), fr = pickLanguage(1), es = pickLanguage(2);
    const keys = Object.keys(ADMIN_DICT);
    for (const dict of [en, fr, es]) expect(Object.keys(dict).sort()).toEqual([...keys].sort());
    // Les trois langues doivent différer quelque part, sinon la traduction a
    // été copiée-collée et personne ne s'en apercevrait.
    expect(keys.some((k) => en[k] !== fr[k])).toBe(true);
    expect(keys.some((k) => fr[k] !== es[k])).toBe(true);
  });

  it('stays out of the main dictionary until the admin section loads', async () => {
    const fr = await loadLocale('fr');
    expect(Object.keys(fr).some((k) => k.startsWith('adm.'))).toBe(false);
    expect(hasLocaleSection('fr', 'admin')).toBe(false);

    const merged = await loadLocaleSection('fr', 'admin');
    expect(hasLocaleSection('fr', 'admin')).toBe(true);
    expect(merged['adm.nav.cockpit']).toBeDefined();
    // La section fusionne sans écraser le dictionnaire principal.
    expect(merged['explore.today']).toBe(fr['explore.today']);
  });

  it('every language ships the admin section', async () => {
    const [en, es] = await Promise.all([loadLocaleSection('en', 'admin'), loadLocaleSection('es', 'admin')]);
    expect(en['adm.nav.cockpit']).toBeDefined();
    expect(es['adm.nav.cockpit']).toBeDefined();
  });
});
