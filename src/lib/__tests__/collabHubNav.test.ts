import { describe, it, expect } from 'vitest';
import {
  resolveCollabHubTab, collabNightStep, mergeCollabNights, collabNightHref, type CollabNight,
} from '@/lib/collabHubNav';

const NOW = new Date('2026-09-29T12:00:00Z');
const future = { startAt: '2026-10-10T21:00:00Z', endAt: '2026-10-11T05:00:00Z' };
const past = { startAt: '2026-09-01T21:00:00Z', endAt: '2026-09-02T05:00:00Z' };

const night = (over: Partial<CollabNight>): CollabNight => ({
  eventId: 'e1', title: 'Goya', posterUrl: null, partners: [], collab: null, coorg: null, ...future, ...over,
});
const contract = (contractStatus: string | null, extra: Partial<NonNullable<CollabNight['collab']>> = {}) => ({
  contractStatus, initiatedByMe: false, paused: false, isActive: true, ...extra,
});

describe('hub Collaborations — adresse', () => {
  it('deux onglets canoniques', () => {
    expect(resolveCollabHubTab('nights')).toEqual({ tab: 'nights', openInvite: false, rewrite: false });
    expect(resolveCollabHubTab('partners')).toEqual({ tab: 'partners', openInvite: false, rewrite: false });
    expect(resolveCollabHubTab(null)).toEqual({ tab: 'nights', openInvite: false, rewrite: false });
  });
  it('les anciennes adresses restent valables', () => {
    expect(resolveCollabHubTab('events')).toEqual({ tab: 'nights', openInvite: false, rewrite: true });
    expect(resolveCollabHubTab('coorg')).toEqual({ tab: 'nights', openInvite: false, rewrite: true });
    expect(resolveCollabHubTab('organizers')).toEqual({ tab: 'partners', openInvite: false, rewrite: true });
    expect(resolveCollabHubTab('invite')).toEqual({ tab: 'nights', openInvite: true, rewrite: true });
  });
  it('valeur inconnue : une page valide', () => {
    expect(resolveCollabHubTab('nimportequoi').tab).toBe('nights');
  });
});

describe('hub Collaborations — l’étape d’une soirée', () => {
  it('le contrat à signer passe devant tout, sauf la pause', () => {
    expect(collabNightStep(night({ collab: contract('pending_signatures') }), NOW)).toBe('to_sign');
    expect(collabNightStep(night({ collab: contract('pending_signatures', { initiatedByMe: true }) }), NOW)).toBe('awaiting_partner');
    expect(collabNightStep(night({ collab: contract('pending_signatures', { paused: true }) }), NOW)).toBe('paused');
  });
  it('co-organisation : accord, virements, soldé', () => {
    const coorg = { pendingInvites: 0, dealStatus: null, settlementStatus: null } as const;
    expect(collabNightStep(night({ coorg: { ...coorg, dealStatus: 'pending' } }), NOW)).toBe('deal_to_approve');
    expect(collabNightStep(night({ ...past, coorg: { ...coorg, settlementStatus: 'approved' } }), NOW)).toBe('transfers');
    expect(collabNightStep(night({ ...past, coorg: { ...coorg, settlementStatus: 'settled' } }), NOW)).toBe('settled');
    expect(collabNightStep(night({ coorg: { ...coorg, pendingInvites: 2 } }), NOW)).toBe('invite_pending');
    expect(collabNightStep(night({ coorg }), NOW)).toBe('coorganized');
  });
  it('contrat signé, annulé, clos, soirée passée', () => {
    expect(collabNightStep(night({ collab: contract('active') }), NOW)).toBe('signed');
    expect(collabNightStep(night({ collab: contract('cancelled') }), NOW)).toBe('cancelled');
    expect(collabNightStep(night({ ...past, collab: contract('closed') }), NOW)).toBe('settled');
    expect(collabNightStep(night({ ...past, collab: contract('active') }), NOW)).toBe('ended');
  });
  it('accord « réglé entre vous » : pas de contrat, pastille propre', () => {
    expect(collabNightStep(night({ collab: contract(null, { external: true }) }), NOW)).toBe('external');
    expect(collabNightStep(night({ collab: contract(null, { external: true, isActive: false }) }), NOW)).toBe('external');
    // une demande Yuno annulée puis « entre vous » : jamais « Contrat annulé »
    expect(collabNightStep(night({ collab: contract('cancelled', { external: true }) }), NOW)).toBe('external');
    // un contrat Yuno proposé ensuite reprend la main
    expect(collabNightStep(night({ collab: contract('pending_signatures', { external: true }) }), NOW)).toBe('to_sign');
    expect(collabNightStep(night({ ...past, collab: contract(null, { external: true }) }), NOW)).toBe('ended');
  });
  it('co-soirée héritée sans contrat : la publication tient lieu d’état', () => {
    expect(collabNightStep(night({ collab: contract(null) }), NOW)).toBe('signed');
    expect(collabNightStep(night({ collab: contract(null, { isActive: false }) }), NOW)).toBe('draft');
  });
});

describe('hub Collaborations — une seule liste', () => {
  it('une soirée collab + co-organisation = une carte, partenaires réunis', () => {
    const merged = mergeCollabNights(
      [night({ eventId: 'a', partners: ['Goya'], collab: contract('active') })],
      [night({ eventId: 'a', partners: ['Goya', 'Amoris'], posterUrl: 'x.jpg', coorg: { pendingInvites: 0, dealStatus: 'active', settlementStatus: null } })],
      NOW,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].partners).toEqual(['Goya', 'Amoris']);
    expect(merged[0].collab?.contractStatus).toBe('active');
    expect(merged[0].coorg?.dealStatus).toBe('active');
    expect(merged[0].posterUrl).toBe('x.jpg');
  });
  it('à venir (la plus proche d’abord) puis passées (la plus récente d’abord)', () => {
    const merged = mergeCollabNights(
      [
        night({ eventId: 'loin', startAt: '2026-12-01T21:00:00Z', endAt: '2026-12-02T05:00:00Z' }),
        night({ eventId: 'vieux', startAt: '2026-06-01T21:00:00Z', endAt: '2026-06-02T05:00:00Z' }),
      ],
      [
        night({ eventId: 'proche' }),
        night({ eventId: 'recent', ...past }),
      ],
      NOW,
    );
    expect(merged.map((n) => n.eventId)).toEqual(['proche', 'loin', 'recent', 'vieux']);
  });
  it('la page qui répond : contrat, sinon co-organisation', () => {
    expect(collabNightHref({ eventId: 'e', collab: contract('active') }, 'venue')).toBe('/owner/collab/event/e');
    expect(collabNightHref({ eventId: 'e', collab: contract('active') }, 'organizer')).toBe('/organizer-app/events/e');
    expect(collabNightHref({ eventId: 'e', collab: null }, 'venue')).toBe('/owner/coorg/e');
    expect(collabNightHref({ eventId: 'e', collab: null }, 'organizer')).toBe('/organizer-app/coorg/e');
  });
});
