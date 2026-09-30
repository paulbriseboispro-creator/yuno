import { describe, expect, it } from 'vitest';
import { broughtShare, followerLift, isCollabNight, myParty, sharePct, windowDays, type CommunityParty } from '../eventCommunity';

const party = (over: Partial<CommunityParty>): CommunityParty => ({
  party: 'venue:a', name: 'A', kind: 'venue', role: 'lead', shareCrm: true, avatar: null, mine: false,
  brought: 0, broughtNew: 0, emailTotal: 0, emailGained: 0, smsTotal: 0, smsGained: 0,
  followersGained: 0, followersLost: 0, followersEventPage: 0, followersAttendees: 0, followersTotal: null, ...over,
});

describe('parts', () => {
  it('se taisent sous 10 personnes et se lisent au dixième', () => {
    expect(sharePct(3, 9)).toBeNull();
    expect(sharePct(1, 12)).toBe(8.3);
  });
});

describe('abonnés : le rythme de la soirée face à l’habitude', () => {
  const f = { gained: 12, lost: 1, eventPage: 4, attendees: 5, total: 100, baselinePerDay: 0.4 };
  it('compte les abonnés attendus au rythme habituel', () => {
    expect(followerLift(f, 10)).toEqual({ expected: 4, lift: 3 });
  });
  it('ne compare pas quand la base est trop mince', () => {
    expect(followerLift({ ...f, baselinePerDay: 0.02 }, 10)).toEqual({ expected: 0.2, lift: null });
  });
  it('la fenêtre dure au moins un jour', () => {
    expect(windowDays({ from: '2026-09-01T10:00:00Z', to: '2026-09-01T11:00:00Z' })).toBe(1);
    expect(windowDays({ from: '2026-09-01T00:00:00Z', to: '2026-09-16T00:00:00Z' })).toBe(15);
  });
});

describe('soirée à plusieurs', () => {
  const c = { parties: [party({ party: 'venue:a', brought: 30, mine: false }), party({ party: 'org:b', brought: 10, mine: true })] };
  it('reconnaît une collaboration et la partie de l’appelant', () => {
    expect(isCollabNight(c)).toBe(true);
    expect(isCollabNight({ parties: [party({})] })).toBe(false);
    expect(myParty(c as never)?.party).toBe('org:b');
    expect(myParty({ parties: [party({ party: 'venue:a' })] } as never)?.party).toBe('venue:a');
  });
  it('rend la part amenée par chacun parmi les personnes attribuées', () => {
    expect(broughtShare(c.parties[0], c.parties)).toBe(75);
    expect(broughtShare(party({}), [party({})])).toBeNull();
  });
});
