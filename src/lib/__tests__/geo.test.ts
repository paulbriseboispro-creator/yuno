import { describe, expect, it } from 'vitest';
import { marketCity, marketCountry, marketProps } from '@/lib/geo';
import { surfaceFor } from '@/lib/posthogSurface';

describe('marketCountry', () => {
  it('lit le fuseau d’abord', () => {
    expect(marketCountry('Europe/Paris', 'Madrid')).toBe('FR');
    expect(marketCountry('Europe/Madrid')).toBe('ES');
    expect(marketCountry('Atlantic/Canary')).toBe('ES');
  });
  it('retombe sur la ville', () => {
    expect(marketCountry(null, 'Barcelone')).toBe('ES');
    expect(marketCountry(undefined, 'Paris, France')).toBe('FR');
    expect(marketCountry(null, '75011 Paris')).toBe('FR');
    expect(marketCountry(null, 'Málaga')).toBe('ES');
  });
  it('ne devine pas', () => {
    expect(marketCountry(null, 'Nowhere')).toBeNull();
    expect(marketCountry(null, null)).toBeNull();
  });
});

describe('marketCity', () => {
  it('normalise', () => {
    expect(marketCity('  paris ,France')).toBe('Paris');
    expect(marketCity('Barcelone')).toBe('Barcelona');
    expect(marketCity('aix-en-provence')).toBe('Aix-En-Provence');
    expect(marketCity('')).toBeNull();
  });
});

describe('marketProps', () => {
  it('ne pose pas les clés absentes', () => {
    expect(marketProps({ timezone: 'Europe/Madrid', city: 'madrid', eventId: 'e1' })).toEqual({
      market_country: 'ES',
      market_city: 'Madrid',
      event_id: 'e1',
    });
  });
});

describe('surfaceFor', () => {
  const web = { native: false, proApp: false, standalone: false };
  it('distingue les surfaces', () => {
    expect(surfaceFor('/explore', web)).toBe('web_app');
    expect(surfaceFor('/explore', { ...web, standalone: true })).toBe('pwa');
    expect(surfaceFor('/owner/dashboard', web)).toBe('console');
    expect(surfaceFor('/organizer-app', web)).toBe('console');
    expect(surfaceFor('/admin/growth', web)).toBe('admin');
    expect(surfaceFor('/explore', { ...web, native: true })).toBe('ios_app');
    expect(surfaceFor('/bouncer', { native: true, proApp: true, standalone: false })).toBe('ios_pro');
    expect(surfaceFor('/dj/some-dj', web)).toBe('web_app');
  });
});
