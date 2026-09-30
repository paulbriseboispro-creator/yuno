import { describe, expect, it } from 'vitest';
import {
  allowedRoles, clubEmailInviteRules, defaultRole, partnerDraftKey, principalKindFor, principalTerms,
  yunoContractRules, type PartnerDraft,
} from '../collabInvite';

const org = (id: string, role: PartnerDraft['role'] = 'viewer'): PartnerDraft =>
  ({ source: 'yuno', kind: 'org', id, name: id, avatar_url: null, city: null, role });
const club = (id: string, role: PartnerDraft['role'] = 'viewer'): PartnerDraft =>
  ({ source: 'yuno', kind: 'venue', id, name: id, avatar_url: null, city: null, role });

describe('collabInvite', () => {
  it('le principal est un club quand une organisation mène, une organisation quand un club mène', () => {
    expect(principalKindFor('organizer')).toBe('venue');
    expect(principalKindFor('venue')).toBe('org');
  });

  it('propose « Partenaire » par défaut, jamais la main sur la soirée', () => {
    const ctx = { lead: 'organizer' as const, principalOpen: true };
    expect(defaultRole({ source: 'yuno', kind: 'venue' }, ctx, [])).toBe('viewer');
    expect(defaultRole({ source: 'yuno', kind: 'venue' }, ctx, [club('a', 'principal')])).toBe('viewer');
    expect(defaultRole({ source: 'yuno', kind: 'org' }, ctx, [])).toBe('viewer');
  });

  it('une organisation n’est jamais le lieu, un club jamais l’organisateur', () => {
    expect(allowedRoles({ source: 'yuno', kind: 'org' }, { lead: 'organizer', principalOpen: true })).toEqual(['editor', 'viewer']);
    expect(allowedRoles({ source: 'yuno', kind: 'venue' }, { lead: 'venue', principalOpen: true })).toEqual(['editor', 'viewer']);
    expect(allowedRoles({ source: 'yuno', kind: 'org' }, { lead: 'venue', principalOpen: true })).toEqual(['principal', 'editor', 'viewer']);
  });

  it('pas de principal sur une soirée privée ou déjà pourvue', () => {
    expect(allowedRoles({ source: 'yuno', kind: 'venue' }, { lead: 'organizer', principalOpen: false })).toEqual(['editor', 'viewer']);
  });

  it('un club invité par email ne peut arriver que comme lieu', () => {
    const ctx = { lead: 'organizer' as const, principalOpen: true };
    expect(allowedRoles({ source: 'email', kind: 'venue' }, ctx)).toEqual(['principal']);
    expect(allowedRoles({ source: 'email', kind: 'venue' }, ctx, [club('x', 'principal')])).toEqual([]);
    expect(defaultRole({ source: 'email', kind: 'venue' }, { lead: 'venue', principalOpen: true }, [])).toBeNull();
    expect(allowedRoles({ source: 'email', kind: 'org' }, ctx)).toEqual(['editor', 'viewer']);
  });

  it('clés stables, email insensible à la casse', () => {
    expect(partnerDraftKey(org('u1'))).toBe('org:u1');
    expect(partnerDraftKey({ source: 'email', kind: 'org', email: 'A@B.fr', name: '', role: 'viewer' })).toBe('email:a@b.fr');
  });

  it('contrat Yuno = virement encaissé par le lead, parts bornées, bar au club', () => {
    expect(yunoContractRules({ ticketsOrgPct: 130, tablesOrgPct: -5 }, 'organizer')).toEqual({
      tickets: { organizer_pct: 100, venue_pct: 0 },
      tables: { organizer_pct: 0, venue_pct: 100 },
      drinks: { organizer_pct: 0, venue_pct: 100 },
      settlement: { mode: 'transfer', collector: 'organizer', payment_terms_days: 15 },
    });
  });

  it('termes « réglé entre vous » : qui encaisse chaque pilier, pas de règles', () => {
    const t = principalTerms({
      mode: 'venue_rental', agreement: 'external', collectors: { tickets: 'organizer', tables: 'venue' },
      split: { ticketsOrgPct: 50, tablesOrgPct: 0 }, lead: 'organizer',
    });
    expect(t).toEqual({ mode: 'venue_rental', agreement: 'external', tickets: 'organizer', tables: 'venue' });
  });

  it('invitation email d’un club : l’accord et le mode voyagent dans les conditions', () => {
    expect(clubEmailInviteRules({ mode: 'org_hosted', agreement: 'external' })).toMatchObject({
      agreement: 'external', event_mode: 'org_hosted',
      tickets: { organizer_pct: 100 }, tables: { organizer_pct: 100 },
    });
    const y = clubEmailInviteRules(principalTerms({
      mode: 'co_event', agreement: 'yuno', collectors: { tickets: 'organizer', tables: 'venue' },
      split: { ticketsOrgPct: 70, tablesOrgPct: 0 }, lead: 'organizer',
    }));
    expect(y).toMatchObject({ event_mode: 'co_event', tickets: { organizer_pct: 70, venue_pct: 30 } });
  });
});
