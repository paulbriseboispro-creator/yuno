import { describe, expect, it } from 'vitest';
import { SIGNUP_KINDS } from '@/crm/signup/model';
import { checkWz, defaultEventFor, fillWz, newWz } from '../signupLogic';

const t = (key: string) => key;

describe('page d’inscription sans soirée connectée', () => {
  it('le type et la soirée ne bloquent jamais, quel que soit le type', () => {
    for (const kind of SIGNUP_KINDS) {
      const wz = newWz(kind, [], t, { eventId: 'none', title: 'Amoris', btn: 'Je m’inscris' });
      expect(checkWz(wz, t).oks[0]).toBe(true);
    }
  });

  it('sans soirée à venir, prévente et venue partent sur « aucune soirée »', () => {
    expect(defaultEventFor('prevente', [])).toBe('none');
    expect(defaultEventFor('venue', [])).toBe('none');
    expect(defaultEventFor('communaute', [])).toBeNull();
  });

  it('un type autre que la liste d’attente n’a pas de titre d’office sans soirée', () => {
    const wz = fillWz(newWz('prevente', [], t), [], 'Amoris', t, 'fr');
    expect(wz.title).toBe('');
    expect(checkWz(wz, t).oks[2]).toBe(false);
    const typed = fillWz({ ...wz, title: 'Amoris Opening', touched: { title: true } }, [], 'Amoris', t, 'fr');
    expect(checkWz(typed, t).oks[2]).toBe(true);
  });

  it('« la veille de la soirée » retombe sur une date choisie quand il n’y a pas de soirée', () => {
    const wz = newWz('venue', [], t);
    expect(wz.closes).toBe('date');
    const forced = fillWz({ ...wz, closes: 'eve' }, [], 'Amoris', t, 'fr');
    expect(forced.closes).toBe('date');
  });
});
