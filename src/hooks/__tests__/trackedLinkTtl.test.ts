import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EVENT_TRACKED_LINK_TTL_MS, getTrackedLinkForCheckout, setActiveTrackedLink, setTrackedLinkForEvent,
} from '../usePurchaseSourceTracking';

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => { m.delete(k); },
    setItem: (k, v) => { m.set(k, String(v)); },
  };
}

const EVENT = 'c0ffee00-25a9-4d3e-9c1a-0000000000a1';
const LINK = '717bc303-0528-4722-ac0e-9830e18ddf38';
const HOUR = 60 * 60 * 1000;

describe('mémoire du lien suivi (attribution des partenaires)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-16T10:00:00Z'));
    vi.stubGlobal('localStorage', memoryStorage());
    vi.stubGlobal('sessionStorage', memoryStorage());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("garde le lien d'une soirée 7 jours", () => {
    expect(EVENT_TRACKED_LINK_TTL_MS).toBe(7 * 24 * HOUR);
    setTrackedLinkForEvent(EVENT, LINK);
    vi.advanceTimersByTime(3 * 24 * HOUR);
    expect(getTrackedLinkForCheckout(EVENT)).toBe(LINK);
    vi.advanceTimersByTime(4 * 24 * HOUR + 1);
    expect(getTrackedLinkForCheckout(EVENT)).toBe(null);
  });

  it('le dernier lien cliqué pour la soirée gagne', () => {
    setTrackedLinkForEvent(EVENT, LINK);
    setTrackedLinkForEvent(EVENT, 'other-link');
    expect(getTrackedLinkForCheckout(EVENT)).toBe('other-link');
  });

  it('le lien de profil (sans soirée) reste limité à 6 h', () => {
    setActiveTrackedLink(LINK);
    vi.advanceTimersByTime(5 * HOUR);
    expect(getTrackedLinkForCheckout(EVENT)).toBe(LINK);
    vi.advanceTimersByTime(HOUR + 1);
    expect(getTrackedLinkForCheckout(EVENT)).toBe(null);
  });
});
