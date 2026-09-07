import { describe, expect, it } from 'vitest';
import { composeSmsBody, smsSizing, worstSegments, gsm7Length, maskPhone } from '../smsMarketing';

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
  it('prefixes the sender name and appends the STOP mention in the recipient language', () => {
    expect(composeSmsBody('Dernières places ce soir', 'fr', 'WOH')).toBe('WOH : Dernières places ce soir\nSTOP pour ne plus recevoir');
    expect(composeSmsBody('Last tickets tonight', 'en', 'WOH')).toBe('WOH : Last tickets tonight\nReply STOP to opt out');
    expect(composeSmsBody('Últimas entradas', 'es', 'WOH')).toBe('WOH : Últimas entradas\nResponde STOP para darte de baja');
  });
  it('does not double the sender or the STOP mention when already present', () => {
    expect(composeSmsBody('WOH vous attend. STOP au 36180', 'fr', 'WOH')).toBe('WOH vous attend. STOP au 36180');
    expect(composeSmsBody('Ce soir chez woh !', 'fr', 'WOH')).toBe('Ce soir chez woh !\nSTOP pour ne plus recevoir');
  });
  it('replaces the {lien} token with the tracked link, or removes it', () => {
    expect(composeSmsBody('Billets : {lien}', 'fr', null, 'https://yunoapp.eu/l/abc')).toBe('Billets : https://yunoapp.eu/l/abc\nSTOP pour ne plus recevoir');
    expect(composeSmsBody('Billets : {lien} vite', 'fr', null, null)).toBe('Billets : vite\nSTOP pour ne plus recevoir');
  });
  it('falls back to French for unknown languages', () => {
    expect(composeSmsBody('Hola', 'de', null)).toContain('STOP pour ne plus recevoir');
  });
});

describe('worstSegments', () => {
  it('takes the most expensive language into account', () => {
    const body = 'a'.repeat(120);
    expect(worstSegments(body, null, 'WOH', false)).toBe(1);
    expect(worstSegments(body, { en: 'b'.repeat(140) }, 'WOH', true)).toBe(2);
  });
});

describe('maskPhone', () => {
  it('keeps the country prefix and the last two digits only', () => {
    expect(maskPhone('+33644216689')).toBe('+336 •• •• •• 89');
  });
});
