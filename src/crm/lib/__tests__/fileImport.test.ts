import { describe, expect, it } from 'vitest';
import { autoMap, parseCsv, prepareLines, splitWithBase, toImportRow, SAMPLE_CSV } from '../fileImport';

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
