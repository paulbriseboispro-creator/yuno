import { describe, it, expect } from 'vitest';
import { loadLocale, loadLocaleSection, hasLocaleSection, getLoadedLocale } from '../data';

// Le mode d'emploi pro (ohelp.*) vit dans un chunk à part : il ne doit PAS être
// dans le dictionnaire principal, et doit s'y fusionner à la demande.
describe('locale sections', () => {
  it('main dictionary excludes ohelp.* until the help section is loaded', async () => {
    const fr = await loadLocale('fr');
    expect(fr['explore.today']).toBeDefined();
    expect(Object.keys(fr).some((k) => k.startsWith('ohelp.'))).toBe(false);
    expect(hasLocaleSection('fr', 'help')).toBe(false);

    const merged = await loadLocaleSection('fr', 'help');
    expect(hasLocaleSection('fr', 'help')).toBe(true);
    expect(merged['ohelp.action.goToPromoterFinance']).toBeDefined();
    expect(merged['explore.today']).toBe(fr['explore.today']);
    expect(getLoadedLocale('fr')?.['ohelp.action.goToPromoterFinance']).toBeDefined();
  });

  it('every language ships the help section', async () => {
    const [en, es] = await Promise.all([loadLocaleSection('en', 'help'), loadLocaleSection('es', 'help')]);
    expect(en['ohelp.action.goToPromoterFinance']).toBeDefined();
    expect(es['ohelp.action.goToPromoterFinance']).toBeDefined();
  });
});
