import { describe, it, expect } from 'vitest';
import { isCreditNotePath, isSecretLinkPath, isGuestPassPath, scrubGuestPassProps, scrubGuestPassUrl } from '../posthogScrub';

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
  it('masque le jeton d un avoir, URL et referrer, et coupe le replay', () => {
    expect(scrubGuestPassUrl('https://yunoapp.eu/avoir/abc123def?x=1')).toBe('https://yunoapp.eu/avoir/:token');
    expect(scrubGuestPassUrl('/avoir/abc123')).toBe('/avoir/:token');
    const out = scrubGuestPassProps({ $current_url: 'https://yunoapp.eu/avoir/abc1', $referrer: 'https://yunoapp.eu/avoir/abc2', $pathname: '/avoir/abc1' });
    expect(out).toEqual({ $current_url: 'https://yunoapp.eu/avoir/:token', $referrer: 'https://yunoapp.eu/avoir/:token', $pathname: '/avoir/:token' });
    expect(isCreditNotePath('/avoir/abc')).toBe(true);
    expect(isCreditNotePath('/avoirs')).toBe(false);
    expect(isSecretLinkPath('/avoir/abc')).toBe(true);
    expect(isSecretLinkPath('/t/TG-1')).toBe(true);
    expect(isSecretLinkPath('/explore')).toBe(false);
  });
});
