import { describe, expect, it } from 'vitest';
import {
  buildPartnerShare, cleanPartnerName, contactKindOf, isPartnerToken, isReservedPartnerName,
  isValidPartnerCode, isValidPartnerContact, partnerConversion, partnerInitial, partnerPageUrl,
  partnerSendHref, partnerShareMessage, sanitizePartnerCodeInput, suggestPartnerCode,
} from '../partnerLinks';
import {
  PARTNER_LANGUAGES, PARTNER_WORD_KEYS, partnerLocale, partnerWords, toPartnerLanguage,
} from '../partnerLinkWords';

describe('partnerLinks', () => {
  it('nettoie le nom et refuse un nom de canal', () => {
    expect(cleanPartnerName('  Sami   B. ')).toBe('Sami B.');
    expect(isReservedPartnerName(' Instagram ')).toBe(true);
    expect(isReservedPartnerName('coorg')).toBe(true);
    expect(isReservedPartnerName('Sami')).toBe(false);
  });

  it('propose un code lisible et valide', () => {
    // La soirée d'abord, puis le partenaire : la même adresse que la base écrit.
    const code = suggestPartnerCode('Léa Müller', 'Nuit Amoris : Édition #3');
    expect(code).toBe('nuit-amoris-edition-3-lea-muller');
    expect(isValidPartnerCode(code)).toBe(true);
    expect(suggestPartnerCode('Telos', 'House Of Masquerade')).toBe('house-of-masquerade-telos');
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

  it('écrit le message dans la langue de la page, pas celle de la Console', () => {
    const row = {
      code: 'sami-nuit', partner_name: 'Sami B.', partner_token: '0d7253b08aa64457acaf7b5131f5e5d3',
      partner_contact: 'sami@example.com',
    };
    const es = buildPartnerShare({ ...row, partner_language: 'es' }, 'Nuit Amoris', 'https://yunoapp.eu');
    expect(es.message.startsWith('¡Hola Sami! Aquí tienes tu enlace para Nuit Amoris: https://yunoapp.eu/l/sami-nuit')).toBe(true);
    expect(es.message).toContain('https://yunoapp.eu/stats/0d7253b08aa64457acaf7b5131f5e5d3');
    expect(es.href).toContain(encodeURIComponent('Tu enlace para Nuit Amoris'));
    const fr = buildPartnerShare({ ...row, partner_language: 'fr' }, 'Nuit Amoris');
    expect(fr.message.startsWith('Salut Sami !')).toBe(true);
    // Langue absente ou inconnue (ancienne ligne) : anglais.
    expect(buildPartnerShare({ ...row, partner_language: null }, 'X').message.startsWith('Hi Sami!')).toBe(true);
    expect(buildPartnerShare({ ...row, partner_language: 'de' }, 'X').message.startsWith('Hi Sami!')).toBe(true);
  });
});

describe('partnerLinkWords', () => {
  it('a chaque mot dans les trois langues, avec les mêmes variables', () => {
    const vars = (s: string) => (s.match(/\{[a-z]+\}/g) ?? []).sort().join(',');
    for (const key of PARTNER_WORD_KEYS) {
      const [en, fr, es] = PARTNER_LANGUAGES.map((l) => partnerWords(l)(key));
      for (const v of [en, fr, es]) expect(v.trim().length, key).toBeGreaterThan(0);
      expect(vars(fr), key).toBe(vars(en));
      expect(vars(es), key).toBe(vars(en));
    }
  });

  it('ramène toute langue inconnue à un repli', () => {
    expect(toPartnerLanguage('es')).toBe('es');
    expect(toPartnerLanguage('ES')).toBe('en');
    expect(toPartnerLanguage(undefined, 'fr')).toBe('fr');
    expect(partnerLocale('es')).toBe('es-ES');
    expect(partnerWords('fr')('yourLink')).toBe('Ton lien');
  });
});
