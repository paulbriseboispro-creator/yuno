import { describe, expect, it } from 'vitest';
import { bestSlots, effectiveSendAt, sendChecks, verdict, waveMinutesOf, waveThrottle } from '../emailSend';
import type { EmailBlock } from '@/lib/email/types';

describe('effectiveSendAt', () => {
  it('leaves a day-time slot alone', () => {
    const at = new Date(2026, 9, 10, 10, 0);
    expect(effectiveSendAt(at, true)).toEqual({ at, shifted: false });
  });
  it('moves a late-night slot to 9:00 the next morning', () => {
    const r = effectiveSendAt(new Date(2026, 9, 10, 23, 30), true);
    expect(r.shifted).toBe(true);
    expect([r.at.getDate(), r.at.getHours(), r.at.getMinutes()]).toEqual([11, 9, 0]);
  });
  it('moves an early-morning slot to 9:00 the same day', () => {
    const r = effectiveSendAt(new Date(2026, 9, 10, 6, 15), true);
    expect([r.at.getDate(), r.at.getHours()]).toEqual([10, 9]);
  });
  it('ignores quiet hours when they are off', () => {
    expect(effectiveSendAt(new Date(2026, 9, 10, 2, 0), false).shifted).toBe(false);
  });
});

describe('waveThrottle', () => {
  it('splits 30 min into two 15-minute windows', () => {
    expect(waveThrottle(1000, 30)).toEqual({ perWindow: 500, window: 15 });
  });
  it('uses 30-minute windows for two hours', () => {
    expect(waveThrottle(1000, 120)).toEqual({ perWindow: 250, window: 30 });
  });
  it('never goes under the engine floor of 10', () => {
    expect(waveThrottle(12, 60).perWindow).toBe(10);
  });
  it('reads back the closest duration', () => {
    const w = waveThrottle(4000, 120);
    expect(waveMinutesOf(w.perWindow, w.window, 4000)).toBe(120);
    expect(waveMinutesOf(null, null, 10)).toBe(60);
  });
});

describe('bestSlots', () => {
  it('ranks days and 2-hour slots by click rate, ignoring thin cells', () => {
    const grid = [
      { d: 3, h: 1, n: 100, clicked: 30 },
      { d: 4, h: 5, n: 100, clicked: 20 },
      { d: 0, h: 0, n: 100, clicked: 5 },
      { d: 6, h: 2, n: 10, clicked: 9 },
    ];
    expect(bestSlots(grid)).toEqual({ days: [3, 4], hours: [10, 18] });
    expect(bestSlots(undefined)).toEqual({ days: [], hours: [] });
  });
});

describe('sendChecks', () => {
  const base = { subject: 'Samedi, on ouvre', preheader: 'Infos', eventId: 'e1', net: 100, balance: 500, past: false, demo: false };
  const cta = { id: 'c', type: 'cta', label: 'Voir', url: 'https://shotgun.live/x', align: 'center', radius: 999, full: false } as EmailBlock;

  it('is ready when everything is filled in', () => {
    const v = verdict(sendChecks({ ...base, blocks: [cta] }));
    expect(v.bad).toBe(0);
  });
  it('blocks without subject, audience or Yunits', () => {
    const c = sendChecks({ ...base, subject: '', net: 0, blocks: [cta] });
    expect(c.filter((x) => x.level === 'bad').map((x) => x.id)).toEqual(['subj', 'aud']);
    const short = sendChecks({ ...base, net: 900, blocks: [cta] }).find((x) => x.id === 'bal');
    expect(short?.level).toBe('bad');
    expect(short?.vars?.miss).toBe(400);
  });
  it('blocks a button without a link and a night card bound to nothing', () => {
    const dead = { ...cta, url: '' } as EmailBlock;
    const ev = { id: 'e', type: 'event', title: 'x', dateLabel: '', venueLabel: '', ctaLabel: 'Voir', cover: true, venue: true, price: true } as EmailBlock;
    const c = sendChecks({ ...base, eventId: null, blocks: [dead, ev] });
    expect(c.find((x) => x.id === 'link')?.level).toBe('bad');
    expect(c.find((x) => x.id === 'night')?.level).toBe('bad');
  });
  it('blocks a past date and warns on a demo account', () => {
    const c = sendChecks({ ...base, past: true, demo: true, blocks: [cta] });
    expect(c.find((x) => x.id === 'date')?.level).toBe('bad');
    expect(c.find((x) => x.id === 'demo')?.level).toBe('warn');
  });
});
