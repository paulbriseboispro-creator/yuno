import { describe, expect, it } from 'vitest';
import { OPEN_CRM_PATH, openCrmOffer } from '../openCrmOffer';

describe('openCrmOffer', () => {
  it('ne propose rien sans compte possédé', () => {
    expect(openCrmOffer(null)).toBeNull();
    expect(openCrmOffer([])).toBeNull();
  });

  it('nomme le seul compte Billetterie sans CRM', () => {
    expect(openCrmOffer([{ kind: 'org', name: 'Amoris', products: ['suite'] }]))
      .toEqual({ name: 'Amoris', href: OPEN_CRM_PATH });
  });

  it('ignore les comptes qui ont déjà le CRM', () => {
    expect(openCrmOffer([{ kind: 'org', name: 'Amoris', products: ['suite', 'crm'] }])).toBeNull();
    expect(openCrmOffer([
      { kind: 'venue', name: 'Club', products: ['crm'] },
      { kind: 'org', name: 'Amoris', products: ['suite'] },
    ])).toEqual({ name: 'Amoris', href: OPEN_CRM_PATH });
  });

  it('laisse /open/crm faire choisir quand plusieurs comptes le peuvent', () => {
    expect(openCrmOffer([
      { kind: 'venue', name: 'Club', products: ['suite'] },
      { kind: 'org', name: 'Amoris', products: ['suite'] },
    ])).toEqual({ name: null, href: OPEN_CRM_PATH });
  });

  it('tolère un nom vide ou des produits absents', () => {
    expect(openCrmOffer([{ kind: 'org', name: '  ', products: null }])).toEqual({ name: null, href: OPEN_CRM_PATH });
  });
});
