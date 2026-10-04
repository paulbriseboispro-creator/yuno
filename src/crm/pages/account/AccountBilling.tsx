/**
 * Compte › Abonnement et facturation : la formule (mensuel ⇄ annuel, prix qui
 * glisse), le moyen de paiement, le lien vers les Yunits, les informations de
 * facturation, les factures et la résiliation. L'état vient de get_crm_billing
 * (toute l'équipe) ; ce qui vit chez Stripe passe par les actions crm_* de
 * club-subscription, réservées au propriétaire. Un compte démo ne paie jamais.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { isDemoEmail } from '@/lib/demoPlan';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Modal, Skel } from '@/crm/ui/kit';
import { EASE, SPRING } from '@/crm/ui/motion';
import { YunitFace } from '@/crm/ui/YunitFace';
import { useCrmToast } from '@/crm/ui/toast';
import { useCrmT } from '@/crm/i18n';
import { CRM_ROUTES } from '@/crm/shell/nav';
import {
  useBillingAction, useBillingOverview, useCrmBilling,
  type BillingCustomer, type BillingOverview, type CrmBilling,
} from '@/crm/data/account';
import { Card, CardHead, Field, inputCss } from './accountUi';

type Interval = 'month' | 'year';
const BRANDS: Record<string, string> = { visa: 'Visa', mastercard: 'Mastercard', amex: 'American Express', cartes_bancaires: 'CB', discover: 'Discover', sepa: 'SEPA' };

function errKey(code: string): string {
  if (code === 'support_session_forbidden') return 'yc.acc.b.errSupport';
  if (code === 'billing_not_configured') return 'yc.acc.b.errConfig';
  return 'yc.acc.b.err';
}

/** Valeur qui glisse vers sa cible (700 ms, sortie douce), comme le prix du prototype. */
function useTween(target: number, dur = 700): number {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = from.current;
    if (start === target || typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      from.current = target; setV(target); return;
    }
    const t0 = performance.now();
    let raf = 0;
    const tick = () => {
      const p = Math.min(1, (performance.now() - t0) / dur);
      const e = 1 - Math.pow(1 - p, 4);
      const x = start + (target - start) * e;
      from.current = x; setV(x);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, dur]);
  return v;
}

export function AccountBilling() {
  const { user } = useAuth();
  const q = useCrmBilling();
  const demo = isDemoEmail(user?.email ?? '');
  if (q.isLoading || !q.data) {
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
        <Skel h={420} r={28} style={{ flex: '1 1 440px' }} />
        <Skel h={300} r={24} style={{ flex: '1 1 280px' }} />
      </div>
    );
  }
  return <BillingView b={q.data} demo={demo} />;
}

function BillingView({ b, demo }: { b: CrmBilling; demo: boolean }) {
  const { t, n, eur2, locale } = useCrmT();
  const toast = useCrmToast();
  const [params, setParams] = useSearchParams();
  const manage = b.can_manage && !demo;
  const [allInv, setAllInv] = useState(false);
  const ov = useBillingOverview(manage && !!b.subscription?.has_customer, allInv ? 50 : 12);
  const act = useBillingAction();
  const [busy, setBusy] = useState<string | null>(null);
  const [cancelAsk, setCancelAsk] = useState(false);
  const o = ov.data;
  const sub = o?.subscription ?? null;
  const dFull = (d: string) => new Date(d).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });

  // Retour de Stripe : un mot, puis l'URL redevient propre.
  useEffect(() => {
    const c = params.get('checkout');
    const card = params.get('card');
    if (!c && !card) return;
    if (c === 'success') toast(t('yc.acc.b.checkoutOk'));
    if (card === 'updated') toast(t('yc.acc.b.cardUpdated'));
    const next = new URLSearchParams(params);
    next.delete('checkout'); next.delete('card');
    setParams(next, { replace: true });
  }, [params, setParams, t, toast]);

  const curInterval: Interval = sub?.interval ?? (b.subscription?.interval === 'year' ? 'year' : 'month');
  const target: Interval = o?.scheduled?.interval ?? curInterval;
  const [sel, setSel] = useState<Interval>(target);
  useEffect(() => { setSel(target); }, [target]);

  const annual = sel === 'year';
  const unit = sub && sub.interval === sel && sub.unit_amount != null ? sub.unit_amount / 100 : annual ? b.pricing.price_year : b.pricing.price_month;
  const price = useTween(unit);
  const monthlyOfYear = Math.round((b.pricing.price_year / 12) * 100) / 100;
  const ending = !!sub?.cancel_at_period_end;
  const periodEnd = sub?.period_end ?? b.subscription?.current_period_end ?? null;
  const live = !!sub;
  const paused = b.effective_plan === 'paused';
  const trialing = (sub?.status ?? b.subscription?.status) === 'trialing';
  const trialEnd = sub?.trial_end ?? b.subscription?.trial_ends_at ?? null;
  const granted = !!b.subscription?.granted;

  const run = async (action: string, extra?: Record<string, unknown>, ok?: string) => {
    if (busy) return;
    setBusy(action);
    try {
      const r = await act.mutateAsync({ action, extra });
      if (r.url) { window.location.assign(r.url); return; }
      if (ok) toast(ok);
    } catch (e) {
      toast(t(errKey(e instanceof Error ? e.message : '')));
    }
    setBusy(null);
  };

  // Pastille de la formule.
  const pill = granted || demo ? { k: 'yc.acc.b.pill.granted', bg: 'var(--sand-100)', fg: 'var(--sand-700)' }
    : paused ? { k: 'yc.acc.b.pill.paused', bg: 'var(--red-50)', fg: 'var(--red-700)' }
      : ending && periodEnd ? { k: 'yc.acc.b.pill.ending', bg: 'var(--amber-50)', fg: 'var(--amber-700)' }
        : (sub?.status ?? b.subscription?.status) === 'past_due' ? { k: 'yc.acc.b.pill.pastDue', bg: 'var(--red-50)', fg: 'var(--red-700)' }
          : trialing && trialEnd ? { k: 'yc.acc.b.pill.trial', bg: 'var(--sand-100)', fg: 'var(--sand-700)' }
            : { k: 'yc.acc.b.pill.active', bg: 'var(--green-50)', fg: 'var(--green-700)' };
  const pillDate = pill.k.endsWith('ending') ? periodEnd : pill.k.endsWith('trial') ? trialEnd : null;

  // Ce que le choix de rythme déclenche.
  let switchCta: { label: string; note: string; to: Interval } | null = null;
  if (manage && live && !ending) {
    if (sel !== target) {
      const to = sel;
      const at = periodEnd ? dFull(periodEnd) : '';
      switchCta = to === curInterval
        ? { label: t('yc.acc.b.cancelChange'), note: t(`yc.acc.b.scheduled.${target}`, { date: o?.scheduled ? dFull(o.scheduled.at) : at }), to }
        : {
          label: t(to === 'year' ? 'yc.acc.b.cta.toYear' : 'yc.acc.b.cta.toMonth'),
          note: trialing ? t('yc.acc.b.note.trial')
            : to === 'year' ? t('yc.acc.b.note.toYear', { date: at, b: n(b.pricing.annual_bonus_yunits), n: n(b.pricing.monthly_yunits) })
              : t('yc.acc.b.note.toMonth', { date: at }),
          to,
        };
    }
  }

  const nextRow = !live ? null
    : ending && periodEnd ? t('yc.acc.b.row.nextNone', { date: dFull(periodEnd) })
      : o?.upcoming?.at ? t('yc.acc.b.row.nextVal', { date: dFull(o.upcoming.at), amount: eur2(o.upcoming.amount / 100) }) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {manage && ending && periodEnd && (
        <div role="status" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 20px', padding: '16px 20px', borderRadius: 20, background: 'var(--amber-50)', boxShadow: 'inset 0 0 0 1px rgba(229,154,11,.35)', animation: `yc-rise 600ms ${EASE} both` }}>
          <div style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--amber-700)' }}>{t('yc.acc.b.ending.t', { date: dFull(periodEnd) })}</span>
            <span style={{ fontSize: 14.5, lineHeight: 1.45, color: 'var(--amber-700)' }}>{t('yc.acc.b.ending.s')}</span>
          </div>
          <InkButton label={t('yc.acc.b.resume')} busy={busy === 'crm_resume'} onClick={() => void run('crm_resume', undefined, t('yc.acc.b.resumed'))} />
        </div>
      )}
      {manage && !ending && (sub?.status ?? b.subscription?.status) === 'past_due' && (
        <div role="alert" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 20px', padding: '16px 20px', borderRadius: 20, background: 'var(--red-50)', boxShadow: 'inset 0 0 0 1px var(--red-200)', animation: `yc-rise 600ms ${EASE} both` }}>
          <div style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--red-800)' }}>{t('yc.acc.b.pastDue.t')}</span>
            <span style={{ fontSize: 14.5, lineHeight: 1.45, color: 'var(--red-700)' }}>{t('yc.acc.b.pastDue.s')}</span>
          </div>
          <InkButton label={t('yc.acc.b.cardEdit')} busy={busy === 'crm_portal'} onClick={() => void run('crm_portal')} />
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'stretch', gap: 20 }}>
        <Card gap={22} style={{ flex: '1 1 440px', background: 'radial-gradient(60% 50% at 100% 0%,rgba(255,107,53,.07),transparent 70%),#fff', animation: `yc-rise 700ms ${EASE} 40ms both` }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '10px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t('yc.acc.b.formula')}</span>
              <span style={{ height: 24, padding: '0 10px', borderRadius: 99, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, background: pill.bg, color: pill.fg }}>
                <span style={{ width: 6, height: 6, borderRadius: 99, background: 'currentColor' }} />{t(pill.k, { date: pillDate ? dFull(pillDate) : '' })}
              </span>
            </div>
            <div role="group" aria-label={t('yc.acc.b.rhythm')} style={{ position: 'relative', display: 'inline-grid', gridTemplateColumns: '1fr 1fr', padding: 4, borderRadius: 99, background: 'var(--sand-100)' }}>
              <span aria-hidden style={{ position: 'absolute', top: 4, bottom: 4, left: 4, width: 'calc(50% - 4px)', borderRadius: 99, background: '#fff', boxShadow: 'var(--shadow-sm)', transform: `translateX(${annual ? '100%' : '0%'})`, transition: `transform 420ms ${EASE}` }} />
              {(['month', 'year'] as const).map((k) => (
                <button key={k} type="button" onClick={() => setSel(k)} aria-pressed={sel === k} disabled={!manage && live} style={{ position: 'relative', height: 36, padding: '0 18px', border: 0, background: 'none', borderRadius: 99, fontSize: 14, fontWeight: 600, cursor: 'pointer', color: sel === k ? 'var(--ink)' : 'var(--sand-500)', transition: 'color 240ms' }}>
                  {t(`yc.acc.b.${k}`)}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(68px,8vw,96px)', lineHeight: 0.9, letterSpacing: '-.055em', fontVariantNumeric: 'tabular-nums' }}>{n(price)}</span>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(30px,3.4vw,40px)', letterSpacing: '-.04em' }}>€</span>
              <span style={{ fontSize: 15.5, fontWeight: 500, color: 'var(--sand-600)' }}>{t('yc.acc.b.ht')} / {t(`yc.acc.b.per.${sel}`)}</span>
            </div>
            <span style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--sand-500)', textWrap: 'pretty' }}>
              {annual ? t('yc.acc.b.sub.year', { m: n(monthlyOfYear) }) : (sub?.tier ?? 'launch') === 'launch' ? t('yc.acc.b.sub.launch') : t('yc.acc.b.sub.month')}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <Row l={t('yc.acc.b.row.yunits')} v={annual ? t('yc.acc.b.row.yunitsYear', { n: n(b.pricing.monthly_yunits), b: n(b.pricing.annual_bonus_yunits) }) : t('yc.acc.b.row.yunitsMonth', { n: n(b.pricing.monthly_yunits) })} />
            {nextRow && <Row l={t('yc.acc.b.row.next')} v={nextRow} />}
            <Row l={t('yc.acc.b.row.tax')} v={t('yc.acc.b.row.taxVal', { n: b.pricing.vat_rate })} />
          </div>

          {o?.scheduled && sel === target && !ending && (
            <span style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--sand-700)', padding: '12px 16px', borderRadius: 16, background: 'var(--sand-50)' }}>
              {t(`yc.acc.b.scheduled.${o.scheduled.interval}`, { date: dFull(o.scheduled.at) })}
            </span>
          )}
          {switchCta && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16, borderRadius: 18, background: 'var(--sand-50)', animation: `yc-pop 360ms ${EASE} both` }}>
              <span style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--sand-700)' }}>{switchCta.note}</span>
              <div>
                <BrandButton
                  label={busy === 'crm_switch_interval' ? t('yc.acc.b.cta.confirming') : switchCta.label}
                  busy={busy === 'crm_switch_interval'}
                  onClick={() => {
                    const to = switchCta?.to ?? 'month';
                    void run('crm_switch_interval', { interval: to }, to === curInterval ? t('yc.acc.b.changeCanceled') : t(`yc.acc.b.switched.${to}`));
                  }}
                />
              </div>
            </div>
          )}
          {manage && !live && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16, borderRadius: 18, background: 'var(--sand-50)' }}>
              <span style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--sand-700)' }}>
                {paused ? t('yc.acc.b.subNote.paused')
                  : trialing && trialEnd ? t('yc.acc.b.subNote.trial', { date: dFull(trialEnd) })
                    : granted && periodEnd ? t('yc.acc.b.subNote.granted', { date: dFull(periodEnd) }) : t('yc.acc.b.sub.month')}
              </span>
              <div>
                <BrandButton
                  label={busy === 'crm_checkout' ? t('yc.acc.b.redirect') : `${t('yc.acc.b.subscribe')} · ${n(unit)} € ${t('yc.acc.b.ht')} / ${t(`yc.acc.b.per.${sel}`)}`}
                  busy={busy === 'crm_checkout'}
                  onClick={() => void run('crm_checkout', { interval: sel })}
                />
              </div>
            </div>
          )}
          {(!manage) && (
            <span style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 14, lineHeight: 1.5, color: 'var(--sand-600)', padding: '12px 16px', borderRadius: 16, background: 'var(--sand-50)' }}>
              <Icon name="lock" size={15} stroke={2.2} style={{ flex: 'none', marginTop: 3 }} />{t(demo ? 'yc.acc.b.demo' : 'yc.acc.b.ownerOnly')}
            </span>
          )}
        </Card>

        <div style={{ flex: '1 1 280px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
          {manage && !!b.subscription?.has_customer && (
            <PaymentCard ov={o} loading={ov.isLoading && !!b.subscription?.has_customer} busy={busy === 'crm_portal'} onEdit={() => void run('crm_portal')} hasCustomer={!!b.subscription?.has_customer} />
          )}
          <Hv as={Link} to={CRM_ROUTES.yunits} style={{ boxSizing: 'border-box', borderRadius: 24, background: 'var(--sand-50)', padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 14, color: 'var(--ink)', textDecoration: 'none', transition: `background 200ms,translate 240ms ${EASE}`, animation: `yc-rise 700ms ${EASE} 220ms both` }} hover={{ background: 'var(--sand-100)', translate: '0 -3px', color: 'var(--ink)', textDecoration: 'none' }}>
            <YunitFace mood={b.yunits_balance < 2000 ? 'inquiet' : 'content'} size={44} />
            <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>{t('yc.acc.b.yunits', { n: n(b.yunits_balance) })}</span>
              <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{t('yc.acc.b.yunitsSub')}</span>
            </span>
            <Icon name="chevronRight" size={18} stroke={2.2} style={{ color: 'var(--sand-400)' }} />
          </Hv>
        </div>
      </div>

      {manage && ov.isError && (
        <div role="alert" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: '14px 18px', borderRadius: 18, background: 'var(--sand-50)', fontSize: 14.5, color: 'var(--sand-700)' }}>
          <span style={{ flex: 1 }}>{t('yc.acc.b.loadErr')}</span>
          <Hv as="button" type="button" onClick={() => void ov.refetch()} style={{ height: 36, padding: '0 14px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', cursor: 'pointer' }} hover={{ borderColor: 'var(--sand-300)' }}>{t('yc.acc.b.retry')}</Hv>
        </div>
      )}

      {manage && <BillingDetails customer={o?.customer ?? null} loading={ov.isLoading && !!b.subscription?.has_customer} />}

      {manage && (
        <Invoices invoices={o?.invoices ?? []} loading={ov.isLoading && !!b.subscription?.has_customer} hasMore={!!o?.has_more || (o?.invoices.length ?? 0) > 5} all={allInv} onToggle={() => setAllInv((x) => !x)} dFull={dFull} />
      )}

      {manage && live && !ending && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0', animation: `yc-rise 700ms ${EASE} 460ms both` }}>
          <Hv as="button" type="button" onClick={() => setCancelAsk(true)} style={{ height: 40, padding: '0 14px', border: 0, borderRadius: 99, background: 'none', fontSize: 14, fontWeight: 500, color: 'var(--sand-500)', cursor: 'pointer', transition: 'color 140ms,background 140ms' }} hover={{ color: 'var(--red-600)', background: 'var(--red-50)' }}>{t('yc.acc.b.cancel')}</Hv>
        </div>
      )}

      <Modal open={cancelAsk} onClose={() => setCancelAsk(false)} width={460} label={t('yc.acc.b.cancelT')} blur>
        <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.03em', lineHeight: 1.1 }}>{t('yc.acc.b.cancelT')}</h2>
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: 'var(--sand-600)', textWrap: 'pretty' }}>{t('yc.acc.b.cancelB', { date: periodEnd ? dFull(periodEnd) : '—' })}</p>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10 }}>
            <Hv as="button" type="button" onClick={() => setCancelAsk(false)} style={{ height: 46, padding: '0 20px', borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer', color: 'var(--ink)', transition: `transform 200ms ${SPRING}` }} hover={{ background: 'var(--paper)' }} active={{ transform: 'scale(.97)' }}>{t('yc.acc.b.keep')}</Hv>
            <InkButton
              label={t('yc.acc.b.cancelBtn')}
              busy={busy === 'crm_cancel'}
              onClick={async () => {
                await run('crm_cancel', undefined, t('yc.acc.b.canceled', { date: periodEnd ? dFull(periodEnd) : '—' }));
                setCancelAsk(false);
              }}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}

function Row({ l, v }: { l: string; v: string }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '2px 16px', padding: '12px 0', borderTop: '1px solid var(--sand-100)', fontSize: 14.5 }}>
      <span style={{ color: 'var(--sand-600)' }}>{l}</span>
      <b style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{v}</b>
    </div>
  );
}

const spin = (light: boolean) => <span style={{ width: 16, height: 16, borderRadius: 99, border: `2.4px solid ${light ? 'var(--red-200)' : 'rgba(255,255,255,.35)'}`, borderTopColor: light ? 'var(--red-500)' : '#fff', animation: 'yc-spin 700ms linear infinite' }} />;

function BrandButton({ label, busy, onClick }: { label: string; busy: boolean; onClick: () => void }) {
  return (
    <Hv as="button" type="button" onClick={onClick} disabled={busy} style={{ height: 48, padding: '0 6px 0 22px', border: 0, borderRadius: 99, background: 'var(--gradient-brand)', color: '#fff', fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 10, boxShadow: 'var(--shadow-cta)', cursor: 'pointer', transition: `transform 200ms ${SPRING},filter 160ms` }} hover={{ filter: 'brightness(1.05)', transform: 'translateY(-1px)' }} active={{ transform: 'scale(.97)' }}>
      {label}
      <span style={{ width: 36, height: 36, borderRadius: 99, background: '#fff', color: 'var(--red-500)', display: 'grid', placeItems: 'center' }}>{busy ? spin(true) : <Icon name="arrowRight" size={17} stroke={2.4} />}</span>
    </Hv>
  );
}

function InkButton({ label, busy, onClick }: { label: string; busy: boolean; onClick: () => void }) {
  return (
    <Hv as="button" type="button" onClick={onClick} disabled={busy} style={{ flex: 'none', height: 44, padding: '0 20px', border: 0, borderRadius: 99, background: 'var(--ink)', color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 10, transition: `transform 200ms ${SPRING},background 160ms` }} hover={{ background: 'var(--sand-700)' }} active={{ transform: 'scale(.97)' }}>
      {busy && spin(false)}{label}
    </Hv>
  );
}

function PaymentCard({ ov, loading, busy, onEdit, hasCustomer }: { ov: BillingOverview | undefined; loading: boolean; busy: boolean; onEdit: () => void; hasCustomer: boolean }) {
  const { t } = useCrmT();
  const card = ov?.card ?? null;
  const exp = card?.exp_month && card.exp_year ? `${String(card.exp_month).padStart(2, '0')}/${String(card.exp_year).slice(-2)}` : null;
  return (
    <Hv as="section" style={{ boxSizing: 'border-box', borderRadius: 24, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-xs)', padding: 22, display: 'flex', flexDirection: 'column', gap: 16, transition: `box-shadow 240ms,translate 240ms ${EASE}`, animation: `yc-rise 700ms ${EASE} 130ms both` }} hover={{ translate: '0 -3px', boxShadow: 'inset 0 0 0 1px var(--sand-300),var(--shadow-md)' }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t('yc.acc.b.card')}</span>
      {loading ? <Skel h={150} r={18} /> : (
        <div style={{ position: 'relative', overflow: 'hidden', boxSizing: 'border-box', height: 150, borderRadius: 18, padding: '18px 20px', color: 'var(--text-on-night)', background: 'radial-gradient(70% 90% at 100% 0%,rgba(255,107,53,.5),transparent 65%),radial-gradient(60% 80% at 0% 100%,rgba(227,20,27,.4),transparent 70%),var(--noise-night),var(--night)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxShadow: '0 12px 28px -12px rgba(28,21,23,.5)', animation: `yc-rise 520ms ${EASE} both` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18, letterSpacing: '-.02em' }}>{card ? (BRANDS[card.brand] ?? card.brand.toUpperCase()) : t('yc.acc.b.cardNone')}</span>
            <span style={{ width: 34, height: 24, borderRadius: 6, background: 'rgba(255,255,255,.18)' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 15, letterSpacing: '.1em', whiteSpace: 'nowrap' }}>•••• •••• •••• {card?.last4 ?? '····'}</span>
            <span style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-on-night-2)' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ov?.customer?.name ?? ''}</span>
              {exp && <span style={{ flex: 'none' }}>{t('yc.acc.b.cardExp', { d: exp })}</span>}
            </span>
          </div>
        </div>
      )}
      {hasCustomer && (
        <Hv as="button" type="button" onClick={onEdit} disabled={busy} style={{ height: 44, borderRadius: 99, background: '#fff', border: '1px solid var(--sand-200)', boxShadow: 'var(--shadow-xs)', fontSize: 14.5, fontWeight: 600, color: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, cursor: 'pointer', transition: `border-color 140ms,transform 200ms ${SPRING}` }} hover={{ borderColor: 'var(--sand-300)', background: 'var(--paper)' }} active={{ transform: 'scale(.98)' }}>
          {busy && <span style={{ width: 15, height: 15, borderRadius: 99, border: '2.2px solid var(--sand-200)', borderTopColor: 'var(--ink)', animation: 'yc-spin 700ms linear infinite' }} />}
          {t(busy ? 'yc.acc.b.redirect' : card ? 'yc.acc.b.cardEdit' : 'yc.acc.b.cardAdd')}
        </Hv>
      )}
      <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--sand-500)', textAlign: 'center' }}>{t('yc.acc.b.cardNote')}</span>
    </Hv>
  );
}

const EMPTY: BillingCustomer = { name: '', email: '', line1: '', line2: '', postal_code: '', city: '', country: 'FR', siret: '', vat: '' };

function BillingDetails({ customer, loading }: { customer: BillingCustomer | null; loading: boolean }) {
  const { t } = useCrmT();
  const toast = useCrmToast();
  const act = useBillingAction();
  const [edit, setEdit] = useState(false);
  const [d, setD] = useState<BillingCustomer>(customer ?? EMPTY);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (!edit) setD(customer ?? EMPTY); }, [customer, edit]);
  const c = customer ?? EMPTY;
  const street = [c.line1, [c.postal_code, c.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const rows: [string, string][] = [
    ['yc.acc.b.addr.name', c.name], ['yc.acc.b.addr.street', street], ['yc.acc.b.addr.siret', c.siret],
    ['yc.acc.b.addr.vat', c.vat], ['yc.acc.b.addr.email', c.email],
  ];
  const fields: [keyof BillingCustomer, string, string?][] = [
    ['name', 'yc.acc.b.addr.name'], ['line1', 'yc.acc.b.addr.street'], ['postal_code', 'yc.acc.b.addr.zip'], ['city', 'yc.acc.b.addr.city'],
    ['siret', 'yc.acc.b.addr.siret', 'bad_siret'], ['vat', 'yc.acc.b.addr.vat', 'bad_vat'], ['email', 'yc.acc.b.addr.email', 'bad_email'],
  ];
  const save = async () => {
    setErr(null);
    try {
      await act.mutateAsync({ action: 'crm_billing_details', extra: { ...d } });
      setEdit(false);
      toast(t('yc.acc.b.addr.saved'));
    } catch (e) {
      const code = e instanceof Error ? e.message : '';
      if (['bad_siret', 'bad_vat', 'bad_email'].includes(code)) setErr(code);
      else toast(t(errKey(code)));
    }
  };
  const ERR: Record<string, string> = { bad_siret: 'yc.acc.b.addr.badSiret', bad_vat: 'yc.acc.b.addr.badVat', bad_email: 'yc.acc.b.addr.badEmail' };

  return (
    <Card gap={6} style={{ animation: `yc-rise 700ms ${EASE} 300ms both` }}>
      <CardHead
        title={t('yc.acc.b.addr.t')}
        sub={t('yc.acc.b.addr.s')}
        right={!edit && !loading ? (
          <Hv as="button" type="button" onClick={() => setEdit(true)} style={{ height: 40, padding: '0 18px', borderRadius: 99, background: '#fff', border: '1px solid var(--sand-200)', fontSize: 14, fontWeight: 600, color: 'var(--ink)', cursor: 'pointer', transition: `border-color 140ms,transform 200ms ${SPRING}` }} hover={{ borderColor: 'var(--sand-300)', background: 'var(--paper)' }} active={{ transform: 'scale(.97)' }}>{t('yc.acc.b.addr.edit')}</Hv>
        ) : undefined}
      />
      {loading ? <Skel h={220} r={14} style={{ marginTop: 10 }} /> : !edit ? (
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 10 }}>
          {rows.map(([k, v]) => (
            <div key={k} style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '2px 16px', padding: '12px 0', borderTop: '1px solid var(--sand-100)', fontSize: 14.5 }}>
              <span style={{ color: 'var(--sand-500)' }}>{t(k)}</span>
              <span style={{ fontWeight: 500, textAlign: 'right', color: v ? 'var(--ink)' : 'var(--sand-400)' }}>{v || t('yc.acc.b.addr.empty')}</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 18, animation: `yc-pop 360ms ${EASE} both` }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,240px),1fr))', gap: 16 }}>
            {fields.map(([k, lk, code]) => (
              <Field key={k} label={t(lk)} error={err && code === err ? t(ERR[err]) : null}>
                <input type={k === 'email' ? 'email' : 'text'} value={d[k]} onChange={(e) => { setD((x) => ({ ...x, [k]: e.target.value })); if (code === err) setErr(null); }} className="yc-field" style={{ ...inputCss, borderColor: err && code === err ? 'var(--red-400)' : 'var(--sand-200)' }} />
              </Field>
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <InkButton label={t('yc.acc.save')} busy={act.isPending} onClick={() => void save()} />
            <Hv as="button" type="button" onClick={() => { setEdit(false); setErr(null); }} style={{ height: 44, padding: '0 20px', borderRadius: 99, background: '#fff', border: '1px solid var(--sand-200)', fontSize: 15, fontWeight: 600, color: 'var(--ink)', cursor: 'pointer' }} hover={{ background: 'var(--paper)' }}>{t('yc.acc.cancel')}</Hv>
          </div>
        </div>
      )}
    </Card>
  );
}

function Invoices({ invoices, loading, hasMore, all, onToggle, dFull }: { invoices: BillingOverview['invoices']; loading: boolean; hasMore: boolean; all: boolean; onToggle: () => void; dFull: (d: string) => string }) {
  const { t, eur2 } = useCrmT();
  const [done, setDone] = useState<string | null>(null);
  const list = all ? invoices : invoices.slice(0, 5);
  const status = (s: string | null) => s === 'paid' ? ['yc.acc.b.inv.paid', 'var(--green-700)'] : s === 'open' ? ['yc.acc.b.inv.open', 'var(--amber-700)'] : s === 'void' ? ['yc.acc.b.inv.void', 'var(--sand-500)'] : ['yc.acc.b.inv.uncollectible', 'var(--red-600)'];
  return (
    <Card gap={6} style={{ animation: `yc-rise 700ms ${EASE} 380ms both` }}>
      <CardHead title={t('yc.acc.b.inv.t')} sub={t('yc.acc.b.inv.s')} />
      {loading ? <Skel h={200} r={14} style={{ marginTop: 10 }} /> : list.length === 0 ? (
        <span style={{ marginTop: 10, padding: '16px 0 4px', borderTop: '1px solid var(--sand-100)', fontSize: 14.5, color: 'var(--sand-500)' }}>{t('yc.acc.b.inv.none')}</span>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 10 }}>
          {list.map((iv, i) => {
            const [sk, sc] = status(iv.status);
            const ok = done === iv.id;
            return (
              <Hv key={iv.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto auto', alignItems: 'center', gap: '4px 16px', padding: 12, margin: '0 -12px', borderTop: '1px solid var(--sand-100)', borderRadius: 14, animation: `yc-rise 520ms ${EASE} ${(all && i >= 5 ? i - 5 : i) * 60}ms both` }} hover={{ background: 'var(--sand-50)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{iv.kind === 'subscription' ? t(iv.interval === 'year' ? 'yc.acc.b.inv.subYear' : 'yc.acc.b.inv.subMonth') : iv.title || t('yc.acc.b.inv.subscription')}</span>
                  <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{dFull(iv.at)}{iv.number ? ` · ${iv.number}` : ''}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                  <span style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{eur2(iv.total / 100)}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: sc }}>{t(sk)}</span>
                </div>
                <Hv
                  as="a"
                  href={iv.pdf ?? iv.url ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => { setDone(iv.id); window.setTimeout(() => setDone(null), 2000); }}
                  aria-label={t('yc.acc.b.inv.dl')}
                  title={t('yc.acc.b.inv.dl')}
                  style={{ width: 40, height: 40, borderRadius: 99, background: ok ? 'var(--green-50)' : 'var(--sand-50)', color: ok ? 'var(--green-700)' : 'var(--sand-700)', display: 'grid', placeItems: 'center', textDecoration: 'none', transition: `background 200ms,color 200ms,transform 200ms ${SPRING}`, pointerEvents: iv.pdf || iv.url ? 'auto' : 'none', opacity: iv.pdf || iv.url ? 1 : 0.4 }}
                  hover={{ transform: 'translateY(-1px)', textDecoration: 'none' }}
                  active={{ transform: 'scale(.92)' }}
                >
                  <Icon name={ok ? 'check' : 'download'} size={17} stroke={2.2} />
                </Hv>
              </Hv>
            );
          })}
        </div>
      )}
      {hasMore && !loading && (
        <div>
          <Hv as="button" type="button" onClick={onToggle} style={{ height: 40, padding: '0 4px', border: 0, background: 'none', fontSize: 14, fontWeight: 600, color: 'var(--ink)', display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }} hover={{ color: 'var(--red-600)' }}>
            {t(all ? 'yc.acc.b.inv.less' : 'yc.acc.b.inv.more')}
            <Icon name="chevronDown" size={15} stroke={2.4} style={{ transform: `rotate(${all ? 180 : 0}deg)`, transition: `transform 320ms ${EASE}` }} />
          </Hv>
        </div>
      )}
    </Card>
  );
}
