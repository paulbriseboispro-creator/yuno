import { describe, expect, it } from 'vitest';
import { computeShare, storedYunoFee } from '../coEventSplit';

// La comptabilité et les factures de soirée lisent les frais Yuno SUR la vente :
// un revenu affiché n'inclut jamais l'argent de Yuno, et les frais de gestion
// d'une table ne sortent de la part du club que s'il les absorbe.
describe('storedYunoFee', () => {
  it('billet : frais de service + assurance annulation', () => {
    expect(storedYunoFee('ticket', { service_fee: 0.99, insurance_fee: 1.5 })).toBe(2.49);
  });

  it('table non absorbée : les frais de gestion ne sont pas dans le montant', () => {
    expect(storedYunoFee('table', { service_fee: 0, management_fee: 20, fee_absorbed: false })).toBe(0);
  });

  it('table absorbée : les frais de gestion sortent de la part du club', () => {
    expect(storedYunoFee('table', { service_fee: 0, management_fee: 20, fee_absorbed: true })).toBe(20);
  });

  it('commande : frais de service', () => {
    expect(storedYunoFee('order', { service_fee: 1.7 })).toBe(1.7);
  });

  it('ligne sans frais enregistrés : null (repli sur l’estimation)', () => {
    expect(storedYunoFee('ticket', {})).toBeNull();
  });

  it('la part se calcule sur le montant moins les frais lus', () => {
    const fee = storedYunoFee('ticket', { service_fee: 0.99, insurance_fee: 1.5 });
    const r = computeShare(23.49, 'ticket', 'organizer', null, 'org_hosted', false, fee);
    expect(r.net).toBeCloseTo(21, 2);
    expect(r.share).toBe(21);
  });
});
