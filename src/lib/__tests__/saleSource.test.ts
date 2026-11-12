import { describe, expect, it } from 'vitest';
import {
  SALE_CHANNELS, channelFamily, channelName, clientSourceChips, clientSourceSummary, isKnownChannel, saleSourceLine, sourceDetail, toSaleChannel,
} from '@/lib/saleSource';

describe('saleSource', () => {
  it('names every channel in the three languages', () => {
    for (const ch of SALE_CHANNELS) {
      for (const lang of ['en', 'fr', 'es'] as const) {
        expect(channelName(ch, lang)).toBeTruthy();
        expect(channelName(ch, lang, true)).toBeTruthy();
      }
      expect(channelFamily(ch)).toBeTruthy();
    }
  });

  it('reads an unknown channel as direct', () => {
    expect(toSaleChannel('carrier_pigeon')).toBe('direct');
    expect(toSaleChannel(null)).toBe('direct');
    expect(toSaleChannel('dj')).toBe('dj');
  });

  it('writes one line per order', () => {
    expect(saleSourceLine('promoter', 'Jimena Albert', 'fr')).toBe('Promoteur · Jimena Albert');
    expect(saleSourceLine('instagram', null, 'en')).toBe('Instagram');
    expect(saleSourceLine('yuno', 'venue_profile', 'fr')).toBe('Trouvé sur Yuno · Page Yuno du club');
    expect(sourceDetail('dj', 'Dolsson', 'es')).toBe('Dolsson');
  });

  it('treats direct and door as unknown provenance', () => {
    expect(isKnownChannel('direct')).toBe(false);
    expect(isKnownChannel('door')).toBe(false);
    expect(isKnownChannel('email')).toBe(true);
  });

  it('sums up a customer', () => {
    expect(clientSourceSummary([{ channel: 'direct', n: 3 }], 'fr')).toBe('Aucune provenance connue pour l’instant');
    expect(clientSourceSummary([{ channel: 'instagram', n: 1 }], 'fr')).toBe('La première fois via Instagram');
    expect(clientSourceSummary([{ channel: 'instagram', n: 1 }, { channel: 'direct', n: 2 }], 'fr')).toBe('Une fois via Instagram, le reste inconnu');
    expect(clientSourceSummary([{ channel: 'promoter', n: 3 }], 'fr')).toBe('Toujours via Promoteur');
    expect(clientSourceSummary([{ channel: 'promoter', n: 2, names: [{ label: 'Jimena Albert', n: 2 }] }], 'fr')).toBe('Toujours via Jimena Albert · Promoteur');
    expect(clientSourceSummary([{ channel: 'promoter', n: 3 }, { channel: 'instagram', n: 1 }], 'en')).toBe('Mostly via Promoter');
    expect(clientSourceSummary([{ channel: 'promoter', n: 1 }, { channel: 'dj', n: 1 }], 'en')).toBe('Comes through several channels');
  });

  it('never says "always via" when the people differ', () => {
    const camilla = [{ channel: 'promoter' as const, n: 2, names: [{ label: 'Gaspard', n: 1 }, { label: 'Chrysoula Fotaki', n: 1 }] }];
    expect(clientSourceSummary(camilla, 'fr')).toBe('Chaque commande via un promoteur, jamais le même');
    expect(clientSourceSummary([{ channel: 'promoter', n: 3, names: [{ label: 'A', n: 2 }, { label: 'B', n: 1 }] }], 'en'))
      .toBe('Every order via a promoter, not always the same one');
    expect(clientSourceSummary([{ channel: 'instagram', n: 2, names: [{ label: 'Story 1', n: 1 }, { label: 'Bio', n: 1 }] }], 'fr'))
      .toBe('Toujours via Instagram');
  });

  it('gives each person their own count', () => {
    const chips = clientSourceChips([
      { channel: 'promoter', n: 2, names: [{ label: 'Gaspard', n: 1 }, { label: 'Chrysoula Fotaki', n: 1 }] },
      { channel: 'instagram', n: 3, names: [{ label: 'Story 1', n: 1 }] },
    ], 'fr');
    expect(chips.map((c) => `${c.label} ×${c.n}`)).toEqual(['Gaspard ×1', 'Chrysoula Fotaki ×1', 'Story 1 ×1', 'Instagram ×2']);
  });
});
