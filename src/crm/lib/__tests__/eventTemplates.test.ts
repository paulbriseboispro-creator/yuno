import { describe, expect, it } from 'vitest';
import { eventTemplateStudioHref, safeCrmBack } from '@/crm/lib/eventTemplateHref';
import { eventTemplateNights, recipeEventTemplates, type EventTemplate } from '@/crm/data/eventTemplates';

const tpl = (p: Partial<EventTemplate>): EventTemplate => ({
  id: 't', name: 'n', subject: null, updated_at: '2026-11-01T00:00:00Z', event_id: 'e', event_title: null, event_start: null,
  expires_at: null, expired: false, automations: [], campaigns: [], sent: 0, ...p,
});

describe('modèles propres à une soirée', () => {
  it('le Studio revient sur la page d’envoi de la campagne', () => {
    expect(eventTemplateStudioHref('abc', 'click_no_buy', '/crm/emails/xyz/send?step=plan'))
      .toBe('/crm/emails/studio/abc?template=click_no_buy&back=%2Fcrm%2Femails%2Fxyz%2Fsend%3Fstep%3Dplan');
  });

  it('« back » n’accepte qu’une adresse de la Console', () => {
    expect(safeCrmBack('/crm/automations')).toBe('/crm/automations');
    expect(safeCrmBack('/crm')).toBe('/crm');
    expect(safeCrmBack('/crm/emails/x/send?step=plan')).toBe('/crm/emails/x/send?step=plan');
    expect(safeCrmBack('//evil.example/crm')).toBeNull();
    expect(safeCrmBack('https://evil.example/crm')).toBeNull();
    expect(safeCrmBack('/crmx')).toBeNull();
    expect(safeCrmBack('/crm/\\evil')).toBeNull();
    expect(safeCrmBack(null)).toBeNull();
  });

  it('une recette ne voit que ses modèles de soirée encore actifs', () => {
    const list = [
      tpl({ id: 'a', automations: [{ id: 'r1', kind: 'click_no_buy' }] }),
      tpl({ id: 'b', automations: [{ id: 'r2', kind: 'last_call' }] }),
      tpl({ id: 'c', automations: [{ id: 'r1', kind: 'click_no_buy' }], expired: true }),
      tpl({ id: 'd', campaigns: [{ id: 'c1', name: null, status: 'draft' }] }),
    ];
    expect(recipeEventTemplates(list, 'r1').map((x) => x.id)).toEqual(['a']);
    expect(recipeEventTemplates(list, null)).toEqual([]);
    expect(recipeEventTemplates(undefined, 'r1')).toEqual([]);
  });

  it('les soirées proposées : à venir, ou finies depuis moins de 3 jours', () => {
    const now = Date.parse('2026-11-10T12:00:00Z');
    const n = (id: string, start: string, end: string, upcoming: boolean) => ({ id, start_at: start, end_at: end, upcoming });
    const out = eventTemplateNights([
      n('far', '2026-10-01T22:00:00Z', '2026-10-02T05:00:00Z', false),
      n('next', '2026-11-14T22:00:00Z', '2026-11-15T05:00:00Z', true),
      n('recent', '2026-11-08T22:00:00Z', '2026-11-09T05:00:00Z', false),
    ], now);
    expect(out.map((x) => x.id)).toEqual(['recent', 'next']);
  });
});
