/**
 * « Choisir mon abonnement » (maquette C, 03/11) : mensuel ou annuel, les
 * Yunits offerts en haut à droite, ce qui est prélevé aujourd'hui et à quelle
 * date, puis le paiement sécurisé de Stripe (crm_checkout). Ouverte par
 * l'adresse (`?subscribe=1` | `month` | `year`) depuis n'importe quelle page.
 */
import { useEffect, useState } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Modal } from '@/crm/ui/kit';
import { SPRING } from '@/crm/ui/motion';
import { useCrmToast } from '@/crm/ui/toast';
import { useCrmT } from '@/crm/i18n';
import { useBillingAction } from '@/crm/data/account';
import { annualFreeMonths, chargedToday } from '@/crm/lib/plan';
import { useChooser, usePlan, usePriceLabel } from './usePlan';

type Interval = 'month' | 'year';

function errKey(code: string): string {
  if (code === 'support_session_forbidden') return 'yc.acc.b.errSupport';
  if (code === 'billing_not_configured') return 'yc.acc.b.errConfig';
  if (code === 'already_subscribed') return 'yc.acc.b.errAlready';
  return 'yc.acc.b.err';
}

export function PlanChooser() {
  const chooser = useChooser();
  const plan = usePlan();
  const { t } = useCrmT();
  const open = !!chooser.value && !!plan.billing && !plan.exempt;
  return (
    <Modal open={open} onClose={chooser.close} width={760} label={t('yc.plan.c.label')} blur>
      {open && <ChooserBody initial={chooser.value === 'year' ? 'year' : 'month'} onClose={chooser.close} />}
    </Modal>
  );
}

function ChooserBody({ initial, onClose }: { initial: Interval; onClose: () => void }) {
  const { t, tp, n, eur, eur2, dLong, lang } = useCrmT();
  const toast = useCrmToast();
  const plan = usePlan();
  const price = usePriceLabel();
  const act = useBillingAction();
  const [sel, setSel] = useState<Interval>(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setSel(initial); }, [initial]);

  const b = plan.billing;
  if (!b) return null;
  const sub = b.subscription;
  const founder = sub?.offer?.kind === 'founder' && sub.status === 'trialing';
  const today = chargedToday(sub);
  const trialEnd = !today ? sub?.trial_ends_at ?? null : null;
  const pm = b.pricing.price_month;
  const py = b.pricing.price_year;
  const free = annualFreeMonths(pm, py);
  const perMonthOfYear = py / 12;
  const yunits = b.pricing.monthly_yunits;
  const unit = sel === 'year' ? py : pm;

  const checkout = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await act.mutateAsync({ action: 'crm_checkout', extra: { interval: sel, lang } });
      if (r.url) { window.location.assign(r.url); return; }
    } catch (e) {
      toast(t(errKey(e instanceof Error ? e.message : '')));
    }
    setBusy(false);
  };

  const card = (k: Interval) => ({
    textAlign: 'left' as const, border: 0, cursor: 'pointer', padding: 20, borderRadius: 22, background: '#fff', fontFamily: 'inherit', color: 'inherit',
    display: 'flex', flexDirection: 'column' as const, gap: 10, transition: `box-shadow 200ms, transform 200ms ${SPRING}`,
    boxShadow: sel === k ? 'inset 0 0 0 2px var(--red-500), 0 8px 24px rgba(227,20,27,.12)' : 'inset 0 0 0 1px var(--sand-200)',
  });
  const big = { fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(34px,5vw,44px)', letterSpacing: '-.05em', lineHeight: 1 } as const;
  const check = <Icon name="check" size={17} stroke={2.6} color="var(--green-500)" style={{ flex: 'none', marginTop: 1 }} />;

  return (
    <div style={{ position: 'relative', padding: 'clamp(22px,4vw,32px)', display: 'flex', flexDirection: 'column', gap: 22 }}>
      <Hv as="button" type="button" aria-label={t('yc.plan.ok.close')} onClick={onClose} style={{ position: 'absolute', top: 14, right: 14, width: 36, height: 36, border: 0, borderRadius: 99, background: 'transparent', color: 'var(--sand-500)', display: 'grid', placeItems: 'center', cursor: 'pointer' }} hover={{ background: 'var(--sand-100)' }}>
        <Icon name="x" size={16} stroke={2.2} />
      </Hv>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '18px 24px', paddingRight: 28 }}>
        <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t('yc.plan.c.k')}</span>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(26px,3.4vw,32px)', letterSpacing: '-.04em', lineHeight: 1.05, textWrap: 'balance' }}>
            {t(plan.paused ? 'yc.plan.c.titlePaused' : 'yc.plan.c.title')}
          </h2>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.45, color: 'var(--sand-600)' }}>
            {trialEnd ? t('yc.plan.c.subTrial', { date: dLong(trialEnd) }) : t('yc.plan.c.subNow')}
          </p>
        </div>
        <div style={{ flex: '0 1 230px', minWidth: 200, boxSizing: 'border-box', padding: '18px 20px', borderRadius: 22, color: 'var(--text-on-night)', background: 'radial-gradient(90% 120% at 100% 0%,rgba(255,107,53,.55),transparent 65%),radial-gradient(70% 90% at 0% 100%,rgba(227,20,27,.4),transparent 70%),var(--night)', boxShadow: '0 0 0 1px rgba(255,255,255,.08),0 18px 40px -10px rgba(227,20,27,.45)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {founder ? (
            <>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: '#FF8A4C' }}><Icon name="sparkles" size={15} stroke={2.2} />{t('yc.plan.c.founder.k')}</span>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.03em', lineHeight: 1.1 }}>{t('yc.plan.c.founder.t')}</span>
              <span style={{ fontSize: 12.5, color: 'var(--text-on-night-2)', lineHeight: 1.4 }}>{t('yc.plan.c.founder.s', { price: price(pm, 'month', plan.vat) })}</span>
            </>
          ) : (
            <>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: '#FF8A4C' }}><Icon name="coin" size={15} stroke={2.2} />{t('yc.plan.c.gift.k')}</span>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 40, letterSpacing: '-.05em', lineHeight: 1 }}>{n(yunits)}</span>
              <span style={{ fontSize: 15, fontWeight: 600 }}>{t('yc.plan.c.gift.u')}</span>
              <span style={{ fontSize: 12.5, color: 'var(--text-on-night-2)', lineHeight: 1.4 }}>{t('yc.plan.c.gift.s', { n: n(yunits) })}</span>
            </>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,240px),1fr))', gap: 14 }}>
        <Hv as="button" type="button" aria-pressed={sel === 'month'} onClick={() => setSel('month')} style={card('month')} hover={{ transform: 'translateY(-1px)' }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{t('yc.plan.c.month')}</span>
          <span style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 6 }}>
            <span style={big}>{eur(pm)}</span>
            <span style={{ fontSize: 14, color: 'var(--sand-600)' }}>{plan.vat > 0 ? `${t('yc.plan.c.ht')} ` : ''}{t('yc.plan.c.per.month')}</span>
          </span>
          <span style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--sand-600)' }}>{t('yc.plan.c.monthNote')}</span>
        </Hv>
        <Hv as="button" type="button" aria-pressed={sel === 'year'} onClick={() => setSel('year')} style={card('year')} hover={{ transform: 'translateY(-1px)' }}>
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>{t('yc.plan.c.year')}</span>
            {free > 0 && <span style={{ height: 24, padding: '0 10px', borderRadius: 99, background: 'var(--red-50)', color: 'var(--red-700)', fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>{tp('yc.plan.c.yearBadge', free)}</span>}
          </span>
          <span style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 6 }}>
            <span style={big}>{eur(py)}</span>
            <span style={{ fontSize: 14, color: 'var(--sand-600)' }}>{plan.vat > 0 ? `${t('yc.plan.c.ht')} ` : ''}{t('yc.plan.c.per.year')}</span>
            {free > 0 && <span style={{ fontSize: 14, color: 'var(--sand-400)', textDecoration: 'line-through' }}>{eur(pm * 12)}</span>}
          </span>
          <span style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--sand-600)' }}>
            {free > 0
              ? t('yc.plan.c.yearNote', { m: Number.isInteger(perMonthOfYear) ? eur(perMonthOfYear) : eur2(perMonthOfYear), paid: 12 - free })
              : t('yc.plan.c.monthNote')}
          </span>
        </Hv>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,240px),1fr))', gap: '8px 20px', padding: '18px 20px', borderRadius: 20, background: 'var(--sand-50)' }}>
        {(['inc1', 'inc2', 'inc3', 'inc4'] as const).map((k) => (
          <span key={k} style={{ display: 'flex', gap: 10, fontSize: 14, lineHeight: 1.4 }}>{check}{t(`yc.plan.c.${k}`)}</span>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', borderRadius: 20, boxShadow: 'inset 0 0 0 1px var(--sand-100)' }}>
        <Line l={t('yc.plan.c.today')} v={trialEnd ? eur(0) : price(unit, sel, plan.vat)} strong />
        {trialEnd && <Line l={t('yc.plan.c.onDate', { date: dLong(trialEnd) })} v={t(`yc.plan.c.then.${sel}`, { price: `${eur(unit)}${plan.vat > 0 ? ` ${t('yc.plan.c.ht')}` : ''}` })} />}
        {!founder && <Line l={t('yc.plan.c.yunitsRow')} v={n(yunits)} />}
        {plan.vat === 0 && <Line l="" v={t('yc.plan.vatNone')} muted />}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {plan.holder ? (
          <Hv
            as="button" type="button" onClick={() => void checkout()} disabled={busy}
            style={{ height: 54, border: 0, borderRadius: 99, background: 'var(--gradient-brand)', color: '#fff', fontSize: 16, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, cursor: busy ? 'wait' : 'pointer', boxShadow: 'var(--shadow-cta)', transition: `transform 200ms ${SPRING},filter 160ms` }}
            hover={{ filter: 'brightness(1.05)', transform: 'translateY(-1px)' }} active={{ transform: 'scale(.98)' }}
          >
            {busy ? t('yc.plan.c.redirect') : t('yc.plan.c.cta')}
            <Icon name="arrowRight" size={17} stroke={2.4} />
          </Hv>
        ) : (
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderRadius: 16, background: 'var(--sand-50)', fontSize: 14.5, color: 'var(--sand-700)' }}>
            <Icon name="lock" size={15} stroke={2.2} />{t('yc.plan.c.ownerOnly')}
          </span>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '6px 18px', fontSize: 13, color: 'var(--sand-600)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="lock" size={13} stroke={2.2} />{t('yc.plan.c.trust1')}</span>
          <span>{t('yc.plan.c.trust2')}</span>
          <span>{t('yc.plan.c.trust3')}</span>
        </div>
      </div>
    </div>
  );
}

function Line({ l, v, strong, muted }: { l: string; v: string; strong?: boolean; muted?: boolean }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '2px 16px', padding: '13px 20px', fontSize: 14.5, borderTop: '1px solid var(--sand-100)', marginTop: -1 }}>
      <span style={{ color: 'var(--sand-600)' }}>{l}</span>
      <b style={{ fontWeight: strong ? 700 : 600, fontSize: strong ? 16 : 14.5, color: muted ? 'var(--sand-500)' : 'var(--ink)', fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{v}</b>
    </div>
  );
}
