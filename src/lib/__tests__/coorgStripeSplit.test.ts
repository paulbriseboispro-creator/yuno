import { describe, expect, it, vi } from 'vitest';

// Le module importe le client Supabase : sans variables d'env, on le remplace.
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: vi.fn() } }));

import { coorgStripeSplitBlocker, type CoorgState } from '@/lib/coorg';

// Miroir front de coorg_stripe_split_blocker (SQL) — mêmes cas que le test SQL
// joué contre la base (migration 20260929220000).
const party = (key: string, role: 'lead' | 'partner' | 'cohost') => ({
  key, kind: key.startsWith('venue:') ? 'venue' : 'org', role, access: 'owner', share_crm: true,
  cohost_id: null, name: key, slug: null, avatar_url: null, city: null,
}) as CoorgState['parties'][number];
const state = (hasVenue = false): Pick<CoorgState, 'event' | 'parties'> => ({
  event: { id: 'e', title: 't', start_at: '', end_at: '', ended: false, has_stripe_collab: false, has_venue: hasVenue },
  parties: [party('org:A', 'lead'), party('org:B', 'cohost'), party('venue:club', 'cohost')],
});

describe('coorgStripeSplitBlocker', () => {
  it('deux organisations, l’hôte compris : éligible', () => {
    expect(coorgStripeSplitBlocker(state(), { 'org:A': 70, 'org:B': 30 })).toBeNull();
  });
  it('une troisième partie à 0 % ne compte pas', () => {
    expect(coorgStripeSplitBlocker(state(), { 'org:A': 70, 'org:B': 30, 'venue:club': 0 })).toBeNull();
  });
  it('un club dans les parts : refusé', () => {
    expect(coorgStripeSplitBlocker(state(), { 'org:A': 50, 'venue:club': 50 })).toBe('two_orgs_only');
  });
  it('trois parts : refusé (Stripe n’a que deux jambes)', () => {
    expect(coorgStripeSplitBlocker(state(), { 'org:A': 50, 'org:B': 30, 'org:C': 20 })).toBe('two_orgs_only');
  });
  it('l’hôte doit avoir une part (il est vendeur de record)', () => {
    expect(coorgStripeSplitBlocker(state(), { 'org:B': 60, 'org:C': 40 })).toBe('lead_must_share');
  });
  it('soirée avec club : c’est le contrat collab qui répartit', () => {
    expect(coorgStripeSplitBlocker(state(true), { 'org:A': 70, 'org:B': 30 })).toBe('venue_on_event');
  });
});
