import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { isThemedProPath, tint } from '../proTheme';

const ROOT = path.resolve(__dirname, '../../..');
const CSS = fs.readFileSync(path.join(ROOT, 'src/styles/pro-theme.css'), 'utf8');
const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/** Corps d'une règle CSS dont le sélecteur est exactement `selector`. */
function block(selector: string): string {
  const i = CSS.indexOf(`${selector} {`);
  if (i < 0) throw new Error(`bloc introuvable : ${selector}`);
  return CSS.slice(i, CSS.indexOf('\n}', i));
}
const ROOT_BLOCK = block(':root');
const LIGHT_BLOCK = block('html[data-pro-theme="light"]');
const ISLAND_BLOCK = block('html[data-pro-theme="light"] [data-theme-island="dark"]');

function srcFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '__tests__') srcFiles(p, out); }
    else if (/\.(tsx?|css)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('jetons du thème pro', () => {
  // Une variable de surface/accent/texte utilisée sans être déclarée rend une
  // couleur invalide, que le navigateur ignore EN SILENCE — dans les deux thèmes.
  const used = new Set<string>();
  for (const f of srcFiles(path.join(ROOT, 'src'))) {
    if (f.endsWith('pro-theme.css')) continue;
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/var\((--(?:sf|acc|tx|glass)-[0-9a-z-]+)\)/g)) used.add(m[1]);
  }

  it('déclare chaque variable utilisée dans le code, en sombre, en clair et dans les îlots', () => {
    expect(used.size).toBeGreaterThan(20);
    const missing = [...used].flatMap((v) => [
      ROOT_BLOCK.includes(`${v}:`) ? null : `${v} (:root)`,
      LIGHT_BLOCK.includes(`${v}:`) ? null : `${v} (clair)`,
      ISLAND_BLOCK.includes(`${v}:`) ? null : `${v} (îlot)`,
    ]).filter(Boolean);
    expect(missing).toEqual([]);
  });

  it('garde en sombre la valeur exacte de chaque surface et accent', () => {
    for (const m of ROOT_BLOCK.matchAll(/--(sf|acc|tx)-([0-9a-f]{6}): (#[0-9a-f]{6});/g)) {
      expect(m[3]).toBe(`#${m[2]}`);
    }
  });

  it('pose les mêmes variables dans le bloc clair et dans l\'îlot sombre', () => {
    const names = (b: string) => [...b.matchAll(/^\s*(--[\w-]+):/gm)].map((m) => m[1]).sort();
    const light = new Set(names(LIGHT_BLOCK));
    const island = new Set(names(ISLAND_BLOCK));
    expect([...light].filter((n) => !island.has(n))).toEqual([]);
  });
});

describe('isThemedProPath', () => {
  it('couvre la Yuno Console, les espaces pro et le super admin', () => {
    for (const p of ['/owner', '/owner/dashboard', '/manager/orders', '/organizer-app', '/organizer-app/events/x',
      '/agency-app/finance', '/affiliate/venues', '/promoter/links', '/dj', '/dj/planning', '/admin/alerts']) {
      expect(isThemedProPath(p)).toBe(true);
    }
  });

  it('laisse sombres les pages publiques, l\'aperçu club et le staff de nuit', () => {
    for (const p of ['/', '/explore', '/owner/preview/abc', '/dj/some-dj', '/affiliate-event/x', '/barman',
      '/bouncer', '/cloakroom', '/vip-host', '/pro', '/profile']) {
      expect(isThemedProPath(p)).toBe(false);
    }
  });

  it('reste aligné avec le script anti-flash d\'index.html', () => {
    const prefixes = /var prefixes = \[([^\]]+)\]/.exec(INDEX_HTML)?.[1] ?? '';
    for (const p of ['/owner', '/manager', '/organizer-app', '/agency-app', '/affiliate', '/promoter', '/admin']) {
      expect(prefixes).toContain(`'${p}'`);
    }
    expect(INDEX_HTML).toContain("localStorage.getItem('yuno:pro-theme')");
    expect(INDEX_HTML).toContain("'/owner/preview/'");
  });
});

describe('choix du thème / tint', () => {
  it('ne connaît que clair et sombre, sombre par défaut (plus de « Système »)', () => {
    expect(INDEX_HTML).toContain("localStorage.getItem('yuno:pro-theme') === 'light'");
    expect(INDEX_HTML).not.toContain('prefers-color-scheme');
  });

  it('garde la transition en cercle scopée à sa propre classe', () => {
    expect(CSS).toContain('html.pro-theme-vt::view-transition-new(root)');
    expect(CSS).not.toMatch(/^::view-transition/m);
  });

  it('rend une teinte translucide valide quel que soit le format de couleur', () => {
    expect(tint('#34D399', '1A')).toBe('#34D3991A');
    expect(tint('var(--acc-34d399)', '1A')).toBe('#34d3991A');
    expect(tint('rgb(var(--ink)/0.58)', '80')).toBe('rgb(var(--ink)/0.502)');
  });
});
