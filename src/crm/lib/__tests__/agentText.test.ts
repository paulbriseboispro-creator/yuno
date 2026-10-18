import { describe, expect, it } from 'vitest';
import { forbiddenWording, inventedNumbers, numbersIn, scenarioTexts } from '../agentText';

describe('textes déposés par une IA', () => {
  it('relève les tournures qui prêtent un motif ou un goût à une personne, dans les trois langues', () => {
    expect(forbiddenWording('Toi qui aimes la house, Velvet #3 arrive')).toEqual(['aimes']);
    expect(forbiddenWording('Les fans de DJ Léa sont prévenus')).toEqual(['fans de']);
    expect(forbiddenWording('Elle vient pour l’artiste, avec son ami')).toEqual(['vient pour', 'son ami']);
    expect(forbiddenWording('Il préfère le samedi')).toEqual(['préfère']);
    expect(forbiddenWording('Since you love house: our pick')).toEqual(['love']);
    expect(forbiddenWording('Since she loves house')).toEqual(['loves']);
    expect(forbiddenWording('A ti te gusta el techno')).toEqual(['te gusta']);
    expect(forbiddenWording('{{prénom}}, Velvet #3 revient samedi : billets {{lien}}')).toEqual([]);
  });

  it('lit les nombres d’un texte, variables exclues', () => {
    expect(numbersIn('1 200 personnes, 4,5 % de plus, 20 h · {{lien}} 33')).toEqual(['1200', '4.5', '20', '33']);
    expect(numbersIn('{{soirée}} : 2 jours')).toEqual(['2']);
  });

  it('signale un nombre absent des résultats d’outils', () => {
    const results = JSON.stringify({ steps: [{ people: 612, cost_email: 540 }], pace: { sold: 321 } });
    expect(inventedNumbers('612 personnes, 321 billets vendus', results)).toEqual([]);
    expect(inventedNumbers('-20 % ce soir seulement, 612 personnes', results)).toEqual(['20']);
  });

  it('rassemble nom, objets, SMS et étiquettes d’un scénario', () => {
    const g = { nodes: { e1: { type: 'email', subject: 'Velvet revient' }, s1: { type: 'sms', body: 'Demain : {{lien}}' }, t1: { type: 'tag', tag: 'VIP' }, x: { type: 'end' } } };
    expect(scenarioTexts('Fidèles', g).map((x) => x.where)).toEqual(['name', 'e1.subject', 's1.body', 't1.tag']);
  });
});
