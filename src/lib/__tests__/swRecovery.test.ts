import { describe, expect, it } from 'vitest';
import { entryScriptOf } from '@/lib/swRecovery';

describe('build périmé derrière une 404', () => {
  it('lit le script d’entrée d’un index.html de production', () => {
    expect(entryScriptOf('<script type="module" crossorigin src="/assets/index-DnFnhJgD.js"></script>')).toBe('/assets/index-DnFnhJgD.js');
    expect(entryScriptOf('<script crossorigin src="/assets/index-A1.js" type="module"></script>')).toBe('/assets/index-A1.js');
  });
  it('rien en développement ni sans script de build', () => {
    expect(entryScriptOf('<script type="module" src="/src/main.tsx"></script>')).toBeNull();
    expect(entryScriptOf('<html></html>')).toBeNull();
  });
});
