import { describe, it, expect } from 'vitest';
import {
  saveReceiptToken, readReceiptToken, saveReceiptQr, readReceiptQr, fetchTableReceipt, fetchTableGuestPass,
  placementView, placementAdjustmentView, paidOnline, remainingOnSite, guestPassPath, guestPassUrl,
  whatsappShareHref, fillTemplate, checkoutErrorKey, isAvailabilityRefusal,
} from '../tableReceipt';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe('stockage du reçu', () => {
  it('range et relit le jeton et le QR par réservation', () => {
    const s = memory();
    saveReceiptToken(s, 'r1', 'tok');
    saveReceiptQr(s, 'r1', 'QR-1');
    expect(readReceiptToken(s, 'r1')).toBe('tok');
    expect(readReceiptToken(s, 'r2')).toBeNull();
    expect(readReceiptQr(s, 'r1')).toBe('QR-1');
    expect(s.m.has('yuno:table-receipt:r1')).toBe(true);
  });
  it('ignore un jeton vide et survit à un stockage qui lève', () => {
    const s = memory();
    saveReceiptToken(s, 'r1', undefined);
    expect(s.m.size).toBe(0);
    const broken = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect(() => saveReceiptToken(broken, 'r1', 't')).not.toThrow();
    expect(readReceiptToken(broken, 'r1')).toBeNull();
  });
});

describe('lecture par preuve', () => {
  it('rend le reçu, null sur erreur ou sans preuve', async () => {
    const ok = { rpc: async () => ({ data: { id: 'r1' }, error: null }) };
    expect((await fetchTableReceipt(ok, 'r1', 'q'))?.id).toBe('r1');
    expect(await fetchTableReceipt(ok, 'r1', '')).toBeNull();
    expect(await fetchTableReceipt({ rpc: async () => ({ data: null, error: null }) }, 'r1', 'q')).toBeNull();
    expect(await fetchTableReceipt({ rpc: async () => { throw new Error('net'); } }, 'r1', 'q')).toBeNull();
    expect(await fetchTableGuestPass({ rpc: async () => ({ data: null, error: { message: 'x' } }) }, 'q')).toBeNull();
  });
});

describe('placement et montants', () => {
  const base = { assigned_table_id: null, assigned_table_name: null, requested_table_id: null, requested_table_name: null, placement_status: null };
  it('attribuée > à l\'arrivée > demandée', () => {
    expect(placementView({ ...base, assigned_table_id: 't', assigned_table_name: 'A1', requested_table_id: 'x' })).toEqual({ kind: 'assigned', name: 'A1' });
    expect(placementView({ ...base, requested_table_id: 'x', requested_table_name: 'B2', placement_status: 'requested' })).toEqual({ kind: 'requested', name: 'B2' });
    expect(placementView({ ...base, placement_status: 'on_arrival' })).toEqual({ kind: 'on_arrival' });
    // Valeur réellement écrite par le serveur, avec une table demandée : « à l'arrivée » l'emporte sur « demandée ».
    expect(placementView({ ...base, requested_table_id: 'x', requested_table_name: 'T4', placement_status: 'assign_on_arrival' })).toEqual({ kind: 'on_arrival' });
    expect(placementView({ ...base, placement_status: 'assign_on_arrival' })).toEqual({ kind: 'on_arrival' });
    expect(placementView({ ...base, requested_table_id: 'x', placement_status: 'rejected' })).toEqual({ kind: 'on_arrival' });
    expect(placementView(base)).toEqual({ kind: 'none' });
  });
  it('surclassement et différence', () => {
    expect(placementAdjustmentView({ placement_adjustment: 'upgrade_free', placement_adjustment_amount: null })).toEqual({ kind: 'upgrade_free' });
    expect(placementAdjustmentView({ placement_adjustment: 'pay_on_site', placement_adjustment_amount: 40 })).toEqual({ kind: 'pay_on_site', amount: 40 });
    expect(placementAdjustmentView({ placement_adjustment: null, placement_adjustment_amount: null })).toBeNull();
  });
  it('payé en ligne et reste sur place', () => {
    expect(paidOnline({ charged_total: 82.5, deposit: 80, management_fee: 2, fee_absorbed: false, payment_mode: 'online' })).toBe(82.5);
    expect(paidOnline({ charged_total: null, deposit: 80, management_fee: 2, fee_absorbed: false, payment_mode: 'online' })).toBe(82);
    expect(paidOnline({ charged_total: null, deposit: 80, management_fee: 2, fee_absorbed: true, payment_mode: 'online' })).toBe(80);
    expect(paidOnline({ charged_total: 10, deposit: 0, management_fee: 0, fee_absorbed: false, payment_mode: 'on_site' })).toBe(0);
    expect(remainingOnSite({ remaining_on_site: 220, total_price: 300, deposit: 80 })).toBe(220);
    expect(remainingOnSite({ remaining_on_site: null, total_price: 50, deposit: 80 })).toBe(0);
  });
});

describe('partage d\'un QR', () => {
  it('lien /t/<qr> et repli WhatsApp', () => {
    expect(guestPassPath('AB-1')).toBe('/t/AB-1');
    expect(guestPassUrl('https://yunoapp.eu/', 'AB-1')).toBe('https://yunoapp.eu/t/AB-1');
    const href = whatsappShareHref('Ton entrée', 'https://yunoapp.eu/t/AB-1');
    expect(href.startsWith('https://wa.me/?text=')).toBe(true);
    expect(decodeURIComponent(href)).toContain('https://yunoapp.eu/t/AB-1');
    expect(fillTemplate('Table de {holder} pour {event}', { holder: 'Léa', event: 'Nuit' })).toBe('Table de Léa pour Nuit');
  });
});

describe('erreurs du checkout', () => {
  it('traduit les codes connus', () => {
    expect(checkoutErrorKey('invalid_pack')).toBe('tblc.err.invalidPack');
    expect(checkoutErrorKey('invalid_guest_count')).toBe('tblc.err.invalidGuestCount');
    expect(checkoutErrorKey('promo_not_applicable_to_deposit')).toBe('tblc.err.promoNotApplicable');
    expect(checkoutErrorKey('autre')).toBeNull();
  });
  it('la liste d\'attente seulement pour une indisponibilité', () => {
    expect(isAvailabilityRefusal('invalid_pack', 'x')).toBe(false);
    expect(isAvailabilityRefusal(undefined, 'Zone complète')).toBe(true);
    expect(isAvailabilityRefusal(undefined, 'Something broke')).toBe(false);
  });
});
