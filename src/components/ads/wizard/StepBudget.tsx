// Étape 2 — combien, et quand.

import { CalendarRange, CalendarClock, Gavel, Clock, Repeat, Link2, Plus, X } from 'lucide-react';
import { MIN_BUDGET_CENTS, type BidStrategy } from '@/lib/metaAds';
import type { CampaignDraft } from './types';
import { StepHeader, Section, Field, ChoiceCards, Chip, Tip, GhostButton, inputStyle, focusRing, T1, T2, T3, BORDER } from './ui';

export function StepBudget({ draft, set, currency, days, totalEstimate, fmtMoney, expert, locked, t }: {
  draft: CampaignDraft;
  set: <K extends keyof CampaignDraft>(k: K, v: CampaignDraft[K]) => void;
  currency: string;
  days: number;
  totalEstimate: number;
  fmtMoney: (eur: number) => string;
  expert: boolean;
  /** Modification : le type de budget ne change plus chez Meta. */
  locked: boolean;
  t: (k: string) => string;
}) {
  const presets = draft.budgetType === 'daily' ? [5, 10, 20, 50] : [50, 100, 250, 500];
  const sym = currency === 'EUR' ? '€' : currency;
  const dayLabels = [1, 2, 3, 4, 5, 6, 0];
  const setSlot = (i: number, patch: Partial<CampaignDraft['schedule'][number]>) => set('schedule', draft.schedule.map((sl, j) => (j === i ? { ...sl, ...patch } : sl)));
  return (
    <div className="space-y-5">
      <StepHeader title={t('ads.w.budget.title')} intro={t('ads.w.budget.intro')} />
      <Section title={t('ads.wizard.budgetType')} desc={t('ads.w.budget.typeDesc')}>
        <div style={locked ? { opacity: 0.55, pointerEvents: 'none' } : undefined}>
        <ChoiceCards<'lifetime' | 'daily'> value={draft.budgetType} onChange={(v) => set('budgetType', v)} options={[
          { value: 'lifetime', label: t('ads.wizard.budgetLifetime'), desc: t('ads.w.budget.lifetimeDesc'), icon: <CalendarRange className="w-5 h-5" />, badge: t('ads.w.recommended') },
          { value: 'daily', label: t('ads.wizard.budgetDaily'), desc: t('ads.w.budget.dailyDesc'), icon: <CalendarClock className="w-5 h-5" /> },
        ]} />
        </div>
        <Field label={draft.budgetType === 'daily' ? t('ads.wizard.budgetPerDay') : t('ads.wizard.budgetTotal')} hint={t('ads.wizard.budgetHint').replace('{min}', fmtMoney(MIN_BUDGET_CENTS / 100))}>
          <div className="grid gap-3 sm:grid-cols-[200px_1fr] items-start">
            <div className="relative">
              <input type="number" inputMode="decimal" min={MIN_BUDGET_CENTS / 100} step={5} value={draft.budgetEuros} onChange={(e) => set('budgetEuros', Math.max(0, Number(e.target.value)))} style={{ ...inputStyle, paddingRight: 40, fontSize: 18, fontWeight: 650 }} className={`${focusRing} tabular-nums`} />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2" style={{ color: T3, fontSize: 15 }}>{currency === 'EUR' ? '€' : currency}</span>
            </div>
            <div className="flex gap-2 flex-wrap pt-1">
              {presets.map((p) => <Chip key={p} active={draft.budgetEuros === p} onClick={() => set('budgetEuros', p)}>{fmtMoney(p)}</Chip>)}
            </div>
          </div>
        </Field>
      </Section>
      <Section title={t('ads.w.budget.dates')} desc={t('ads.w.budget.datesDesc')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('ads.wizard.startAt')}>
            <input type="datetime-local" value={draft.startAt} onChange={(e) => set('startAt', e.target.value)} style={inputStyle} className={focusRing} />
          </Field>
          <Field label={t('ads.wizard.endAt')} hint={draft.budgetType === 'daily' ? t('ads.wizard.endOptional') : undefined}>
            <input type="datetime-local" value={draft.endAt} onChange={(e) => set('endAt', e.target.value)} style={inputStyle} className={focusRing} />
          </Field>
        </div>
        <div className="rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap" style={{ border: `1px solid ${BORDER}`, background: 'rgb(var(--ink)/0.03)' }}>
          <div>
            <p style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{t('ads.w.budget.estimateLabel')}</p>
            <p className="tabular-nums" style={{ color: T1, fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>{fmtMoney(totalEstimate)}</p>
          </div>
          <p style={{ color: T2, fontSize: 13 }}>{t('ads.wizard.estimate').replace('{total}', fmtMoney(totalEstimate)).replace('{days}', String(days))}</p>
        </div>
      </Section>
      {expert && (
        <Section title={<span className="inline-flex items-center gap-2"><Gavel className="w-4 h-4" style={{ color: T3 }} />{t('ads.x.bid.title')}</span>} desc={t('ads.x.bid.desc')}>
          <ChoiceCards<BidStrategy> value={draft.bidStrategy} onChange={(v) => set('bidStrategy', v)} options={[
            { value: 'lowest', label: t('ads.x.bid.lowest'), desc: t('ads.x.bid.lowestDesc'), badge: t('ads.w.recommended') },
            { value: 'cost_cap', label: t('ads.x.bid.cost_cap'), desc: t('ads.x.bid.cost_capDesc') },
            { value: 'bid_cap', label: t('ads.x.bid.bid_cap'), desc: t('ads.x.bid.bid_capDesc') },
            ...(draft.objective === 'OUTCOME_SALES' ? [{ value: 'min_roas' as BidStrategy, label: t('ads.x.bid.min_roas'), desc: t('ads.x.bid.min_roasDesc') }] : []),
          ]} />
          {(draft.bidStrategy === 'cost_cap' || draft.bidStrategy === 'bid_cap') && (
            <Field label={draft.bidStrategy === 'cost_cap' ? t('ads.x.bid.amountCost') : t('ads.x.bid.amountBid')} hint={t('ads.x.bid.amountHint')}>
              <div className="relative sm:max-w-[220px]">
                <input type="number" inputMode="decimal" min={0.1} step={0.5} value={draft.bidAmountEuros} onChange={(e) => set('bidAmountEuros', Math.max(0, Number(e.target.value)))} style={{ ...inputStyle, paddingRight: 40 }} className={`${focusRing} tabular-nums`} />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2" style={{ color: T3, fontSize: 15 }}>{sym}</span>
              </div>
            </Field>
          )}
          {draft.bidStrategy === 'min_roas' && (
            <Field label={t('ads.x.bid.roas')} hint={t('ads.x.bid.roasHint')}>
              <div className="relative sm:max-w-[220px]">
                <input type="number" inputMode="decimal" min={0.5} max={50} step={0.5} value={draft.roasFloor} onChange={(e) => set('roasFloor', Math.max(0, Number(e.target.value)))} style={{ ...inputStyle, paddingRight: 40 }} className={`${focusRing} tabular-nums`} />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2" style={{ color: T3, fontSize: 15 }}>×</span>
              </div>
            </Field>
          )}
        </Section>
      )}
      {expert && draft.budgetType === 'lifetime' && (
        <Section title={<span className="inline-flex items-center gap-2"><Clock className="w-4 h-4" style={{ color: T3 }} />{t('ads.x.sched.title')}</span>} desc={t('ads.x.sched.desc')}
          right={<GhostButton small onClick={() => set('schedule', [...draft.schedule, { days: [4, 5, 6], start_hour: 18, end_hour: 24 }])} disabled={draft.schedule.length >= 8}><Plus className="w-3.5 h-3.5" /> {t('ads.x.sched.add')}</GhostButton>}>
          {draft.schedule.length === 0 ? <p style={{ color: T3, fontSize: 13 }}>{t('ads.x.sched.empty')}</p> : draft.schedule.map((sl, i) => (
            <div key={i} className="rounded-xl p-3 flex items-center gap-3 flex-wrap" style={{ background: 'rgb(var(--ink)/0.03)', border: `1px solid ${BORDER}` }}>
              <div className="flex gap-1.5 flex-wrap">
                {dayLabels.map((d) => (
                  <button key={d} type="button" onClick={() => setSlot(i, { days: sl.days.includes(d) ? sl.days.filter((x) => x !== d) : [...sl.days, d] })}
                    className="h-9 w-9 rounded-lg text-[12.5px] font-bold cursor-pointer transition-colors duration-150"
                    style={sl.days.includes(d) ? { background: 'rgba(232,25,44,0.16)', border: '1px solid rgba(232,25,44,0.5)', color: 'var(--acc-ff8a91)' } : { background: 'rgb(var(--ink)/0.05)', border: `1px solid ${BORDER}`, color: T2 }}>
                    {t(`ads.x.sched.day.${d}`)}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2" style={{ color: T2, fontSize: 13 }}>
                <select value={sl.start_hour} onChange={(e) => setSlot(i, { start_hour: Number(e.target.value) })} style={{ ...inputStyle, width: 96, minHeight: 40, padding: '8px 10px' }}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}</select>
                <span>→</span>
                <select value={sl.end_hour} onChange={(e) => setSlot(i, { end_hour: Number(e.target.value) })} style={{ ...inputStyle, width: 96, minHeight: 40, padding: '8px 10px' }}>{Array.from({ length: 24 }, (_, h) => h + 1).map((h) => <option key={h} value={h}>{String(h % 24).padStart(2, '0')}:00</option>)}</select>
              </div>
              <button type="button" onClick={() => set('schedule', draft.schedule.filter((_, j) => j !== i))} className="h-9 w-9 rounded-lg flex items-center justify-center cursor-pointer hover:bg-white/[0.06] ml-auto" style={{ color: T3 }} aria-label={t('ads.wizard.remove')}><X className="w-4 h-4" /></button>
            </div>
          ))}
          <p style={{ color: T3, fontSize: 12, lineHeight: 1.45 }}>{t('ads.x.sched.note')}</p>
        </Section>
      )}
      {expert && draft.objective === 'OUTCOME_AWARENESS' && (
        <Section title={<span className="inline-flex items-center gap-2"><Repeat className="w-4 h-4" style={{ color: T3 }} />{t('ads.x.freq.title')}</span>} desc={t('ads.x.freq.desc')}>
          <div className="flex items-center gap-3 flex-wrap" style={{ color: T2, fontSize: 14 }}>
            <span>{t('ads.x.freq.max')}</span>
            <input type="number" inputMode="numeric" min={1} max={20} value={draft.frequencyMax} onChange={(e) => set('frequencyMax', Math.max(1, Math.min(20, Number(e.target.value))))} style={{ ...inputStyle, width: 80 }} className={`${focusRing} tabular-nums`} />
            <span>{t('ads.x.freq.every')}</span>
            <input type="number" inputMode="numeric" min={1} max={90} value={draft.frequencyDays} onChange={(e) => set('frequencyDays', Math.max(1, Math.min(90, Number(e.target.value))))} style={{ ...inputStyle, width: 80 }} className={`${focusRing} tabular-nums`} />
            <span>{t('ads.x.freq.days')}</span>
          </div>
        </Section>
      )}
      {expert && !locked && (
        <Section title={<span className="inline-flex items-center gap-2"><Link2 className="w-4 h-4" style={{ color: T3 }} />{t('ads.x.utm.title')}</span>} desc={t('ads.x.utm.desc')}>
          <input value={draft.urlTags} onChange={(e) => set('urlTags', e.target.value.slice(0, 500))} placeholder="utm_source=instagram&utm_medium=paid&utm_content={{ad.name}}" style={inputStyle} className={focusRing} />
        </Section>
      )}
      <Tip>{t('ads.wizard.billingNote')} {t('ads.w.budget.noYunoFee')}</Tip>
    </div>
  );
}
