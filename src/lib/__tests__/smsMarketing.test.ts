import { describe, expect, it } from 'vitest';
import {
  composeSmsBody, smsSizing, worstSegments, gsm7Length, maskPhone, isFrenchNumber, toSenderId, senderIdError,
  isFrenchPublicHoliday, smsHoldReason, parisClock, resolveSmsVars,
} from '../smsMarketing';

describe('smsSizing', () => {
  it('counts a plain GSM-7 message as one segment up to 160 chars', () => {
    const s = smsSizing('a'.repeat(160));
    expect(s.encoding).toBe('GSM-7');
    expect(s.segments).toBe(1);
    expect(smsSizing('a'.repeat(161)).segments).toBe(2);
    expect(smsSizing('a'.repeat(306)).segments).toBe(2);
    expect(smsSizing('a'.repeat(307)).segments).toBe(3);
  });
  it('counts extended GSM characters twice', () => {
    expect(gsm7Length('€')).toBe(2);
    expect(gsm7Length('{}')).toBe(4);
  });
  it('switches to UCS-2 as soon as an emoji or a non-GSM letter appears', () => {
    const s = smsSizing('Soirée 🔥 ce soir');
    expect(s.encoding).toBe('UCS-2');
    expect(s.singleLimit).toBe(70);
    expect(smsSizing('ê'.repeat(70)).segments).toBe(1);
    expect(smsSizing('ê'.repeat(71)).segments).toBe(2);
  });
  it('returns 0 segments for an empty text', () => {
    expect(smsSizing('').segments).toBe(0);
  });
});

describe('composeSmsBody', () => {
  it('prefixes the sender name and appends Octopush\'s STOP short code for a French number', () => {
    expect(composeSmsBody('Dernières places ce soir', 'fr', 'WOH')).toBe('WOH : Dernières places ce soir\nSTOP au 30101');
    expect(composeSmsBody('Last tickets tonight', 'en', 'WOH')).toBe('WOH : Last tickets tonight\nSTOP au 30101');
  });
  it('uses the recipient language outside France (no short code there)', () => {
    expect(composeSmsBody('Last tickets tonight', 'en', 'WOH', null, { french: false })).toBe('WOH : Last tickets tonight\nReply STOP to opt out');
    expect(composeSmsBody('Últimas entradas', 'es', 'WOH', null, { french: false })).toBe('WOH : Últimas entradas\nResponde STOP para darte de baja');
    expect(composeSmsBody('Hola', 'de', null, null, { french: false })).toContain('STOP pour ne plus recevoir');
  });
  it('does not double the sender or the STOP mention when already present', () => {
    expect(composeSmsBody('WOH vous attend. STOP au 30101', 'fr', 'WOH')).toBe('WOH vous attend. STOP au 30101');
    expect(composeSmsBody('Ce soir chez woh !', 'fr', 'WOH')).toBe('Ce soir chez woh !\nSTOP au 30101');
    // Un autre code court ne vaut pas celui d'Octopush : la bonne mention est ajoutée.
    expect(composeSmsBody('STOP au 36180', 'fr', null)).toBe('STOP au 36180\nSTOP au 30101');
  });
  it('replaces the {lien} token with the tracked link, or removes it', () => {
    expect(composeSmsBody('Billets : {lien}', 'fr', null, 'https://yunoapp.eu/l/abc')).toBe('Billets : https://yunoapp.eu/l/abc\nSTOP au 30101');
    expect(composeSmsBody('Billets : {lien} vite', 'fr', null, null)).toBe('Billets : vite\nSTOP au 30101');
  });
});

describe('isFrenchNumber', () => {
  it('covers metropolitan France and the overseas departments', () => {
    expect(isFrenchNumber('+33612345678')).toBe(true);
    expect(isFrenchNumber('+262692123456')).toBe(true);
    expect(isFrenchNumber('+34612345678')).toBe(false);
    expect(isFrenchNumber(null)).toBe(false);
  });
});

describe('sender id (what shows instead of a number)', () => {
  it('derives a valid id from a free name', () => {
    expect(toSenderId('Mad by Night')).toBe('MADBYNIGHT');
    expect(toSenderId('Café de l’Été — Paris 11e')).toBe('CAFEDELETEP');
    expect(toSenderId('Ô')).toBeNull();
    expect(toSenderId('Info')).toBeNull();
  });
  it('explains what is wrong', () => {
    expect(senderIdError('AMORIS')).toBeNull();
    expect(senderIdError('AB')).toBe('length');
    expect(senderIdError('LE BUNKER')).toBe('chars');
    expect(senderIdError('ÉTÉ2026')).toBe('chars');
    expect(senderIdError('123456')).toBe('digits');
    expect(senderIdError('promo')).toBe('generic');
  });
});

describe('sending hours (Paris)', () => {
  const rules = { on: true, from: 20, to: 8, noSunday: true };
  it('knows French public holidays, Easter-based ones included', () => {
    expect(isFrenchPublicHoliday('2026-07-14')).toBe(true);
    expect(isFrenchPublicHoliday('2026-04-06')).toBe(true); // lundi de Pâques 2026
    expect(isFrenchPublicHoliday('2026-05-14')).toBe(true); // Ascension 2026
    expect(isFrenchPublicHoliday('2026-05-25')).toBe(true); // lundi de Pentecôte 2026
    expect(isFrenchPublicHoliday('2027-03-29')).toBe(true); // lundi de Pâques 2027
    expect(isFrenchPublicHoliday('2026-10-09')).toBe(false);
  });
  it('holds marketing SMS at night whatever the settings, and on quiet hours, Sundays, holidays', () => {
    // 2026-10-09 = vendredi ; heure d'été de Paris = UTC+2.
    expect(smsHoldReason(new Date('2026-10-09T19:45:00Z'), { ...rules, on: false })).toBe('legal_night'); // 21 h 45
    expect(smsHoldReason(new Date('2026-10-09T05:30:00Z'), { ...rules, on: false })).toBe('legal_night'); // 7 h 30
    expect(smsHoldReason(new Date('2026-10-09T18:30:00Z'), rules)).toBe('quiet'); // 20 h 30
    expect(smsHoldReason(new Date('2026-10-09T18:30:00Z'), { ...rules, on: false })).toBeNull();
    expect(smsHoldReason(new Date('2026-10-11T10:00:00Z'), rules)).toBe('sunday');
    expect(smsHoldReason(new Date('2026-11-11T10:00:00Z'), rules)).toBe('holiday'); // CET = UTC+1
    expect(smsHoldReason(new Date('2026-10-09T16:00:00Z'), rules)).toBeNull();
  });
  it('reads the Paris clock with formatToParts', () => {
    expect(parisClock(new Date('2026-10-09T22:30:00Z'))).toMatchObject({ hour: 0, minute: 30, dow: 6, ymd: '2026-10-10' });
  });
});

describe('resolveSmsVars', () => {
  it('fills known variables and keeps unknown ones visible', () => {
    expect(resolveSmsVars('Salut {{prénom}} ! {{lien}} {{x}}', { 'prénom': 'Adam', lien: 'yunoapp.eu/go/a' })).toBe('Salut Adam ! yunoapp.eu/go/a {{x}}');
  });
});

describe('worstSegments', () => {
  it('takes the most expensive language into account', () => {
    const body = 'a'.repeat(120);
    expect(worstSegments(body, null, 'WOH', false)).toBe(1);
    expect(worstSegments(body, { en: 'b'.repeat(150) }, 'WOH', true)).toBe(2);
  });
});

describe('maskPhone', () => {
  it('keeps the country prefix and the last two digits only', () => {
    expect(maskPhone('+33644216689')).toBe('+336 •• •• •• 89');
  });
});
