// Étape 2 — combien, et quand.

import { CalendarRange, CalendarClock } from 'lucide-react';
import { MIN_BUDGET_CENTS } from '@/lib/metaAds';
import type { CampaignDraft } from './types';
import { StepHeader, Section, Field, ChoiceCards, Chip, Tip, inputStyle, focusRing, T1, T2, T3, BORDER } from './ui';

export function StepBudget({ draft, set, currency, days, totalEstimate, fmtMoney, t }: {
  draft: CampaignDraft;
  set: <K extends keyof CampaignDraft>(k: K, v: CampaignDraft[K]) => void;
  currency: string;
  days: number;
  totalEstimate: number;
  fmtMoney: (eur: number) => string;
  t: (k: string) => string;
}) {
  const presets = draft.budgetType === 'daily' ? [5, 10, 20, 50] : [50, 100, 250, 500];
  return (
    <div className="space-y-5">
      <StepHeader title={t('ads.w.budget.title')} intro={t('ads.w.budget.intro')} />
      <Section title={t('ads.wizard.budgetType')} desc={t('ads.w.budget.typeDesc')}>
        <ChoiceCards<'lifetime' | 'daily'> value={draft.budgetType} onChange={(v) => set('budgetType', v)} options={[
          { value: 'lifetime', label: t('ads.wizard.budgetLifetime'), desc: t('ads.w.budget.lifetimeDesc'), icon: <CalendarRange className="w-5 h-5" />, badge: t('ads.w.recommended') },
          { value: 'daily', label: t('ads.wizard.budgetDaily'), desc: t('ads.w.budget.dailyDesc'), icon: <CalendarClock className="w-5 h-5" /> },
        ]} />
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
        <div className="rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap" style={{ border: `1px solid ${BORDER}`, background: 'rgba(255,255,255,0.03)' }}>
          <div>
            <p style={{ color: T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{t('ads.w.budget.estimateLabel')}</p>
            <p className="tabular-nums" style={{ color: T1, fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>{fmtMoney(totalEstimate)}</p>
          </div>
          <p style={{ color: T2, fontSize: 13 }}>{t('ads.wizard.estimate').replace('{total}', fmtMoney(totalEstimate)).replace('{days}', String(days))}</p>
        </div>
      </Section>
      <Tip>{t('ads.wizard.billingNote')} {t('ads.w.budget.noYunoFee')}</Tip>
    </div>
  );
}
