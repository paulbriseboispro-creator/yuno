import { describe, it, expect } from 'vitest';
import { isGuestPassPath, scrubGuestPassProps, scrubGuestPassUrl } from '../posthogScrub';

describe('posthogScrub', () => {
  it('masque le QR dans toute URL /t/<qr>', () => {
    expect(scrubGuestPassUrl('https://yunoapp.eu/t/TG-ABC123?x=1')).toBe('https://yunoapp.eu/t/:qr');
    expect(scrubGuestPassUrl('/t/TG-ABC123')).toBe('/t/:qr');
    expect(scrubGuestPassUrl('https://yunoapp.eu/explore')).toBe('https://yunoapp.eu/explore');
    expect(scrubGuestPassUrl('https://yunoapp.eu/ticket/abc')).toBe('https://yunoapp.eu/ticket/abc');
  });
  it('nettoie les propriétés d URL seulement', () => {
    const out = scrubGuestPassProps({
      $current_url: 'https://yunoapp.eu/t/TG-1', $pathname: '/t/TG-1', $referrer: 'https://yunoapp.eu/t/TG-2',
      title: '/t/untouched', surface: 'web_app',
    });
    expect(out).toEqual({ $current_url: 'https://yunoapp.eu/t/:qr', $pathname: '/t/:qr', $referrer: 'https://yunoapp.eu/t/:qr', title: '/t/untouched', surface: 'web_app' });
  });
  it('reconnaît la page laissez-passer', () => {
    expect(isGuestPassPath('/t/TG-1')).toBe(true);
    expect(isGuestPassPath('/tables')).toBe(false);
    expect(isGuestPassPath('/')).toBe(false);
  });
});
