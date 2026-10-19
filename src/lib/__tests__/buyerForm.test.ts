import { describe, expect, it } from 'vitest';
import { ageOn, clampDigits, partsFromPaste, readBirthDate, splitIsoBirthDate } from '@/lib/birthDate';
import { isPlausibleEmail, suggestEmail } from '@/lib/emailTypo';
import { buyerFormErrors, firstErrorField, phoneNationalDigits } from '@/lib/buyerForm';

const NOW = new Date(2026, 9, 19); // 19 octobre 2026

describe('readBirthDate', () => {
  it('rend une date ISO quand les trois cases sont justes', () => {
    expect(readBirthDate({ day: '14', month: '03', year: '2001' }, NOW)).toEqual({ status: 'valid', iso: '2001-03-14' });
    expect(readBirthDate({ day: '4', month: '3', year: '2001' }, NOW)).toEqual({ status: 'valid', iso: '2001-03-04' });
  });

  it('dit quelle case manque, dans l’ordre de la page', () => {
    expect(readBirthDate({ day: '', month: '', year: '' }, NOW)).toEqual({ status: 'empty' });
    expect(readBirthDate({ day: '', month: '03', year: '2001' }, NOW)).toEqual({ status: 'incomplete', field: 'day' });
    expect(readBirthDate({ day: '14', month: '', year: '2001' }, NOW)).toEqual({ status: 'incomplete', field: 'month' });
    expect(readBirthDate({ day: '14', month: '03', year: '20' }, NOW)).toEqual({ status: 'incomplete', field: 'year' });
  });

  it('refuse une date impossible, future ou trop ancienne', () => {
    expect(readBirthDate({ day: '31', month: '02', year: '2001' }, NOW).status).toBe('invalid');
    expect(readBirthDate({ day: '29', month: '02', year: '2001' }, NOW).status).toBe('invalid');
    expect(readBirthDate({ day: '29', month: '02', year: '2004' }, NOW).status).toBe('valid');
    expect(readBirthDate({ day: '14', month: '13', year: '2001' }, NOW).status).toBe('invalid');
    expect(readBirthDate({ day: '20', month: '10', year: '2026' }, NOW).status).toBe('invalid');
    expect(readBirthDate({ day: '19', month: '10', year: '2026' }, NOW).status).toBe('valid');
    expect(readBirthDate({ day: '01', month: '01', year: '1899' }, NOW).status).toBe('invalid');
  });

  it('ignore tout ce qui n’est pas un chiffre', () => {
    expect(clampDigits('1a4b', 2)).toBe('14');
    expect(clampDigits('20011', 4)).toBe('2001');
  });
});

describe('collage et aller-retour ISO', () => {
  it('reconnaît les formes courantes', () => {
    expect(partsFromPaste('14/03/2001')).toEqual({ day: '14', month: '03', year: '2001' });
    expect(partsFromPaste('4.3.2001')).toEqual({ day: '04', month: '03', year: '2001' });
    expect(partsFromPaste('2001-03-14')).toEqual({ day: '14', month: '03', year: '2001' });
    expect(partsFromPaste('14032001')).toEqual({ day: '14', month: '03', year: '2001' });
    expect(partsFromPaste('14')).toBeNull();
  });

  it('découpe une date du profil', () => {
    expect(splitIsoBirthDate('2001-03-14')).toEqual({ day: '14', month: '03', year: '2001' });
    expect(splitIsoBirthDate(null)).toEqual({ day: '', month: '', year: '' });
  });

  it('calcule l’âge révolu', () => {
    expect(ageOn('2008-10-19', NOW)).toBe(18);
    expect(ageOn('2008-10-20', NOW)).toBe(17);
  });
});

describe('suggestEmail', () => {
  it('corrige une faute dans un domaine connu', () => {
    expect(suggestEmail('lea.martin@gmial.com')).toBe('lea.martin@gmail.com');
    expect(suggestEmail('lea@hotmal.fr')).toBe('lea@hotmail.fr');
    expect(suggestEmail('lea@gmail.con')).toBe('lea@gmail.com');
    expect(suggestEmail('Lea@Outlok.fr')).toBe('Lea@outlook.fr');
    expect(suggestEmail('lea@yaho.fr')).toBe('lea@yahoo.fr');
  });

  it('se tait sur un domaine juste ou inconnu', () => {
    expect(suggestEmail('lea@gmail.com')).toBeNull();
    expect(suggestEmail('lea@gmx.de')).toBeNull();
    expect(suggestEmail('paul@amoris.fr')).toBeNull();
    expect(suggestEmail('contact@womber.fr')).toBeNull();
    expect(suggestEmail('lea')).toBeNull();
    expect(suggestEmail('lea@')).toBeNull();
  });

  it('lit la forme d’une adresse comme le serveur', () => {
    expect(isPlausibleEmail('lea@gmail.com')).toBe(true);
    expect(isPlausibleEmail(' lea@gmail.com ')).toBe(true);
    expect(isPlausibleEmail('lea@gmail')).toBe(false);
    expect(isPlausibleEmail('lea gmail.com')).toBe(false);
  });
});

describe('buyerFormErrors', () => {
  const ok = { fullName: 'Léa Martin', email: 'lea@gmail.com', phone: '+34 612 34 56 78', birth: { status: 'valid', iso: '2001-03-14' } as const };

  it('ne rend rien pour un formulaire complet', () => {
    expect(buyerFormErrors(ok)).toEqual({});
    expect(buyerFormErrors({ ...ok, birth: null })).toEqual({});
  });

  it('rend un code par champ en défaut', () => {
    expect(buyerFormErrors({ fullName: '', email: '', phone: '', birth: { status: 'empty' } })).toEqual({
      name: 'name_required', email: 'email_required', phone: 'phone_required', birth: 'birth_required',
    });
    expect(buyerFormErrors({ ...ok, fullName: 'L' }).name).toBe('name_short');
    expect(buyerFormErrors({ ...ok, email: 'lea@gmail' }).email).toBe('email_invalid');
    expect(buyerFormErrors({ ...ok, phone: '+34 61' }).phone).toBe('phone_short');
    expect(buyerFormErrors({ ...ok, birth: { status: 'incomplete', field: 'year' } }).birth).toBe('birth_year');
    expect(buyerFormErrors({ ...ok, birth: { status: 'invalid' } }).birth).toBe('birth_invalid');
  });

  it('pointe le premier champ en défaut dans l’ordre de la page', () => {
    expect(firstErrorField({ phone: 'phone_required', birth: 'birth_required' })).toBe('phone');
    expect(firstErrorField({})).toBeNull();
  });

  it('compte les chiffres du numéro hors indicatif', () => {
    expect(phoneNationalDigits('+33 6 12 34 56 78')).toBe(9);
    expect(phoneNationalDigits('+34 6')).toBe(1);
    expect(phoneNationalDigits('')).toBe(0);
  });
});
