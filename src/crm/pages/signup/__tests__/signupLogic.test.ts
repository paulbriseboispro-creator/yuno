import { describe, expect, it } from 'vitest';
import { SIGNUP_KINDS, guestListTarget } from '@/crm/signup/model';
import { checkWz, defaultEventFor, fillWz, isAfterUrl, newWz } from '../signupLogic';

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

describe('page Guest list', () => {
  it('part sans question, ouverte jusqu’à ce que le pro la ferme', () => {
    const wz = newWz('guestlist', [], t);
    expect(wz.qs).toEqual([]);
    expect(wz.closes).toBe('never');
    expect(wz.afterUrl).toBe('');
  });

  it('ne se publie pas sans un lien https vers la guest list', () => {
    const base = newWz('guestlist', [], t, { title: '3AM Act III', btn: 'Je prends ma place' });
    const miss = checkWz(base, t);
    expect(miss.oks[3]).toBe(false);
    expect(miss.miss).toContain('yc.sp.w.m.afterUrl');
    expect(checkWz({ ...base, afterUrl: 'http://shotgun.live/x' }, t).oks[3]).toBe(false);
    expect(checkWz({ ...base, afterUrl: 'https://shotgun.live/fr/events/3am?ref=gl' }, t).oks[3]).toBe(true);
  });

  it('le lien n’est exigé que d’une page Guest list', () => {
    const wz = newWz('venue', [], t, { title: 'Soirée', btn: 'Je viens' });
    expect(checkWz(wz, t).miss).not.toContain('yc.sp.w.m.afterUrl');
  });

  it('isAfterUrl suit la règle de la base', () => {
    expect(isAfterUrl('https://shotgun.live/e/3am')).toBe(true);
    expect(isAfterUrl('  https://shotgun.live/e/3am  ')).toBe(true);
    expect(isAfterUrl('https://')).toBe(false);
    expect(isAfterUrl('javascript:alert(1)')).toBe(false);
    expect(isAfterUrl('https://shotgun.live/a b')).toBe(false);
    expect(isAfterUrl(`https://x.io/${'a'.repeat(600)}`)).toBe(false);
  });

  it('guestListTarget ne suit qu’un lien https rendu par la base', () => {
    expect(guestListTarget('go:https://shotgun.live/e/3am?ref=gl')).toBe('https://shotgun.live/e/3am?ref=gl');
    expect(guestListTarget('ok')).toBeNull();
    expect(guestListTarget('already')).toBeNull();
    expect(guestListTarget('go:javascript:alert(1)')).toBeNull();
    expect(guestListTarget('go:http://shotgun.live')).toBeNull();
  });
});
