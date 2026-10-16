import { describe, expect, it } from 'vitest';
import {
  cleanPartnerName, contactKindOf, isPartnerToken, isReservedPartnerName, isValidPartnerCode,
  isValidPartnerContact, partnerConversion, partnerInitial, partnerPageUrl, partnerSendHref,
  partnerShareMessage, sanitizePartnerCodeInput, suggestPartnerCode,
} from '../partnerLinks';

describe('partnerLinks', () => {
  it('nettoie le nom et refuse un nom de canal', () => {
    expect(cleanPartnerName('  Sami   B. ')).toBe('Sami B.');
    expect(isReservedPartnerName(' Instagram ')).toBe(true);
    expect(isReservedPartnerName('coorg')).toBe(true);
    expect(isReservedPartnerName('Sami')).toBe(false);
  });

  it('propose un code lisible et valide', () => {
    const code = suggestPartnerCode('Léa Müller', 'Nuit Amoris : Édition #3', 'k3f9');
    expect(code).toBe('lea-muller-nuit-amoris-edit-k3f9');
    expect(isValidPartnerCode(code)).toBe(true);
    expect(suggestPartnerCode('!!!', '', 'ab12')).toBe('partenaire-ab12');
  });

  it('valide le code /l/', () => {
    expect(isValidPartnerCode('ab')).toBe(false);
    expect(isValidPartnerCode('sami-')).toBe(false);
    expect(isValidPartnerCode('Sami')).toBe(false);
    expect(isValidPartnerCode('sami--b')).toBe(false);
    expect(isValidPartnerCode('sami-b-2')).toBe(true);
    expect(sanitizePartnerCodeInput('  Sàmi  B!')).toBe('sami-b-');
  });

  it('reconnaît un téléphone ou un email', () => {
    expect(contactKindOf('+33 6 12 34 56 78')).toBe('phone');
    expect(contactKindOf('sami@example.com')).toBe('email');
    expect(contactKindOf('+33')).toBe(null);
    expect(contactKindOf('')).toBe(null);
    expect(isValidPartnerContact('')).toBe(true);
    expect(isValidPartnerContact('nope')).toBe(false);
  });

  it('construit le lien d’envoi', () => {
    expect(partnerSendHref('+33 6 12 34 56 78', 's', 'hello you')).toBe('https://wa.me/33612345678?text=hello%20you');
    expect(partnerSendHref('a@b.co', 'Sujet', 'x')).toBe('mailto:a%40b.co?subject=Sujet&body=x');
    expect(partnerSendHref(null, 's', 'x')).toBe(null);
  });

  it('remplit le message et les URL publiques', () => {
    expect(partnerShareMessage('{name} → {link} / {page} ({event})', {
      name: 'Sami', event: 'Nuit', link: 'L', page: 'P',
    })).toBe('Sami → L / P (Nuit)');
    expect(partnerPageUrl('https://yunoapp.eu/', 'abc')).toBe('https://yunoapp.eu/stats/abc');
  });

  it('calcule la conversion et l’initiale', () => {
    expect(partnerConversion(7, 48)).toBe(14.6);
    expect(partnerConversion(1, 0)).toBe(null);
    expect(partnerInitial('DJ Koala')).toBe('K');
    expect(partnerInitial('léa')).toBe('L');
  });

  it('reconnaît un jeton serveur', () => {
    expect(isPartnerToken('0d7253b08aa64457acaf7b5131f5e5d3')).toBe(true);
    expect(isPartnerToken('0D7253B08AA64457ACAF7B5131F5E5D3')).toBe(false);
    expect(isPartnerToken('short')).toBe(false);
  });
});
