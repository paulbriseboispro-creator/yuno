import { describe, expect, it, vi } from 'vitest';

// Le module importe le client Supabase : sans variables d'env, on le remplace.
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: vi.fn() } }));

import { scopeEventsOr } from '@/lib/promoterScopeHelpers';
import type { PromoterScope } from '@/hooks/usePromoterScope';

// Yuno CRM ⇄ Billetterie : les soirées d'un promoteur sont celles que son club
// ou son organisateur MÈNE ou dont il est partenaire. Une soirée miroir d'une
// billetterie externe (external_source) n'y figure jamais : le promoteur ne
// s'y assigne pas et elle ne vend rien chez Yuno.

const scope = (over: Partial<PromoterScope>): PromoterScope => ({
  kind: 'venue', venueId: null, organizerId: null, loading: false, ...over,
});

describe('scopeEventsOr', () => {
  it('organisateur : ses soirées menées sans miroir, et celles où il est partenaire', () => {
    expect(scopeEventsOr(scope({ kind: 'organizer', organizerId: 'u1' })))
      .toBe('and(organizer_user_id.eq.u1,external_source.is.null),partner_organizer_id.eq.u1');
  });

  it('club : ses soirées menées sans miroir, et celles qu\'il accueille', () => {
    expect(scopeEventsOr(scope({ kind: 'venue', venueId: 'womber' })))
      .toBe('and(venue_id.eq.womber,external_source.is.null),partner_venue_id.eq.womber');
  });

  it('sans portée résolue : aucun filtre (l\'appelant refuse de lire)', () => {
    expect(scopeEventsOr(scope({ kind: 'venue', venueId: null }))).toBeNull();
    expect(scopeEventsOr(scope({ kind: 'organizer', organizerId: null }))).toBeNull();
  });
});
