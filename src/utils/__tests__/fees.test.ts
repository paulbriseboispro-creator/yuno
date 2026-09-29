import { describe, expect, it } from 'vitest';
import { calcStripeFee, orderRevenue, tableRevenue, ticketRevenue } from '../fees';

// Le CA club de fees.ts est la référence de tous les revenus affichés aux pros :
// jamais les frais de service, l'assurance annulation ni les frais de gestion
// absorbés — c'est l'argent de Yuno. Les RPC d'analyse et les miroirs edge
// (clubRevenue, calc*Revenue) reproduisent ces cas au centime.
describe('CA club — frais Yuno exclus', () => {
  it('billet : prix payé − frais de service − assurance', () => {
    const r = ticketRevenue({ total_price: 23.49, service_fee: 0.99, insurance_fee: 1.5 });
    expect(r.gross).toBeCloseTo(21, 2);
    expect(r.charged).toBe(23.49);
    expect(r.stripe).toBe(calcStripeFee(23.49));
  });

  it('billet remboursé en partie : le remboursement sort du CA, plafonné à la part du club', () => {
    expect(ticketRevenue({ total_price: 20.99, service_fee: 0.99, refund_amount: 5 }).refunded).toBe(5);
    expect(ticketRevenue({ total_price: 20.99, service_fee: 0.99, refund_amount: 50 }).refunded).toBe(20);
  });

  it('table : frais de gestion payés en plus par le client, jamais retirés', () => {
    const r = tableRevenue({ total_price: 500, service_fee: 0, management_fee: 20, fee_absorbed: false });
    expect(r.gross).toBe(500);
  });

  it('table : frais de gestion absorbés par le club, retirés de sa part', () => {
    const r = tableRevenue({ total_price: 500, service_fee: 0, management_fee: 20, fee_absorbed: true });
    expect(r.gross).toBe(480);
  });

  it('boissons : total − frais de service', () => {
    const r = orderRevenue({ total: 34, service_fee: 1.7 });
    expect(r.gross).toBeCloseTo(32.3, 2);
  });

  it('frais Stripe : 1,5 % + 0,25 € sur le montant TOTAL payé, rien sur une vente à 0', () => {
    expect(calcStripeFee(20.99)).toBe(0.56);
    expect(calcStripeFee(0)).toBe(0);
  });
});
