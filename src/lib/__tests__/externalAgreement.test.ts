import { describe, it, expect } from 'vitest';
import {
  isExternalAgreement, externalCollectors, defaultExternalCollectors, normalizeSplitRules,
} from '@/lib/splitRules';

// Miroir de set_event_collab_external_agreement (SQL) : partage 100/0 par pilier.
const ext = (tickets: 'organizer' | 'venue', tables: 'organizer' | 'venue') => ({
  agreement: 'external',
  tickets: tickets === 'organizer' ? { organizer_pct: 100, venue_pct: 0 } : { organizer_pct: 0, venue_pct: 100 },
  tables: tables === 'organizer' ? { organizer_pct: 100, venue_pct: 0 } : { organizer_pct: 0, venue_pct: 100 },
  drinks: { organizer_pct: 0, venue_pct: 100 },
});

describe('accord « réglé entre vous »', () => {
  it('se reconnaît au marqueur, jamais aux pourcentages seuls', () => {
    expect(isExternalAgreement(ext('organizer', 'venue'))).toBe(true);
    expect(isExternalAgreement({ tickets: { organizer_pct: 100, venue_pct: 0 } })).toBe(false);
    expect(isExternalAgreement(null)).toBe(false);
    expect(isExternalAgreement('external')).toBe(false);
  });
  it('dit qui encaisse chaque pilier', () => {
    expect(externalCollectors(ext('organizer', 'venue'))).toEqual({ tickets: 'organizer', tables: 'venue' });
    expect(externalCollectors(ext('venue', 'organizer'))).toEqual({ tickets: 'venue', tables: 'organizer' });
    expect(externalCollectors({ tickets: { organizer_pct: 100 } })).toBeNull();
  });
  it('défauts : billets à l’orga, tables au club sauf soirée de l’orga', () => {
    expect(defaultExternalCollectors('co_event')).toEqual({ tickets: 'organizer', tables: 'venue' });
    expect(defaultExternalCollectors('venue_rental')).toEqual({ tickets: 'organizer', tables: 'venue' });
    expect(defaultExternalCollectors('org_hosted')).toEqual({ tickets: 'organizer', tables: 'organizer' });
  });
  it('la normalisation garde le marqueur (sinon l’accord passerait pour un contrat signé)', () => {
    expect(normalizeSplitRules(ext('organizer', 'venue'))?.agreement).toBe('external');
    expect(normalizeSplitRules({ tickets: { organizer_pct: 50, venue_pct: 50 } })?.agreement).toBeUndefined();
  });
});
