import { describe, expect, it } from 'vitest';
import { QrPresence } from '@/lib/scan/qrPresence';

describe('QrPresence', () => {
  it('signale un code qui apparaît, une seule fois tant qu\'il reste devant', () => {
    const p = new QrPresence(1200);
    expect(p.fresh(['A'], 0)).toEqual(['A']);
    p.accept('A', 0);
    // Le billet reste sous la caméra pendant que la carte s'affiche.
    for (let t = 120; t <= 10_000; t += 120) expect(p.fresh(['A'], t)).toEqual([]);
  });

  it('relit le même code une fois sorti puis remis devant', () => {
    const p = new QrPresence(1200);
    p.fresh(['A'], 0);
    p.accept('A', 0);
    expect(p.fresh([], 500)).toEqual([]);
    expect(p.fresh([], 1300)).toEqual([]);
    expect(p.fresh(['A'], 1400)).toEqual(['A']);
  });

  it('une frame ratée au milieu ne relit pas le code', () => {
    const p = new QrPresence(1200);
    p.fresh(['A'], 0);
    p.accept('A', 0);
    expect(p.fresh([], 600)).toEqual([]);
    expect(p.fresh(['A'], 1100)).toEqual([]);
  });

  it('un code refusé par l\'écran est reproposé à la frame suivante', () => {
    const p = new QrPresence(1200);
    expect(p.fresh(['B'], 0)).toEqual(['B']);
    // pas d'accept : un scan était en cours
    expect(p.fresh(['B'], 120)).toEqual(['B']);
    p.accept('B', 120);
    expect(p.fresh(['B'], 240)).toEqual([]);
  });

  it('le client suivant passe pendant que le précédent est encore visible', () => {
    const p = new QrPresence(1200);
    p.fresh(['A'], 0);
    p.accept('A', 0);
    expect(p.fresh(['A', 'B'], 200)).toEqual(['B']);
  });
});
