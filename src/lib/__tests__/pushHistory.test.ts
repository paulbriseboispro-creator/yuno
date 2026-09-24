import { describe, expect, it } from 'vitest';
import { campaignLabel, hasDeliveryReceipts, openRate, reachableShare, type PushCampaignRow } from '../pushHistory';

const row: PushCampaignRow = {
  id: 'c', title: '📅 Nouveau chez Womber', body: null, templateKey: 'new_event', source: 'auto',
  status: 'sent', createdAt: '2026-09-20T10:00:00Z', scheduledAt: null, eventId: 'e', eventTitle: 'Osmoz at Le Flow',
  targeted: 1800, sent: 1740, failed: 60, taps: 778, buyers: 12, orders: 14, entries: 3, revenue: 420,
};
const t = (k: string) => ({ 'ph.publication': 'Publication – {title}', 'ph.untitled': 'Sans titre' }[k] ?? k);

describe('campaignLabel', () => {
  it('nomme l’annonce automatique « Publication – soirée »', () => {
    expect(campaignLabel(row, t)).toBe('Publication – Osmoz at Le Flow');
  });
  it('garde le titre d’un push manuel', () => {
    expect(campaignLabel({ ...row, source: 'manual', templateKey: 'custom', title: 'Dernières places' }, t)).toBe('Dernières places');
  });
  it('ne laisse jamais une ligne sans nom', () => {
    expect(campaignLabel({ ...row, source: 'manual', title: '  ' }, t)).toBe('Sans titre');
  });
});

describe('openRate / reachableShare', () => {
  it('arrondit et se tait sans base', () => {
    expect(openRate(778, 1740)).toBe(45);
    expect(openRate(3, 0)).toBeNull();
    expect(reachableShare({ total: 752, reachable: 301, new30d: 12 })).toBe(40);
    expect(reachableShare({ total: 0, reachable: 0, new30d: 0 })).toBeNull();
  });
});

describe('hasDeliveryReceipts', () => {
  it('stays off until a first receipt arrives', () => {
    expect(hasDeliveryReceipts([])).toBe(false);
    expect(hasDeliveryReceipts([{ delivered: null }, { delivered: 0 }, {}])).toBe(false);
    expect(hasDeliveryReceipts([{ delivered: null }, { delivered: 3 }])).toBe(true);
  });
});
