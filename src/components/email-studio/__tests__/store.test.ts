import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_STUDIO_THEME, makeBlock, type StudioCampaign } from '@/lib/email';
import { createStudioStore } from '../store';

function campaign(): StudioCampaign {
  const text = makeBlock('text', { venueName: 'Le Silo' });
  if (text.type === 'text') text.body = '';
  return {
    id: 'c1', name: 'Test', type: 'promotional', status: 'draft',
    subject: '', subjectB: '', abOn: false, preheader: '',
    blocks: [text], theme: DEFAULT_STUDIO_THEME, socialLinks: {}, logoUrl: null,
    eventId: null, audiences: [], exclusions: {}, scheduledAt: null,
    throttlePerHour: null, throttleWindowMinutes: 60, throttlePlan: null, quietHours: true,
    followupEnabled: false, followupDelayHours: 24, followupTemplateId: null,
    parentCampaignId: null, resendEnabled: false, resendDelayHours: 24, resendSubject: '',
  };
}

const body = (s: { getState: () => { campaign: StudioCampaign } }) => {
  const b = s.getState().campaign.blocks[0];
  return b.type === 'text' ? b.body : '';
};

describe('historique du Studio — ⌘Z rend une rafale, pas une lettre', () => {
  it('une frappe continue ne remplit pas 40 états', () => {
    vi.useFakeTimers();
    try {
      const store = createStudioStore(campaign(), {});
      const id = store.getState().campaign.blocks[0].id;
      for (const v of ['S', 'Sa', 'Sal', 'Salut']) store.getState().updateBlock(id, { body: v });
      expect(body(store)).toBe('Salut');
      expect(store.getState().past).toHaveLength(1);

      store.getState().undo();
      expect(body(store)).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('une pause ferme la rafale : chaque phrase s\'annule séparément', () => {
    vi.useFakeTimers();
    try {
      const store = createStudioStore(campaign(), {});
      const id = store.getState().campaign.blocks[0].id;
      store.getState().updateBlock(id, { body: 'Salut' });
      vi.advanceTimersByTime(1500);
      store.getState().updateBlock(id, { body: 'Salut Camille' });
      expect(store.getState().past).toHaveLength(2);

      store.getState().undo();
      expect(body(store)).toBe('Salut');
      store.getState().undo();
      expect(body(store)).toBe('');
      store.getState().redo();
      expect(body(store)).toBe('Salut');
    } finally {
      vi.useRealTimers();
    }
  });

  it('changer de champ ferme la rafale', () => {
    vi.useFakeTimers();
    try {
      const store = createStudioStore(campaign(), {});
      const id = store.getState().campaign.blocks[0].id;
      store.getState().updateBlock(id, { body: 'Salut' });
      store.getState().updateBlock(id, { color: '#ffffff' });
      store.getState().updateBlock(id, { body: 'Salut Camille' });
      expect(store.getState().past).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('une action structurelle n\'est jamais fusionnée', () => {
    vi.useFakeTimers();
    try {
      const store = createStudioStore(campaign(), {});
      store.getState().addBlock('divider');
      store.getState().addBlock('spacer');
      expect(store.getState().past).toHaveLength(2);
      store.getState().undo();
      expect(store.getState().campaign.blocks).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
