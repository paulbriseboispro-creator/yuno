import { describe, expect, it } from 'vitest';
import {
  SALE_CHANNELS, channelFamily, channelName, clientSourceSummary, isKnownChannel, saleSourceLine, sourceDetail, toSaleChannel,
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
});
