import { describe, it, expect } from 'vitest';
import {
  parseTableMenu, clampBottleQty, bumpBottleQty, preorderIndicativeTotal, toPreorderPayload, parseReceiptPreorder,
  BOTTLE_MAX_PER_LINE, BOTTLE_MAX_LINES,
} from '../tableBottles';
import { checkoutErrorKey } from '../tableReceipt';
import { parseTablesCollector, collectorBannerView, collectorPartyName } from '../tablesCollector';

const menu = parseTableMenu([
  { id: 'a', name: 'Moët', price: 120, category: 'champagne', brand: null, description: null, image_url: null, volume_cl: 75, needs_mixer: false, max_mixers: null, position: 1 },
  { id: 'b', name: 'Grey Goose', price: '95.5', category: 'vodka' },
  { id: 'x', name: 'Cassée', price: 'abc' },
  null,
]);

describe('carte bouteilles', () => {
  it('lit la carte avec tolérance', () => {
    expect(menu.map(m => m.id)).toEqual(['a', 'b']);
    expect(menu[1].price).toBe(95.5);
    expect(parseTableMenu('nope')).toEqual([]);
  });
  it('borne les quantités', () => {
    expect(clampBottleQty(-3)).toBe(0);
    expect(clampBottleQty(99)).toBe(BOTTLE_MAX_PER_LINE);
    expect(clampBottleQty(2.9)).toBe(2);
    expect(clampBottleQty(NaN)).toBe(0);
    let q: Record<string, number> = {};
    q = bumpBottleQty(q, 'a', 1); q = bumpBottleQty(q, 'a', 1);
    expect(q).toEqual({ a: 2 });
    q = bumpBottleQty(q, 'a', -5);
    expect(q).toEqual({});
  });
  it('refuse une 21e ligne distincte', () => {
    let q: Record<string, number> = {};
    for (let i = 0; i < BOTTLE_MAX_LINES; i++) q = bumpBottleQty(q, `id${i}`, 1);
    expect(bumpBottleQty(q, 'extra', 1)).toBe(q);
    expect(bumpBottleQty(q, 'id0', 1).id0).toBe(2);
  });
  it('total indicatif au centime, articles inconnus à zéro', () => {
    expect(preorderIndicativeTotal(menu, { a: 2, b: 1, zzz: 4 })).toBe(335.5);
  });
  it("n'envoie que l'article et la quantité", () => {
    const p = toPreorderPayload({ a: 2, b: 0, zzz: 1 }, menu);
    expect(p).toEqual([{ menuItemId: 'a', quantity: 2 }]);
    expect(Object.keys(p[0]).sort()).toEqual(['menuItemId', 'quantity']);
  });
  it('lit le récap de reçu et ignore une précommande vide', () => {
    expect(parseReceiptPreorder(null)).toBeNull();
    expect(parseReceiptPreorder({ items: [] })).toBeNull();
    const r = parseReceiptPreorder({ order_id: 'o', status: 'preorder', total: 240, payment: 'on_site', items: [{ name: 'Moët', quantity: 2, unit_price: 120 }] });
    expect(r?.total).toBe(240);
    expect(r?.items[0]).toEqual({ name: 'Moët', quantity: 2, unitPrice: 120 });
  });
  it('traduit invalid_preorder', () => {
    expect(checkoutErrorKey('invalid_preorder')).toBe('tblb.err.invalidPreorder');
  });
});

describe('qui encaisse les tables', () => {
  const raw = (o: Record<string, unknown>) => parseTablesCollector({ collector: 'venue', ready: true, ready_party: null, blocked: null, venue_name: 'Casanova', organizer_name: 'Amoris', ...o })!;
  it('parse le contrat serveur', () => {
    expect(parseTablesCollector(null)).toBeNull();
    const i = raw({});
    expect(i.collector).toBe('venue');
    expect(collectorPartyName(i, 'venue')).toBe('Casanova');
    expect(collectorPartyName(i, 'both')).toBe('Casanova + Amoris');
  });
  it("club partenaire qui encaisse : l'organisateur n'est jamais invité à relier Stripe", () => {
    const v = collectorBannerView({ info: raw({ ready: false, ready_party: 'venue' }), viewer: 'organizer', hasOnlinePacks: true, canManageStripe: true });
    expect(v.kind).toBe('other_connect');
    expect(v.party).toBe('venue');
  });
  it('encaisseur prêt, formules sur place, blocage', () => {
    expect(collectorBannerView({ info: raw({}), viewer: 'organizer', hasOnlinePacks: true, canManageStripe: true }).kind).toBe('ready');
    expect(collectorBannerView({ info: raw({ ready: false, ready_party: 'venue' }), viewer: 'organizer', hasOnlinePacks: false, canManageStripe: true }).kind).toBe('on_site_only');
    const b = collectorBannerView({ info: raw({ blocked: 'no_contract', ready: false }), viewer: 'organizer', hasOnlinePacks: false, canManageStripe: true });
    expect(b).toMatchObject({ kind: 'blocked', block: 'no_contract' });
  });
  it("je suis l'encaisseur : relier Stripe, ou demander au fondateur", () => {
    const info = raw({ collector: 'organizer', ready: false, ready_party: 'organizer' });
    expect(collectorBannerView({ info, viewer: 'organizer', hasOnlinePacks: true, canManageStripe: true }).kind).toBe('viewer_connect');
    expect(collectorBannerView({ info, viewer: 'organizer', hasOnlinePacks: true, canManageStripe: false }).kind).toBe('viewer_ask_owner');
  });
});
