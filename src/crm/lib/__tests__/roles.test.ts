import { describe, expect, it } from 'vitest';
import { crmCaps } from '../roles';

describe('crmCaps', () => {
  it('la matrice du design : propriétaire, admin, éditeur, lecteur', () => {
    expect(crmCaps('owner')).toEqual({ read: true, write: true, money: true, team: true, billing: true });
    expect(crmCaps('admin')).toEqual({ read: true, write: true, money: true, team: true, billing: false });
    expect(crmCaps('editor')).toEqual({ read: true, write: true, money: false, team: false, billing: false });
    expect(crmCaps('viewer')).toEqual({ read: true, write: false, money: false, team: false, billing: false });
  });
  it('le gérant d’un club écrit, sans gérer l’équipe ni l’abonnement', () => {
    expect(crmCaps('manager')).toMatchObject({ write: true, team: false, billing: false });
  });
});
