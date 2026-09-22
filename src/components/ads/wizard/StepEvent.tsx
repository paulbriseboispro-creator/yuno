// Étape 1 — la soirée et ce qu'on attend de la pub.

import { Check, Ticket, MousePointerClick } from 'lucide-react';
import { format } from 'date-fns';
import type { Locale } from 'date-fns';
import type { AdsEvent, CampaignObjective } from '@/lib/metaAds';
import type { CampaignDraft } from './types';
import { StepHeader, Section, Field, ChoiceCards, Tip, inputStyle, focusRing, T1, T3, BORDER, INNER_BG, RED } from './ui';

export function StepEvent({ draft, events, onPickEvent, set, locale, t }: {
  draft: CampaignDraft;
  events: AdsEvent[];
  onPickEvent: (e: AdsEvent) => void;
  set: <K extends keyof CampaignDraft>(k: K, v: CampaignDraft[K]) => void;
  locale: Locale;
  t: (k: string) => string;
}) {
  return (
    <div className="space-y-5">
      <StepHeader title={t('ads.w.event.title')} intro={t('ads.w.event.intro')} />
      <Section title={t('ads.w.event.pick')} desc={t('ads.wizard.eventIntro')}>
        {events.length === 0 ? (
          <p style={{ color: T3, fontSize: 13.5 }}>{t('ads.wizard.noEvents')}</p>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {events.map((e) => {
              const active = e.id === draft.eventId;
              return (
                <button key={e.id} type="button" onClick={() => onPickEvent(e)}
                  className="flex items-center gap-3 rounded-2xl p-3 text-left cursor-pointer transition-colors duration-150"
                  style={{ background: active ? 'rgba(232,25,44,0.10)' : 'rgba(255,255,255,0.03)', border: `1px solid ${active ? 'rgba(232,25,44,0.5)' : BORDER}`, minHeight: 72 }}>
                  <div className="h-14 w-14 rounded-xl overflow-hidden flex-shrink-0" style={{ background: 'rgba(255,255,255,0.06)' }}>
                    {e.poster_url && <img src={e.poster_url} alt="" className="h-full w-full object-cover" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate" style={{ color: T1, fontSize: 14.5, fontWeight: 650 }}>{e.title}</p>
                    <p style={{ color: T3, fontSize: 12.5, marginTop: 2 }}>{format(new Date(e.start_at), 'EEE d MMM · HH:mm', { locale })}{e.city ? ` · ${e.city}` : ''}</p>
                  </div>
                  {active && <Check className="w-5 h-5 flex-shrink-0" style={{ color: RED }} />}
                </button>
              );
            })}
          </div>
        )}
      </Section>
      <Section title={t('ads.w.event.goal')} desc={t('ads.w.event.goalDesc')}>
        <ChoiceCards<CampaignObjective> value={draft.objective} onChange={(v) => set('objective', v)} options={[
          { value: 'OUTCOME_SALES', label: t('ads.wizard.objectiveSales'), desc: t('ads.w.event.salesDesc'), icon: <Ticket className="w-5 h-5" />, badge: t('ads.w.recommended') },
          { value: 'OUTCOME_TRAFFIC', label: t('ads.wizard.objectiveTraffic'), desc: t('ads.w.event.trafficDesc'), icon: <MousePointerClick className="w-5 h-5" /> },
        ]} />
        <Field label={t('ads.wizard.name')} hint={t('ads.wizard.nameHint')}>
          <input value={draft.name} onChange={(e) => set('name', e.target.value.slice(0, 100))} style={inputStyle} className={focusRing} />
        </Field>
      </Section>
      <Tip tone="tip">{t('ads.w.event.tip')}</Tip>
      <span className="hidden" style={{ background: INNER_BG }} />
    </div>
  );
}
