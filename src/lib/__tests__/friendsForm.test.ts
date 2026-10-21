import { describe, expect, it } from 'vitest';
import { friendErrors, friendsProblems, type AttendeeInfo } from '@/lib/buyerForm';
import { composeFullName, splitFullName } from '@/lib/guestName';

const person = (fullName: string, email: string): AttendeeInfo => ({ fullName, email, phone: '' });

describe('friendErrors — chaque personne d\'un billet est obligatoire', () => {
  it('accepte un nom complet et un e-mail plausible', () => {
    expect(friendErrors(person('Raphael Guidotti', 'raph.guidotti@gmail.com'))).toEqual({});
  });
  it('refuse un nom vide, un seul mot ou un e-mail absent', () => {
    expect(friendErrors(person('', 'a@b.fr')).name).toBe('friend_name');
    expect(friendErrors(person('Raphael', 'a@b.fr')).name).toBe('friend_name');
    expect(friendErrors(person('Raphael Guidotti', '')).email).toBe('friend_email_required');
    expect(friendErrors(person('Raphael Guidotti', '   ')).email).toBe('friend_email_required');
  });
  it('refuse un e-mail illisible', () => {
    expect(friendErrors(person('Raphael Guidotti', 'raphael@gmial')).email).toBe('friend_email_invalid');
    expect(friendErrors(person('Raphael Guidotti', 'raphael gmail.com')).email).toBe('friend_email_invalid');
  });
});

describe('friendsProblems — l\'acheteur (position 0) n\'en fait pas partie', () => {
  it('ne regarde que les personnes 2 à N, par leur position', () => {
    const list = [person('', ''), person('Raphael Guidotti', 'r@g.fr'), person('Léa', ''), person('Tom Martin', 'tom')];
    expect(Object.keys(friendsProblems(list))).toEqual(['2', '3']);
    expect(friendsProblems(list)[2]).toEqual({ name: 'friend_name', email: 'friend_email_required' });
    expect(friendsProblems(list)[3]).toEqual({ email: 'friend_email_invalid' });
  });
  it('un billet d\'une seule personne n\'a rien à signaler', () => {
    expect(friendsProblems([person('', '')])).toEqual({});
  });
});

describe('prénom / nom sur la même ligne ⇄ nom complet', () => {
  it('range un nom complet dans les deux cases', () => {
    expect(splitFullName('Josephine Haas')).toEqual({ first: 'Josephine', last: 'Haas' });
    expect(splitFullName('Jean Pierre Dupont')).toEqual({ first: 'Jean', last: 'Pierre Dupont' });
    expect(splitFullName('  Margot ')).toEqual({ first: 'Margot', last: '' });
    expect(splitFullName('')).toEqual({ first: '', last: '' });
  });
  it('recompose exactement ce que le serveur stocke', () => {
    expect(composeFullName('Josephine', 'Haas')).toBe('Josephine Haas');
    expect(composeFullName(' Jean-Pierre ', "  O'Hara")).toBe("Jean-Pierre O'Hara");
    expect(composeFullName('', 'Haas')).toBe('Haas');
  });
  it('aller-retour sans perte', () => {
    for (const n of ['Josephine Haas', 'Jean Pierre Dupont', 'Kevin LS']) {
      const { first, last } = splitFullName(n);
      expect(composeFullName(first, last)).toBe(n);
    }
  });
});
