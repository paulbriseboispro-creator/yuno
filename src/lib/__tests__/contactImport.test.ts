import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { countryFromPhone, countryToIso, parseContactFile, parseDate, parseMoney } from '@/lib/contactImport';
import { IMPORT_COUNTRIES } from '@/lib/smsImport';

const FR = IMPORT_COUNTRIES[0];

describe('parseContactFile — export riche (18 colonnes, style billetterie)', () => {
  const csv = [
    'Prénom,Nom,E-mail,Téléphone,Pays,Département,Ville,Code postal,Zone géographique,Âge,Genre,Abonné à la newsletter,Abonné aux notifications,Abonné,Ajouté,Dernier achat,Total dépensé,Total évènements',
    'Elise,Piani,elise@revolvr.fr,+33670213039,France,Yvelines,Chatou,78400,Paris,23,female,Non,Non,Non,2026-02-17T23:42:02.093Z,2026-02-17T23:42:02.093Z,0.00,1',
    'Victoria,Kuzma,tkuzma04@gmail.com,+12035058426,États-Unis,Kansas,Pretty Prairie,67570,,22,female,Oui,Non,Non,2026-02-18T00:47:17.013Z,2026-08-18T00:47:17.013Z,"18,35",3',
    'Sans,Mail,,0612345678,France,Paris,Paris,75004,Paris,,male,Non,Non,Non,,,205.5,6',
    'Sans,Rien,,,France,,,,,,,,,,,,,',
    'Doublon,Piani,ELISE@revolvr.fr,,France,,,,,,,,,,,,,',
  ].join('\n');
  const r = parseContactFile(csv, FR);

  it('lit une ligne par personne, email et/ou téléphone', () => {
    expect(r.rows).toHaveLength(3);
    expect(r.invalid).toHaveLength(1);
    expect(r.duplicates).toBe(1);
    expect(r.stats).toMatchObject({ emails: 2, phones: 3, both: 2 });
  });
  it('type les attributs', () => {
    const e = r.rows[0];
    expect(e).toMatchObject({ email: 'elise@revolvr.fr', phone: '+33670213039', first_name: 'Elise', last_name: 'Piani', country_code: 'FR', region: 'Yvelines', city: 'Chatou', postal_code: '78400', zone: 'Paris', age: 23, gender: 'female', newsletter_opt_in: false, total_spent: 0, event_count: 1 });
    expect(e.last_purchase_at).toBe('2026-02-17T23:42:02.093Z');
    const v = r.rows[1];
    expect(v).toMatchObject({ country_code: 'US', newsletter_opt_in: true, total_spent: 18.35, event_count: 3 });
    const s = r.rows[2];
    expect(s).toMatchObject({ phone: '+33612345678', country_code: 'FR', gender: 'male', total_spent: 205.5, event_count: 6 });
    expect(s.email).toBeUndefined();
    expect(s.age).toBeUndefined();
  });
  it('signale les colonnes reconnues', () => {
    expect(Object.keys(r.detected)).toEqual(expect.arrayContaining(['email', 'phone', 'firstName', 'lastName', 'country', 'region', 'city', 'postalCode', 'zone', 'age', 'gender', 'newsletter', 'addedAt', 'lastPurchaseAt', 'totalSpent', 'eventCount']));
  });
});

describe('parseContactFile — fichiers pauvres', () => {
  it('liste nue d’emails et de numéros mélangés', () => {
    const r = parseContactFile('a@b.fr\n06 12 34 56 78\nLéa Martin <lea@club.fr>\n', FR);
    expect(r.rows.map((x) => x.email || x.phone)).toEqual(['a@b.fr', '+33612345678', 'lea@club.fr']);
    expect(r.rows[2].first_name).toBe('Léa');
  });
  it('en-tête minimal Prénom,Nom,E-mail (fichiers WOH)', () => {
    const r = parseContactFile('Prénom,Nom,E-mail\nJeremy,Hayat,jrhindo@yahoo.fr\n', FR);
    expect(r.rows[0]).toEqual({ email: 'jrhindo@yahoo.fr', first_name: 'Jeremy', last_name: 'Hayat' });
    expect(r.stats.phones).toBe(0);
  });
  it('téléphone seul avec pays ES', () => {
    const r = parseContactFile('telefono;nombre\n612 345 678;Ana', IMPORT_COUNTRIES.find((c) => c.code === 'ES')!);
    expect(r.rows[0]).toMatchObject({ phone: '+34612345678', first_name: 'Ana', country_code: 'ES' });
  });
});

describe('helpers', () => {
  it('parseMoney', () => {
    expect(parseMoney('18,35 €')).toBe(18.35);
    expect(parseMoney('€18.35')).toBe(18.35);
    expect(parseMoney('1 250,00')).toBe(1250);
    expect(parseMoney('1,250.50')).toBe(1250.5);
    expect(parseMoney('')).toBeUndefined();
  });
  it('parseDate', () => {
    expect(parseDate('17/02/2026')).toBe('2026-02-17T00:00:00.000Z');
    expect(parseDate('2026-02-17')).toBe('2026-02-17T00:00:00.000Z');
    expect(parseDate('02/17/2026')).toBe('2026-02-17T00:00:00.000Z');
    expect(parseDate('n/a')).toBeUndefined();
  });
  it('pays', () => {
    expect(countryToIso('États-Unis')).toBe('US');
    expect(countryToIso('Royaume-Uni')).toBe('GB');
    expect(countryToIso('es')).toBe('ES');
    expect(countryFromPhone('+34612345678')).toBe('ES');
    expect(countryFromPhone('+12035058426')).toBe('US');
    expect(countryFromPhone('+212612345678')).toBe('MA');
  });
});

const KEVIN = '/Users/paul/Downloads/audience(1).csv';
describe.skipIf(!existsSync(KEVIN))('fichier réel de Kevin (local uniquement)', () => {
  it('lit les 12 399 lignes avec leurs attributs', () => {
    const r = parseContactFile(readFileSync(KEVIN, 'utf8'), FR);
    expect(r.rows.length).toBeGreaterThan(12000);
    expect(r.stats.phones).toBeGreaterThan(10000);
    expect(r.stats.withSpend).toBe(r.rows.length);
    expect(r.rows.filter((x) => x.zone === 'Paris').length).toBeGreaterThan(9000);
    expect(r.rows.filter((x) => x.country_code === 'FR').length).toBeGreaterThan(11000);
  });
});
