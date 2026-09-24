// Étape 1 — la soirée et ce qu'on attend de la pub.

import { Check, Ticket, MousePointerClick, Megaphone, Lock } from 'lucide-react';
import { format } from 'date-fns';
import type { Locale } from 'date-fns';
import type { AdsEvent, CampaignObjective, ConversionEvent } from '@/lib/metaAds';
import type { CampaignDraft } from './types';
import { StepHeader, Section, Field, ChoiceCards, Chip, Tip, inputStyle, focusRing, T1, T3, BORDER, INNER_BG, RED } from './ui';

export function StepEvent({ draft, events, onPickEvent, set, locale, expert, locked, t }: {
  draft: CampaignDraft;
  events: AdsEvent[];
  onPickEvent: (e: AdsEvent) => void;
  set: <K extends keyof CampaignDraft>(k: K, v: CampaignDraft[K]) => void;
  locale: Locale;
  expert: boolean;
  /** Modification d'une campagne vivante : la soirée et l'objectif ne changent plus (règle Meta). */
  locked: boolean;
  t: (k: string) => string;
}) {
  const shownEvents = locked ? events.filter((e) => e.id === draft.eventId) : events;
  const objectiveOptions = [
    { value: 'OUTCOME_SALES' as CampaignObjective, label: t('ads.wizard.objectiveSales'), desc: t('ads.w.event.salesDesc'), icon: <Ticket className="w-5 h-5" />, badge: t('ads.w.recommended') },
    { value: 'OUTCOME_TRAFFIC' as CampaignObjective, label: t('ads.wizard.objectiveTraffic'), desc: t('ads.w.event.trafficDesc'), icon: <MousePointerClick className="w-5 h-5" /> },
    ...(expert || draft.objective === 'OUTCOME_AWARENESS' ? [{ value: 'OUTCOME_AWARENESS' as CampaignObjective, label: t('ads.x.obj.awareness'), desc: t('ads.x.obj.awarenessDesc'), icon: <Megaphone className="w-5 h-5" /> }] : []),
  ];
  return (
    <div className="space-y-5">
      <StepHeader title={locked ? t('ads.x.edit.title') : t('ads.w.event.title')} intro={locked ? t('ads.x.edit.intro') : t('ads.w.event.intro')} />
      {locked && <Tip><Lock className="w-4 h-4 inline mr-1.5 -mt-0.5" />{t('ads.x.edit.locked')}</Tip>}
      <Section title={t('ads.w.event.pick')} desc={locked ? undefined : t('ads.wizard.eventIntro')}>
        {shownEvents.length === 0 ? (
          <p style={{ color: T3, fontSize: 13.5 }}>{t('ads.wizard.noEvents')}</p>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {shownEvents.map((e) => {
              const active = e.id === draft.eventId;
              return (
                <button key={e.id} type="button" disabled={locked} onClick={() => onPickEvent(e)}
                  className="flex items-center gap-3 rounded-2xl p-3 text-left cursor-pointer transition-colors duration-150"
                  style={{ background: active ? 'rgba(232,25,44,0.10)' : 'rgb(var(--ink)/0.03)', border: `1px solid ${active ? 'rgba(232,25,44,0.5)' : BORDER}`, minHeight: 72 }}>
                  <div className="h-14 w-14 rounded-xl overflow-hidden flex-shrink-0" style={{ background: 'rgb(var(--ink)/0.06)' }}>
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
        <div style={locked ? { opacity: 0.55, pointerEvents: 'none' } : undefined}>
          <ChoiceCards<CampaignObjective> value={draft.objective} onChange={(v) => set('objective', v)} columns={objectiveOptions.length === 3 ? 3 : 2} options={objectiveOptions} />
        </div>
        {expert && draft.objective === 'OUTCOME_SALES' && (
          <Field label={t('ads.x.conv.title')} hint={t('ads.x.conv.hint')}>
            <div className="flex gap-2 flex-wrap" style={locked ? { opacity: 0.55, pointerEvents: 'none' } : undefined}>
              {(['PURCHASE', 'INITIATED_CHECKOUT', 'CONTENT_VIEW'] as ConversionEvent[]).map((ev) => <Chip key={ev} active={draft.conversionEvent === ev} onClick={() => set('conversionEvent', ev)}>{t(`ads.x.conv.${ev}`)}</Chip>)}
            </div>
          </Field>
        )}
        {expert && draft.objective === 'OUTCOME_TRAFFIC' && (
          <Field label={t('ads.x.opt.title')} hint={t('ads.x.opt.trafficHint')}>
            <div className="flex gap-2 flex-wrap">
              {['LINK_CLICKS', 'LANDING_PAGE_VIEWS'].map((g) => <Chip key={g} active={(draft.optimizationGoal || 'LINK_CLICKS') === g} onClick={() => set('optimizationGoal', g)}>{t(`ads.x.opt.${g}`)}</Chip>)}
            </div>
          </Field>
        )}
        {draft.objective === 'OUTCOME_AWARENESS' && (
          <Field label={t('ads.x.opt.title')} hint={t('ads.x.opt.awarenessHint')}>
            <div className="flex gap-2 flex-wrap">
              {['REACH', 'IMPRESSIONS'].map((g) => <Chip key={g} active={(draft.optimizationGoal === 'IMPRESSIONS' ? 'IMPRESSIONS' : 'REACH') === g} onClick={() => set('optimizationGoal', g)}>{t(`ads.x.opt.${g}`)}</Chip>)}
            </div>
          </Field>
        )}
        <Field label={t('ads.wizard.name')} hint={t('ads.wizard.nameHint')}>
          <input value={draft.name} onChange={(e) => set('name', e.target.value.slice(0, 100))} style={inputStyle} className={focusRing} />
        </Field>
      </Section>
      {!locked && <Tip tone="tip">{t('ads.w.event.tip')}</Tip>}
      <span className="hidden" style={{ background: INNER_BG }} />
    </div>
  );
}
