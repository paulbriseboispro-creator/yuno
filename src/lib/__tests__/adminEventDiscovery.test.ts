import { describe, expect, it } from 'vitest';
import { canAdminRepublish, discoveryBlockers, type DiscoveryEventInput } from '../adminEventDiscovery';

const base: DiscoveryEventInput = {
  organizer_user_id: 'org-1',
  partner_venue_id: null,
  event_kind: 'public_event',
  visibility: 'public',
  is_active: true,
  is_discoverable: false,
  discovery_status: 'approved',
  status: 'active',
  poster_url: 'https://x/p.jpg',
  title: 'House Of Love VOL.1',
  description: 'A night of House music at Tia Felisa, Madrid.',
  start_at: '2026-11-18T22:59:00Z',
};

describe('discoveryBlockers', () => {
  it('ne dit rien d’une soirée en ligne ou annulée', () => {
    expect(discoveryBlockers({ ...base, is_discoverable: true })).toEqual([]);
    expect(discoveryBlockers({ ...base, status: 'cancelled', description: '' })).toEqual([]);
  });

  it('nomme la description trop courte d’une soirée sans club (House Of Love, 14/11)', () => {
    expect(discoveryBlockers({ ...base, description: '' })).toEqual(['short_description']);
    expect(discoveryBlockers({ ...base, description: null })).toEqual(['short_description']);
  });

  it('n’exige pas de description quand un club partenaire porte la soirée', () => {
    expect(discoveryBlockers({ ...base, partner_venue_id: 'v1', description: '' })).toEqual([]);
  });

  it('nomme le brouillon de l’organisateur (Midnight House, 14/11)', () => {
    expect(discoveryBlockers({ ...base, is_active: false })).toEqual(['draft']);
  });

  it('met la décision de Yuno en premier, puis le reste', () => {
    expect(discoveryBlockers({ ...base, discovery_status: 'rejected', poster_url: null })).toEqual(['rejected', 'no_poster']);
  });

  it('privée, démo, titre court, sans date', () => {
    expect(discoveryBlockers({ ...base, visibility: 'private' })).toEqual(['private']);
    expect(discoveryBlockers({ ...base, event_kind: 'private_event' })).toEqual(['private']);
    expect(discoveryBlockers(base, true)).toEqual(['demo']);
    expect(discoveryBlockers({ ...base, title: 'Ab' })).toEqual(['short_title']);
    expect(discoveryBlockers({ ...base, start_at: null })).toEqual(['no_date']);
  });

  it('une soirée de club n’a pas de critère de qualité', () => {
    expect(discoveryBlockers({ ...base, organizer_user_id: null, poster_url: null, description: '' })).toEqual([]);
    expect(discoveryBlockers({ ...base, organizer_user_id: null, is_active: false })).toEqual(['draft']);
  });
});

describe('canAdminRepublish', () => {
  it('seulement pour lever une décision de Yuno, ou pour un club', () => {
    expect(canAdminRepublish({ ...base, description: '' })).toBe(false);
    expect(canAdminRepublish({ ...base, discovery_status: 'rejected' })).toBe(true);
    expect(canAdminRepublish({ ...base, organizer_user_id: null })).toBe(true);
    expect(canAdminRepublish({ ...base, is_discoverable: true })).toBe(false);
    expect(canAdminRepublish({ ...base, status: 'cancelled', discovery_status: 'rejected' })).toBe(false);
  });
});
