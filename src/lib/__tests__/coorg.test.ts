import { describe, it, expect, vi } from 'vitest';

// Le module importe le client Supabase : sans variables d'env, on le remplace.
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: vi.fn() } }));

import { joinHostNames, orgEventsOr, venueEventsOr, orgOwnEventsOr, venueOwnEventsOr, partyKeyOf, coorgErrorCode } from '@/lib/coorg';

describe('co-organisation — nom des hôtes au checkout', () => {
  it('un seul hôte : son nom tel quel', () => {
    expect(joinHostNames(['Amoris'], 'fr')).toBe('Amoris');
  });
  it('plusieurs hôtes : conjonction de la langue', () => {
    expect(joinHostNames(['Amoris', 'Asso Yuno', 'Womber'], 'fr')).toBe('Amoris, Asso Yuno et Womber');
    expect(joinHostNames(['Amoris', 'Womber'], 'en')).toBe('Amoris and Womber');
    expect(joinHostNames(['Amoris', 'Womber'], 'es')).toBe('Amoris y Womber');
  });
  it('ignore les noms vides', () => {
    expect(joinHostNames(['Amoris', ' ', ''], 'fr')).toBe('Amoris');
    expect(joinHostNames([], 'fr')).toBe('');
  });
});

describe('co-organisation — filtres de portée PostgREST', () => {
  it('orga : menées, partenaire, co-hébergées', () => {
    expect(orgEventsOr('u1')).toBe('organizer_user_id.eq.u1,partner_organizer_id.eq.u1,cohost_org_ids.cs.{u1}');
    expect(orgOwnEventsOr('u1')).toBe('organizer_user_id.eq.u1,partner_organizer_id.eq.u1');
  });
  it('club : menées, partenaire, co-hébergées', () => {
    expect(venueEventsOr('womber')).toBe('venue_id.eq.womber,partner_venue_id.eq.womber,cohost_venue_ids.cs.{womber}');
    expect(venueOwnEventsOr('womber')).toBe('venue_id.eq.womber,partner_venue_id.eq.womber');
  });
  it('clé de partie', () => {
    expect(partyKeyOf({ venueId: 'womber' })).toBe('venue:womber');
    expect(partyKeyOf({ organizerUserId: 'u1' })).toBe('org:u1');
  });
  it('code d’erreur serveur = premier mot du message', () => {
    expect(coorgErrorCode({ message: 'unknown_party org:x' })).toBe('unknown_party');
    expect(coorgErrorCode(new Error('forbidden'))).toBe('forbidden');
  });
});
