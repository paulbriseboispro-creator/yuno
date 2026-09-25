import { beforeEach, describe, expect, it, vi } from 'vitest';

let native = false;
vi.mock('@/lib/native', () => ({ isNative: () => native }));

// Pas de DOM dans ces tests : juste ce que le module lit.
const loc = { pathname: '/' };
const store = new Map<string, string>();
vi.stubGlobal('window', { location: loc });
vi.stubGlobal('sessionStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
});

// Le module garde l'historique des routes en mémoire : on le recharge à
// chaque cas pour repartir d'une visite neuve.
async function fresh() {
  vi.resetModules();
  return import('@/lib/affiliateOrigin');
}

function go(mod: Awaited<ReturnType<typeof fresh>>, path: string) {
  loc.pathname = path;
  mod.recordRoute(path);
}

describe('cameFromYuno', () => {
  beforeEach(() => {
    native = false;
    sessionStorage.clear();
  });

  it('web, arrivée directe sur la soirée : pas Yuno (le référent décide)', async () => {
    const m = await fresh();
    go(m, '/affiliate-event/houseo-2026-09-29');
    expect(m.cameFromYuno()).toBe(false);
  });

  it('Explore → soirée externe : amené par Yuno', async () => {
    const m = await fresh();
    go(m, '/explore');
    go(m, '/affiliate-event/houseo-2026-09-29');
    expect(m.cameFromYuno()).toBe(true);
  });

  it('le parcours de l’agence garde l’origine de son entrée', async () => {
    const m = await fresh();
    go(m, '/explore');
    go(m, '/affiliate-event/houseo-2026-09-29');
    expect(m.cameFromYuno()).toBe(true);
    go(m, '/affiliate-venue/los-amantes');
    expect(m.cameFromYuno()).toBe(true);
  });

  it('linktree de l’agence (Instagram) → soirée : pas Yuno', async () => {
    const m = await fresh();
    go(m, '/p/mad-by-night');
    expect(m.cameFromYuno()).toBe(false);
    go(m, '/affiliate-event/houseo-2026-09-29');
    expect(m.cameFromYuno()).toBe(false);
  });

  it('app native : la première page est amenée par Yuno', async () => {
    native = true;
    const m = await fresh();
    go(m, '/affiliate-event/houseo-2026-09-29');
    expect(m.cameFromYuno()).toBe(true);
  });

  it('reconnaît les pages d’agence', async () => {
    const m = await fresh();
    expect(m.isAgencySurface('/rp/mad-by-night')).toBe(true);
    expect(m.isAgencySurface('/p/mad-by-night/agenda')).toBe(true);
    expect(m.isAgencySurface('/promo/milo')).toBe(true);
    expect(m.isAgencySurface('/explore')).toBe(false);
    expect(m.isAgencySurface('/profile')).toBe(false);
  });
});
