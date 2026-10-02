// Abonnement Yuno CRM : l'offre en cours, ce qui a été consommé ce mois-ci,
// et les quatre offres (Gratuit, Essentiel, Pro, Business). Une lecture :
// get_crm_billing ; le paiement passe par l'edge club-subscription (actions
// crm_checkout / crm_portal), jamais par le front. La grille affichée vient de
// src/lib/crmPlans.ts, miroir de crm_plan_limits() — le serveur décide.

import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CreditCard, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { openPendingTab } from '@/lib/stripeConnectClient';
import { useLanguage } from '@/contexts/LanguageContext';
import { useVenueContext } from '@/hooks/useVenueContext';
import { CrmPageShell } from '@/components/crm/CrmPageShell';
import { AnalyticsLoading, ChoicePills, EmptyAnswer } from '@/components/analytics/kit';
import { KIT, useNumberFormat } from '@/components/analytics/kitFormat';
import { ReportCard, CardTitle } from '@/components/event-report/ui';
import {
  CRM_PLAN_LIMITS, CRM_PLANS, displayedPrice, planRank, trialDaysLeft,
  type BillingInterval, type CrmPlan, type CrmSubscriptionState,
} from '@/lib/crmPlans';

interface BillingPayload {
  subscription: (CrmSubscriptionState & {
    interval: BillingInterval | null; founder: boolean; cancel_at_period_end: boolean; has_stripe: boolean;
  }) | null;
  effective_plan: CrmPlan;
  founder_seats_left: number;
  can_manage: boolean;
  usage: {
    emails_sent: number; emails_included: number; email_credits: number;
    sms_included: number; members: number; members_limit: number | null;
    sync_minutes: number | null; automations_on: number;
  };
}

/** Message de l'edge (champ `code`) dans la langue du pro. */
async function edgeError(error: unknown, t: (k: string) => string): Promise<string> {
  try {
    const ctx = (error as { context?: Response })?.context;
    const body = ctx && typeof ctx.json === 'function' ? await ctx.json() : null;
    const code = typeof body?.code === 'string' ? body.code : null;
    if (code) {
      const k = `crm.billing.err.${code}`;
      const msg = t(k);
      if (msg !== k) return msg;
    }
  } catch {
    // Corps illisible : message générique.
  }
  return t('crm.billing.err.generic');
}

export default function CrmBilling() {
  const { t, language } = useLanguage();
  const { scope, venueId, organizerUserId } = useVenueContext();
  const { n, eur } = useNumberFormat();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const [interval, setBillingInterval] = useState<BillingInterval>('month');
  const [busy, setBusy] = useState<string | null>(null);

  const args = scope === 'organizer'
    ? { p_venue_id: null, p_organizer_user_id: organizerUserId }
    : { p_venue_id: venueId, p_organizer_user_id: null };
  const scopeBody = scope === 'organizer' ? { organizer_user_id: organizerUserId } : { venue_id: venueId };

  const q = useQuery({
    queryKey: ['crm-billing', args.p_venue_id, args.p_organizer_user_id],
    enabled: !!(args.p_venue_id || args.p_organizer_user_id),
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_crm_billing', args);
      if (error) throw error;
      return data as unknown as BillingPayload;
    },
  });

  const d = q.data;
  const sub = d?.subscription ?? null;
  const current = d?.effective_plan ?? 'free';
  const daysLeft = trialDaysLeft(sub);
  const founderOpen = (d?.founder_seats_left ?? 0) > 0 || !!sub?.founder;
  const dateFmt = new Intl.DateTimeFormat(language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const returned = params.get('checkout');

  async function choose(plan: Exclude<CrmPlan, 'free'>) {
    const tab = openPendingTab();
    setBusy(plan);
    try {
      const { data, error } = await invokeEdgeFunction<{ url?: string; updated?: boolean }>('club-subscription', {
        body: { action: 'crm_checkout', plan, interval, ...scopeBody },
      });
      if (!error && data?.updated) {
        // Changement d'offre sur l'abonnement en place : Stripe confirme par le webhook.
        tab.close();
        toast.success(t('crm.billing.switched').replace('{plan}', t(`crm.plan.${plan}`)));
        window.setTimeout(() => void qc.invalidateQueries({ queryKey: ['crm-billing'] }), 2500);
        return;
      }
      if (error || !data?.url) { tab.close(); toast.error(await edgeError(error, t)); return; }
      tab.go(data.url);
    } finally {
      setBusy(null);
    }
  }

  async function portal() {
    const tab = openPendingTab();
    setBusy('portal');
    try {
      const { data, error } = await invokeEdgeFunction<{ url?: string }>('club-subscription', {
        body: { action: 'crm_portal', ...scopeBody },
      });
      if (error || !data?.url) { tab.close(); toast.error(await edgeError(error, t)); return; }
      tab.go(data.url);
    } finally {
      setBusy(null);
      void qc.invalidateQueries({ queryKey: ['crm-billing'] });
    }
  }

  const statusLine = (() => {
    if (!sub || current === 'free') return t('crm.billing.status.free');
    if (sub.status === 'trialing' && daysLeft > 0) return t('crm.billing.status.trial').replace('{n}', n(daysLeft));
    if (!sub.has_stripe) {
      // Offre accordée par Yuno (démo, partenaire, offre sur devis) : pas de prix ni de renouvellement.
      return sub.current_period_end
        ? t('crm.billing.status.grantedUntil').replace('{date}', dateFmt.format(new Date(sub.current_period_end)))
        : t('crm.billing.status.granted');
    }
    const price = displayedPrice(sub.plan, sub.interval ?? 'month', sub.founder);
    const base = t(`crm.billing.status.${sub.interval === 'year' ? 'activeYear' : 'activeMonth'}`)
      .replace('{plan}', t(`crm.plan.${sub.plan}`)).replace('{price}', eur(price));
    if (sub.status === 'past_due') return `${base} · ${t('crm.billing.status.pastDue')}`;
    if (sub.cancel_at_period_end && sub.current_period_end) return `${base} · ${t('crm.billing.status.endsOn').replace('{date}', dateFmt.format(new Date(sub.current_period_end)))}`;
    if (sub.current_period_end) return `${base} · ${t('crm.billing.status.renewsOn').replace('{date}', dateFmt.format(new Date(sub.current_period_end)))}`;
    return base;
  })();

  return (
    <CrmPageShell title={t('crm.billing.title')} subtitle={t('crm.billing.subtitle')}>
      {q.isLoading && <AnalyticsLoading rows={3} />}
      {q.isError && <EmptyAnswer title={t('crm.common.loadError')} />}
      {d && (
        <>
          {returned === 'success' && (
            <ReportCard padding={16}><p style={{ color: KIT.T1, fontSize: 13.5 }}>{t('crm.billing.returned')}</p></ReportCard>
          )}

          <ReportCard>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p style={{ color: KIT.T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{t('crm.billing.current')}</p>
                <p className="mt-1" style={{ color: KIT.T1, fontSize: 22, fontWeight: 700 }}>{t(`crm.plan.${current}`)}</p>
                <p className="mt-1" style={{ color: KIT.T2, fontSize: 13 }}>{statusLine}</p>
                {sub?.founder && <p className="mt-1" style={{ color: KIT.RED, fontSize: 12.5, fontWeight: 600 }}>{t('crm.billing.founderHeld')}</p>}
              </div>
              {sub?.has_stripe && d.can_manage && (
                <button type="button" onClick={() => void portal()} disabled={busy !== null}
                  className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold"
                  style={{ border: `1px solid ${KIT.BORDER}`, color: KIT.T1 }}>
                  {busy === 'portal' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                  {t('crm.billing.manage')}
                </button>
              )}
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Usage label={t('crm.billing.usage.emails')}
                value={`${n(d.usage.emails_sent)} / ${n(d.usage.emails_included)}`}
                sub={d.usage.email_credits > 0 ? t('crm.billing.usage.credits').replace('{n}', n(d.usage.email_credits)) : undefined}
                share={d.usage.emails_included > 0 ? d.usage.emails_sent / d.usage.emails_included : 0} />
              <Usage label={t('crm.billing.usage.sms')} value={n(d.usage.sms_included)} sub={t('crm.billing.usage.smsSoon')} />
              <Usage label={t('crm.billing.usage.members')}
                value={d.usage.members_limit == null ? n(d.usage.members) : `${n(d.usage.members)} / ${n(d.usage.members_limit)}`} />
              <Usage label={t('crm.billing.usage.sync')}
                value={d.usage.sync_minutes == null ? '—' : syncLabel(d.usage.sync_minutes, t)} />
            </div>
          </ReportCard>

          <ReportCard>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <CardTitle title={t('crm.billing.plansTitle')} />
              <ChoicePills<BillingInterval>
                value={interval}
                label={t('crm.billing.interval')}
                options={[
                  { value: 'month', label: t('crm.billing.monthly') },
                  { value: 'year', label: t('crm.billing.yearly') },
                ]}
                onChange={setBillingInterval}
              />
            </div>
            {founderOpen && !sub?.founder && (
              <p className="mb-4 flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: 'rgb(var(--ink)/0.04)', color: KIT.T1, fontSize: 13 }}>
                <Sparkles className="h-4 w-4 flex-none" style={{ color: KIT.RED }} />
                {t('crm.billing.founderOffer').replace('{n}', n(d.founder_seats_left))}
              </p>
            )}
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {CRM_PLANS.map((plan) => (
                <PlanCard key={plan} plan={plan} interval={interval}
                  founder={plan !== 'free' && (!!sub?.founder || founderOpen)}
                  current={plan === current}
                  recommended={plan === 'pro'}
                  canChoose={d.can_manage && plan !== 'free' && plan !== current}
                  downgrade={planRank(plan) < planRank(current)}
                  busy={busy === plan}
                  disabled={busy !== null}
                  onChoose={() => void choose(plan as Exclude<CrmPlan, 'free'>)}
                />
              ))}
            </div>
            {!d.can_manage && <p className="mt-3" style={{ color: KIT.T3, fontSize: 12.5 }}>{t('crm.billing.ownerOnly')}</p>}
            <p className="mt-4" style={{ color: KIT.T3, fontSize: 12.5 }}>{t('crm.billing.footnote')}</p>
          </ReportCard>
        </>
      )}
    </CrmPageShell>
  );
}

function syncLabel(minutes: number, t: (k: string) => string): string {
  if (minutes >= 1440) return t('crm.billing.sync.daily');
  if (minutes >= 60) return t('crm.billing.sync.hourly');
  return t('crm.billing.sync.minutes').replace('{n}', String(minutes));
}

function Usage({ label, value, sub, share }: { label: string; value: string; sub?: string; share?: number }) {
  return (
    <div className="rounded-xl p-3" style={{ border: `1px solid ${KIT.BORDER}` }}>
      <p style={{ color: KIT.T3, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</p>
      <p className="mt-1 tabular-nums" style={{ color: KIT.T1, fontSize: 16, fontWeight: 650 }}>{value}</p>
      {share != null && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'rgb(var(--ink)/0.08)' }}>
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.round(share * 100))}%`, background: share >= 1 ? KIT.RED : 'rgb(var(--ink)/0.55)' }} />
        </div>
      )}
      {sub && <p className="mt-1" style={{ color: KIT.T3, fontSize: 12 }}>{sub}</p>}
    </div>
  );
}

function PlanCard({ plan, interval, founder, current, recommended, canChoose, downgrade, busy, disabled, onChoose }: {
  plan: CrmPlan; interval: BillingInterval; founder: boolean; current: boolean; recommended: boolean;
  canChoose: boolean; downgrade: boolean; busy: boolean; disabled: boolean; onChoose: () => void;
}) {
  const { t } = useLanguage();
  const { n, eur } = useNumberFormat();
  const l = CRM_PLAN_LIMITS[plan];
  const price = displayedPrice(plan, interval, founder);
  const publicPrice = displayedPrice(plan, interval, false);
  const features: string[] = [
    t('crm.billing.f.emails').replace('{n}', n(l.emailsMonth)),
    l.smsMonth > 0 ? t('crm.billing.f.sms').replace('{n}', n(l.smsMonth)) : null,
    t(`crm.billing.f.sync.${plan === 'free' ? 'daily' : plan === 'essential' ? 'hourly' : 'fast'}`),
    l.automations === 0 ? null : l.automations == null ? t('crm.billing.f.automationsAll') : t('crm.billing.f.automations').replace('{n}', n(l.automations)),
    l.abAndResend ? t('crm.billing.f.ab') : null,
    l.meta ? t('crm.billing.f.meta') : null,
    l.segmentExport ? t('crm.billing.f.export') : null,
    l.members == null ? t('crm.billing.f.membersAll') : l.members === 0 ? t('crm.billing.f.membersOne') : t('crm.billing.f.members').replace('{n}', n(l.members + 1)),
    l.yunoBadge ? t('crm.billing.f.badge') : null,
    plan === 'business' ? t('crm.billing.f.onboarding') : null,
  ].filter((x): x is string => !!x);

  return (
    <div className="flex flex-col rounded-2xl p-4"
      style={{ border: `1px solid ${current ? KIT.RED : KIT.BORDER}`, background: recommended ? 'rgb(var(--ink)/0.03)' : undefined }}>
      <div className="flex items-center justify-between gap-2">
        <p style={{ color: KIT.T1, fontSize: 15, fontWeight: 700 }}>{t(`crm.plan.${plan}`)}</p>
        {current ? <Pill text={t('crm.billing.currentPill')} red />
          : recommended ? <Pill text={t('crm.billing.recommended')} /> : null}
      </div>
      <p className="mt-0.5" style={{ color: KIT.T3, fontSize: 12.5, minHeight: 34 }}>{t(`crm.billing.pitch.${plan}`)}</p>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="tabular-nums" style={{ color: KIT.T1, fontSize: 26, fontWeight: 750 }}>{plan === 'free' ? t('crm.billing.freePrice') : eur(price)}</span>
        {plan !== 'free' && <span style={{ color: KIT.T3, fontSize: 12.5 }}>{t(interval === 'year' ? 'crm.billing.perYear' : 'crm.billing.perMonth')}</span>}
      </div>
      {plan !== 'free' && founder && price < publicPrice && (
        <p style={{ color: KIT.T3, fontSize: 12 }}><s>{eur(publicPrice)}</s> · {t('crm.billing.founderShort')}</p>
      )}
      <ul className="mt-3 flex-1 space-y-1.5">
        {features.map((f) => (
          <li key={f} className="flex gap-2" style={{ color: KIT.T2, fontSize: 12.5 }}>
            <Check className="mt-0.5 h-3.5 w-3.5 flex-none" style={{ color: 'var(--acc-34d399)' }} />{f}
          </li>
        ))}
      </ul>
      {canChoose && (
        <button type="button" onClick={onChoose} disabled={disabled}
          className="mt-4 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold"
          style={recommended && !downgrade ? { background: KIT.RED, color: '#fff' } : { border: `1px solid ${KIT.BORDER}`, color: KIT.T1 }}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {t(downgrade ? 'crm.billing.switchDown' : 'crm.billing.choose').replace('{plan}', t(`crm.plan.${plan}`))}
        </button>
      )}
    </div>
  );
}

function Pill({ text, red = false }: { text: string; red?: boolean }) {
  return (
    <span className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide"
      style={{ color: red ? KIT.RED : KIT.T2, border: `1px solid ${red ? KIT.RED : KIT.BORDER}` }}>{text}</span>
  );
}
