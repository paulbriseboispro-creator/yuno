import { describe, expect, it } from 'vitest';
import { autoMap, parseCsv, prepareLines, readAge, readCount, splitWithBase, toImportRow, SAMPLE_CSV } from '../fileImport';

describe('parseCsv', () => {
  it('devine le point-virgule, garde les guillemets et retire le BOM', () => {
    const r = parseCsv('\uFEFFPrénom;Email\n"Léa; la grande";lea@exemple.fr\n\n;\nTom;"tom@exemple.fr"');
    expect(r.head).toEqual(['Prénom', 'Email']);
    expect(r.rows).toEqual([['Léa; la grande', 'lea@exemple.fr'], ['Tom', 'tom@exemple.fr']]);
  });
  it('lit la virgule et les fins de ligne Windows', () => {
    const r = parseCsv('email,phone\r\na@b.fr,0612345678\r\n');
    expect(r.rows).toEqual([['a@b.fr', '0612345678']]);
  });
});

describe('autoMap', () => {
  it('reconnaît les en-têtes FR / EN / ES et ne sert un champ qu’une fois', () => {
    expect(autoMap(['Prénom', 'Nom', 'E-mail', 'Mobile', 'Ville', 'Courriel'])).toEqual(['prenom', 'nom', 'email', 'tel', 'ville', 'skip']);
    expect(autoMap(['First name', 'Last name', 'Phone'])).toEqual(['prenom', 'nom', 'tel']);
  });
  it('lit les colonnes de profil d’un export Shotgun ou Dice (catalogue de segments)', () => {
    expect(autoMap(['Prénom', 'Nom', 'Email', 'Téléphone', 'Pays', 'Département', 'Ville', 'Code postal', 'Âge', 'Genre']))
      .toEqual(['prenom', 'nom', 'email', 'tel', 'pays', 'skip', 'ville', 'cp', 'age', 'genre']);
    expect(autoMap(['Date de naissance', 'Sexe', 'Zip', 'Country'])).toEqual(['naissance', 'genre', 'cp', 'pays']);
  });
  it('prend « Nombre » pour un prénom (espagnol), pas pour un nom', () => {
    expect(autoMap(['Nombre', 'Apellidos', 'Correo', 'Edad'])).toEqual(['prenom', 'nom', 'email', 'age']);
  });
  it('repère une colonne d’adresses sans en-tête parlant', () => {
    expect(autoMap(['A', 'B'], [['x', 'a@b.fr'], ['y', 'c@d.fr'], ['z', 'e@f.fr']])).toEqual(['skip', 'email']);
  });
});

describe('prepareLines + splitWithBase', () => {
  const file = parseCsv(SAMPLE_CSV);
  const map = autoMap(file.head, file.rows);
  const prep = prepareLines(file, map);

  it('écarte les lignes sans identité et fusionne les doublons du fichier', () => {
    // « Inconnu » n'a ni e-mail ni téléphone, « sarah.k@exemple » est incomplet.
    expect(prep.bad.map((b) => b.line)).toEqual([7, 15]);
    expect(prep.bad[0].why).toBe('email');
    // Chloé (majuscules) et Yanis (même numéro écrit autrement) sont des doublons.
    expect(prep.dup.map((d) => [d.line, d.other, d.by])).toEqual([[6, 2, 'email'], [11, 10, 'tel']]);
  });

  it('normalise les numéros en E.164 et les e-mails en minuscules', () => {
    const tom = prep.lines.find((l) => l.email === 'tom.leroy@exemple.fr');
    expect(tom?.phone).toBe('+33639981004');
    expect(prep.lines.every((l) => !l.email || l.email === l.email.toLowerCase())).toBe(true);
  });

  it('sépare nouveaux et déjà présents, par e-mail puis par téléphone', () => {
    const byEmail = new Map([['noah.petit@exemple.fr', { first_name: 'Noah', last_name: 'Petit', nights: 2, since: null }]]);
    const byPhone = new Map([['+33777421009', { first_name: 'Yanis', last_name: null, nights: 0, since: null }]]);
    const an = splitWithBase(prep, byEmail, byPhone);
    expect(an.exist.map((e) => [e.email ?? e.phone, e.by, e.who])).toEqual([
      ['noah.petit@exemple.fr', 'email', 'Noah Petit'],
      ['+33777421009', 'tel', 'Yanis'],
    ]);
    expect(an.fresh.length + an.exist.length + an.dup.length + an.bad.length).toBe(file.rows.length);
  });

  it('rend des lignes prêtes pour import_contact_list', () => {
    expect(toImportRow({ line: 2, name: 'x', email: 'a@b.fr', phone: null, first_name: 'A', last_name: null, city: 'Paris' }))
      .toEqual({ email: 'a@b.fr', first_name: 'A', city: 'Paris' });
  });
});

describe('profil d’une ligne (âge, genre, pays, code postal)', () => {
  const file = parseCsv('Email;Pays;CP;Âge;Naissance;Genre\nlea@exemple.fr;France;75011;24;;Femme\ntom@exemple.fr;Atlantide;;;1990-05-12;M\nzoe@exemple.fr;ES;28004;9;;?');
  const prep = prepareLines(file, autoMap(file.head, file.rows));

  it('normalise le pays en ISO 2, garde le texte d’un pays inconnu', () => {
    expect(prep.lines.map((l) => [l.country_code ?? null, l.country ?? null])).toEqual([['FR', null], [null, 'Atlantide'], ['ES', null]]);
  });
  it('lit l’âge, sinon la date de naissance, et écarte un âge hors bornes', () => {
    expect(prep.lines[0].age).toBe(24);
    expect(prep.lines[1].age).toBeGreaterThanOrEqual(35);
    expect(prep.lines[2].age).toBeNull();
    expect(readAge('', '')).toBeNull();
    expect(readAge('140', '')).toBeNull();
  });
  it('rend femme / homme, rien pour une valeur illisible', () => {
    expect(prep.lines.map((l) => l.gender ?? null)).toEqual(['female', 'male', null]);
  });
  it('envoie ces champs à import_contact_list sous leurs noms serveur', () => {
    expect(toImportRow(prep.lines[0])).toEqual({ email: 'lea@exemple.fr', postal_code: '75011', country_code: 'FR', age: '24', gender: 'female' });
    expect(toImportRow(prep.lines[1])).toMatchObject({ email: 'tom@exemple.fr', country: 'Atlantide', gender: 'male' });
  });
});

describe('historique d’une ligne (dépense, soirées, dernier achat, première venue)', () => {
  it('reconnaît les colonnes d’historique d’un export Shotgun, Dice ou Weezevent', () => {
    expect(autoMap(['Prénom', 'Nom', 'Email', 'Ajouté', 'Dernier achat', 'Total dépensé', 'Total évènements']))
      .toEqual(['prenom', 'nom', 'email', 'premier', 'dernier', 'depense', 'soirees']);
    expect(autoMap(['first_name', 'last_name', 'email', 'last_purchase', 'first_order', 'total_spent', 'event_count']))
      .toEqual(['prenom', 'nom', 'email', 'dernier', 'premier', 'depense', 'soirees']);
    expect(autoMap(['Last name', 'First name'])).toEqual(['nom', 'prenom']);
  });
  it('lit montants, nombres et dates, et les envoie sous leurs noms serveur', () => {
    const f = parseCsv('Email;Total dépensé;Total évènements;Dernier achat;Ajouté\nlea@exemple.fr;"1 250,50 €";4;12/03/2025;2024-02-10\ntom@exemple.fr;;;;');
    const prep = prepareLines(f, autoMap(f.head, f.rows));
    expect(toImportRow(prep.lines[0])).toEqual({
      email: 'lea@exemple.fr', total_spent: '1250.5', event_count: '4',
      last_purchase_at: '2025-03-12T00:00:00.000Z', added_at: '2024-02-10T00:00:00.000Z',
    });
    expect(toImportRow(prep.lines[1])).toEqual({ email: 'tom@exemple.fr' });
  });
  it('compte un nombre écrit avec son unité, jamais un texte', () => {
    expect(readCount('12 soirées')).toBe(12);
    expect(readCount('1 204')).toBe(1204);
    expect(readCount('beaucoup')).toBeNull();
    expect(readCount('')).toBeNull();
  });
});
