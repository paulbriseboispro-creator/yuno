/**
 * Recharger mes Yunits (/crm/yunits) : le curseur de recharge (5 000 à
 * 300 000, bonus par palier), le solde (offerts / achetés, échéances), le
 * prochain envoi programmé et ce qu'il coûte, le coût de chaque canal,
 * l'historique des crédits, la recharge automatique (à venir) et la formule.
 *
 * Le devis vient de crmRechargeQuote (_shared/crm-billing.ts), le MÊME calcul
 * que le serveur, qui le refait de toute façon. Au retour de Stripe, l'écran
 * attend que le webhook ait crédité la session, puis fête la recharge.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { isDemoEmail } from '@/lib/demoPlan';
import { CRM_SMS_DISPLAY_LIVE } from '@/crm/lib/sms';
import { CRM_RECHARGE, crmRechargeFor, crmRechargeQuote } from '@/lib/crmBilling';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Portal, Skel } from '@/crm/ui/kit';
import { EASE, SPRING, useIntro } from '@/crm/ui/motion';
import { YunitFace } from '@/crm/ui/YunitFace';
import { useCrmToast } from '@/crm/ui/toast';
import { useCrmT } from '@/crm/i18n';
import { useCrmScope } from '@/crm/scope';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { useCrmWallet, type CrmWallet } from '@/crm/data/shell';
import { invokeCrmBilling, useCrmBilling, type CrmBilling } from '@/crm/data/account';
import { useFeatureWaitlist } from '@/crm/data/soon';

const LOW_VIEW = 5_000;
const card = { boxSizing: 'border-box', borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-sm)', padding: 'clamp(20px,2.4vw,32px)' } as const;
const mono = { fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' } as const;
const h2 = { margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em' } as const;
const clampV = (v: number) => Math.max(CRM_RECHARGE.min, Math.min(CRM_RECHARGE.max, Math.round(v / CRM_RECHARGE.step) * CRM_RECHARGE.step));

export default function YunitsPage() {
  const w = useCrmWallet();
  const b = useCrmBilling();
  if (!w.data || !b.data) {
    return (
      <main style={{ flex: 1, width: '100%', maxWidth: 1280, boxSizing: 'border-box', margin: '0 auto', padding: 'clamp(24px,3vw,36px) clamp(16px,3vw,40px) 72px', display: 'flex', flexDirection: 'column', gap: 28 }}>
        <Skel h={90} w={420} r={14} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }}>
          <Skel h={560} r={28} style={{ flex: '1 1 560px' }} />
          <Skel h={340} r={28} style={{ flex: '1 1 340px' }} />
        </div>
      </main>
    );
  }
  return <YunitsView w={w.data} b={b.data} refetchWallet={w.refetch} />;
}

function YunitsView({ w, b, refetchWallet }: { w: CrmWallet; b: CrmBilling; refetchWallet: () => Promise<unknown> }) {
  const { t, n: n0, eur2, locale } = useCrmT();
  // Un nombre ne se coupe jamais en fin de ligne (« 5 000 », pas « 5 / 000 »).
  const n = (x: number | null | undefined) => n0(x).replace(/ /g, '\u00a0');
  const { user } = useAuth();
  const { rpc: scopeArgs, qk } = useCrmScope();
  const toast = useCrmToast();
  const qc = useQueryClient();
  const intro = useIntro();
  const [params, setParams] = useSearchParams();
  const sliderRef = useRef<HTMLElement>(null);
  const demo = isDemoEmail(user?.email ?? '');
  const paused = b.effective_plan === 'paused';
  const canPay = b.can_manage && !demo && !paused;
  const vat = b.pricing.vat_rate;
  const smsLive = CRM_SMS_DISPLAY_LIVE && !!w.channels_live?.sms;
  const rate = (k: string, d: number) => Number(w.rates?.[k] ?? d) || d;
  const dFull = (d: string) => new Date(d).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  const dWhen = (d: string) => new Date(d).toLocaleString(locale, { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  // ── Recharge ──
  const [v, setV] = useState(50_000);
  const [busy, setBusy] = useState(false);
  const quote = crmRechargeQuote(v) ?? { base: v, bonusPct: 0, received: v, amountCents: Math.round((v / CRM_RECHARGE.perEuro) * 100) };
  const ht = quote.amountCents / 100;
  const ttc = Math.round(ht * (100 + vat)) / 100;
  const pay = useCallback(async (amount?: number) => {
    if (!canPay || busy) return;
    const base = amount ?? v;
    if (amount) setV(amount);
    setBusy(true);
    try {
      const r = await invokeCrmBilling<{ url?: string }>('crm_recharge', scopeArgs, { yunits: base });
      if (r.url) { window.location.assign(r.url); return; }
    } catch {
      toast(t('yc.yu.err'));
    }
    setBusy(false);
  }, [busy, canPay, scopeArgs, t, toast, v]);

  // ── Retour de Stripe : on attend le crédit de CETTE session, puis on fête. ──
  const session = params.get('recharge') === 'success' ? params.get('session') : null;
  const [waiting, setWaiting] = useState(!!session);
  const [cele, setCele] = useState<{ r: number; bonus: number; to: number } | null>(null);
  const [last, setLast] = useState<{ r: number; ttc: number | null } | null>(null);
  const credited = useMemo(() => (session ? (w.credits ?? []).find((c) => c.meta?.session_id === session) : null), [session, w.credits]);
  useEffect(() => {
    if (!session) return;
    if (credited) {
      const base = Number(credited.meta?.base ?? credited.delta);
      const amount = Number(credited.meta?.amount_total ?? NaN);
      setWaiting(false);
      setCele({ r: credited.delta, bonus: Math.max(0, credited.delta - base), to: w.balance });
      setLast({ r: credited.delta, ttc: Number.isFinite(amount) ? amount / 100 : null });
      void qc.invalidateQueries({ queryKey: ['crm', qk, 'shell'] });
      void qc.invalidateQueries({ queryKey: ['crm', qk, 'billing'] });
      const next = new URLSearchParams(params);
      next.delete('recharge'); next.delete('session');
      setParams(next, { replace: true });
      return;
    }
    let tries = 0;
    const id = window.setInterval(() => {
      tries += 1;
      void refetchWallet();
      if (tries >= 20) window.clearInterval(id);
    }, 1500);
    return () => window.clearInterval(id);
  }, [credited, params, qc, qk, refetchWallet, session, setParams, w.balance]);
  useEffect(() => {
    if (params.get('recharge') !== 'canceled') return;
    const next = new URLSearchParams(params);
    next.delete('recharge');
    setParams(next, { replace: true });
  }, [params, setParams]);

  // ── Solde ──
  const lots = w.lots ?? [];
  const offLots = lots.filter((l) => l.kind !== 'purchase');
  const buyLots = lots.filter((l) => l.kind === 'purchase');
  const off = offLots.reduce((s, l) => s + l.remaining, 0);
  const buy = buyLots.reduce((s, l) => s + l.remaining, 0);
  // Un lot qui s'éteint à minuit vaut jusqu'à la veille : on affiche le dernier jour utile.
  const minExp = (ls: typeof lots) => {
    const e = ls.map((l) => l.expires_at).filter(Boolean).sort()[0];
    return e ? new Date(new Date(e).getTime() - 1000).toISOString() : null;
  };
  const offExp = minExp(offLots);
  const buyExp = minExp(buyLots);
  const scale = Math.max(1, off + buy);
  const low = w.balance < LOW_VIEW && !paused;
  const mood = paused ? 'endormi' : cele ? 'ravi' : low ? 'inquiet' : 'content';
  const st = paused ? ['yc.yu.st.paused', 'var(--sand-100)', 'var(--sand-600)'] : low ? ['yc.yu.st.low', 'var(--amber-50)', 'var(--amber-700)'] : ['yc.yu.st.ok', 'var(--green-50)', 'var(--green-700)'];
  const eq = (y: number) => (smsLive ? t('yc.yu.eq', { mail: n(Math.floor(y / rate('email', 1))), sms: n(Math.floor(y / rate('sms', 35))) }) : t('yc.yu.eqMail', { mail: n(Math.floor(y / rate('email', 1))) }));

  // ── Prochain envoi ──
  const next = w.reserved?.[0] ?? null;
  const missing = next ? Math.max(0, next.cost - w.balance) : 0;
  const need = missing ? crmRechargeFor(missing) : 0;

  const pct = ((v - CRM_RECHARGE.min) / (CRM_RECHARGE.max - CRM_RECHARGE.min)) * 100;
  const goSlider = () => {
    const el = sliderRef.current;
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 88, behavior: 'smooth' });
  };
  const rv = (i: number) => ({ opacity: intro ? 1 : 0, transform: intro ? 'none' : 'translateY(18px)', filter: intro ? 'none' : 'blur(8px)', transition: `opacity 800ms ${EASE} ${i * 80}ms,transform 800ms ${EASE} ${i * 80}ms,filter 800ms ${EASE} ${i * 80}ms` });

  const payLabel = paused ? t('yc.yu.payPaused') : demo ? t('yc.yu.payDemo') : !b.can_manage ? t('yc.yu.payOwner') : busy ? t('yc.yu.redirect') : t('yc.yu.pay', { amount: eur2(ttc) });

  return (
    <main style={{ flex: 1, width: '100%', maxWidth: 1280, boxSizing: 'border-box', margin: '0 auto', padding: 'clamp(24px,3vw,36px) clamp(16px,3vw,40px) 72px', display: 'flex', flexDirection: 'column', gap: 28 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, animation: `yc-row 640ms ${EASE} both` }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t('yc.yu.kick')}</span>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(28px,3vw,36px)', lineHeight: 1.05, letterSpacing: '-.035em' }}>{t('yc.yu.title')}</h1>
        <p style={{ margin: 0, fontSize: 16, lineHeight: 1.45, fontWeight: 500, color: 'var(--sand-600)', textWrap: 'pretty' }}>{t('yc.yu.sub')}</p>
      </div>

      {paused && (
        <div role="alert" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 20px', padding: '16px 20px', borderRadius: 20, background: 'var(--red-50)', boxShadow: 'inset 0 0 0 1px var(--red-200)' }}>
          <div style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--red-800)' }}>{t('yc.yu.pause.t')}</span>
            <span style={{ fontSize: 14.5, lineHeight: 1.45, color: 'var(--red-700)' }}>{t('yc.yu.pause.s')}</span>
          </div>
          <Hv as={Link} to={CRM_ROUTES.accountSection('billing')} style={{ flex: 'none', height: 44, padding: '0 20px', borderRadius: 99, background: 'var(--ink)', color: '#fff', fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', textDecoration: 'none' }} hover={{ background: 'var(--sand-700)', color: '#fff', textDecoration: 'none' }}>
            {t('yc.yu.pause.cta', { price: n(b.pricing.price_month) })}
          </Hv>
        </div>
      )}
      {waiting && (
        <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', borderRadius: 20, background: 'var(--sand-50)', boxShadow: 'inset 0 0 0 1px var(--sand-200)', fontSize: 15, fontWeight: 600, color: 'var(--sand-700)' }}>
          <span style={{ width: 16, height: 16, borderRadius: 99, border: '2.4px solid var(--sand-200)', borderTopColor: 'var(--ink)', animation: 'yc-spin 700ms linear infinite' }} />{t('yc.yu.waiting')}
        </div>
      )}
      {last && (
        <div role="status" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px', padding: '16px 20px', borderRadius: 20, background: 'var(--green-50)', boxShadow: 'inset 0 0 0 1px rgba(23,163,74,.25)', color: 'var(--green-700)', fontSize: 15, fontWeight: 600, animation: `yc-rise 520ms ${EASE} both` }}>
          <span style={{ flex: '1 1 240px', display: 'flex', alignItems: 'center', gap: 10 }}><Icon name="check" size={18} stroke={3} />{t('yc.yu.last', { n: n(last.r) })}</span>
          {last.ttc !== null && <Link to={CRM_ROUTES.accountSection('billing')} style={{ fontWeight: 600, color: 'var(--green-700)', textDecoration: 'underline' }}>{t('yc.yu.lastInv', { amount: eur2(last.ttc) })}</Link>}
        </div>
      )}

      {/* Recharge + solde */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 24 }}>
        <section ref={sliderRef} style={{ ...card, flex: '1 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 24, ...rv(0) }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h2 style={h2}>{t('yc.yu.how.t')}</h2>
            <span style={{ fontSize: 13.5, color: 'var(--sand-500)' }}>{t('yc.yu.how.s', { step: n(CRM_RECHARGE.step), max: n(CRM_RECHARGE.max) })}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24, opacity: paused ? 0.45 : 1, pointerEvents: paused ? 'none' : 'auto' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '16px 24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(10px,1.6vw,16px)' }}>
                <StepBtn label={t('yc.yu.minus', { step: n(CRM_RECHARGE.step) })} icon="minus" onClick={() => setV((x) => clampV(x - CRM_RECHARGE.step))} />
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(40px,5vw,60px)', letterSpacing: '-.055em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{n(v)}</span>
                  <span style={{ fontSize: 16, fontWeight: 500, color: 'var(--sand-500)' }}>Yunits</span>
                </div>
                <StepBtn label={t('yc.yu.plus', { step: n(CRM_RECHARGE.step) })} icon="plus" onClick={() => setV((x) => clampV(x + CRM_RECHARGE.step))} />
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(30px,3.4vw,40px)', letterSpacing: '-.05em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{n(ht)}</span>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 20 }}>€</span>
                <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{t('yc.yu.ht')}</span>
              </div>
            </div>

            <Slider v={v} pct={pct} onChange={(x) => setV((cur) => clampV(typeof x === 'function' ? x(cur) : x))} label={t('yc.yu.slider')} valueText={`${n(v)} Yunits`} />

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {[{ min: 0, pct: 0 }, ...[...CRM_RECHARGE.tiers].reverse()].map((tier) => {
                const on = quote.bonusPct === tier.pct;
                return (
                  <span key={tier.pct} style={{ height: 32, padding: '0 14px', borderRadius: 99, border: `1.5px solid ${on ? 'var(--red-500)' : 'var(--sand-200)'}`, background: on ? 'var(--red-50)' : '#fff', color: on ? 'var(--red-700)' : 'var(--sand-600)', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', transition: 'all 200ms' }}>
                    {tier.pct === 0 ? t('yc.yu.tier0', { a: n(CRM_RECHARGE.tiers[CRM_RECHARGE.tiers.length - 1].min) }) : t('yc.yu.tier1', { a: n(tier.min), p: tier.pct })}
                  </span>
                );
              })}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', borderRadius: 20, background: 'var(--sand-50)', padding: '4px 20px', fontSize: 15 }}>
              <SumRow l={t('yc.yu.recv')} v={<>{t('yc.yu.recvVal', { n: n(quote.received) })}{quote.received > v && <span style={{ color: 'var(--red-700)' }}>{t('yc.yu.recvBonus', { n: n(quote.received - v) })}</span>}</>} strong first />
              <SumRow l={t('yc.yu.vat', { n: vat })} v={eur2(ttc - ht)} />
              <SumRow l={t('yc.yu.after')} v={t('yc.yu.recvVal', { n: n(w.balance + quote.received) })} strong />
              <SumRow l={t('yc.yu.total')} v={eur2(ttc)} total />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Hv
              as="button"
              type="button"
              onClick={() => void pay()}
              disabled={!canPay || busy}
              style={{ height: 56, borderRadius: 99, border: 0, background: !canPay ? 'var(--sand-200)' : busy ? 'var(--ink)' : 'var(--gradient-brand)', color: !canPay ? 'var(--sand-500)' : '#fff', fontWeight: 600, fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 9px 0 26px', cursor: !canPay ? 'not-allowed' : busy ? 'wait' : 'pointer', boxShadow: canPay && !busy ? 'var(--shadow-cta)' : 'none', transition: `transform 200ms ${SPRING},filter 160ms` }}
              hover={canPay ? { transform: 'translateY(-1px)', filter: 'brightness(1.05)' } : {}}
              active={canPay ? { transform: 'scale(.98)' } : {}}
            >
              <span>{payLabel}</span>
              <span style={{ width: 38, height: 38, borderRadius: 99, background: 'rgba(255,255,255,.22)', display: 'grid', placeItems: 'center' }}>
                {busy ? <span style={{ width: 16, height: 16, borderRadius: 99, border: '2.4px solid rgba(255,255,255,.35)', borderTopColor: '#fff', animation: 'yc-spin 700ms linear infinite' }} /> : <Icon name={canPay ? 'arrowRight' : 'lock'} size={18} stroke={2.4} />}
              </span>
            </Hv>
            <span style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--sand-500)', textAlign: 'center' }}>{t('yc.yu.payNote')}</span>
          </div>
        </section>

        <div style={{ flex: '1 1 340px', maxWidth: '100%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 24 }}>
          <section style={{ ...card, display: 'flex', flexDirection: 'column', gap: 18, background: 'radial-gradient(60% 50% at 100% 0%,rgba(255,107,53,.07),transparent 70%),#fff', ...rv(1) }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <span style={mono}>{t('yc.yu.bal')}</span>
              <span style={{ height: 28, padding: '0 12px', borderRadius: 99, background: st[1], color: st[2], fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7 }}><span style={{ width: 7, height: 7, borderRadius: 99, background: 'currentColor' }} />{t(st[0])}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <YunitFace mood={mood} size={56} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(44px,5vw,60px)', letterSpacing: '-.055em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{n(w.balance)}</span>
                  <span style={{ fontSize: 16, color: 'var(--sand-500)' }}>Yunits</span>
                </div>
                <span style={{ fontSize: 13.5, color: 'var(--sand-600)' }}>{eq(w.balance)}</span>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', height: 8, borderRadius: 8, background: 'var(--sand-200)', overflow: 'hidden', gap: 2 }}>
                <div style={{ height: '100%', background: 'var(--ink)', width: `${Math.min(100, (off / scale) * 100)}%`, transition: `width 900ms ${EASE}` }} />
                <div style={{ height: '100%', background: 'var(--gradient-brand)', width: `${Math.min(100, (buy / scale) * 100)}%`, transition: `width 900ms ${EASE}` }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14 }}>
                <Legend dot="var(--ink)" l={t('yc.yu.off', { n: n(off) })} r={offExp ? t('yc.yu.offExp', { date: dFull(offExp) }) : ''} />
                <Legend dot="var(--red-500)" l={t('yc.yu.buy', { n: n(buy) })} r={buyExp ? t('yc.yu.buyExp', { date: dFull(buyExp) }) : t('yc.yu.buyNone')} />
              </div>
            </div>
          </section>

          {next && (
            <section style={{ boxSizing: 'border-box', borderRadius: 24, padding: '20px 22px', background: missing ? 'var(--amber-50)' : 'var(--green-50)', boxShadow: `inset 0 0 0 1px ${missing ? 'rgba(229,154,11,.35)' : 'rgba(23,163,74,.25)'}`, display: 'flex', flexDirection: 'column', gap: 10, ...rv(2) }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '4px 12px' }}>
                <span style={mono}>{t('yc.yu.next')}</span>
                <span style={{ fontSize: 13, color: 'var(--sand-600)' }}>{t('yc.yu.nextWhen', { date: dWhen(next.at) })}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 20, letterSpacing: '-.02em' }}>{next.name}</span>
                <span style={{ fontSize: 14, color: 'var(--sand-700)' }}>
                  {next.channel === 'sms' ? t('yc.yu.nextSms', { n: n(Math.round(next.cost / rate('sms', 35))) }) : t('yc.yu.nextMail', { n: n(Math.round(next.cost / rate('email', 1))) })} · <strong style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{t('yc.yu.nextCost', { n: n(next.cost) })}</strong>
                </span>
              </div>
              {missing > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 12, borderTop: '1px solid rgba(154,99,0,.2)' }}>
                  <span style={{ fontSize: 14.5, lineHeight: 1.45, color: 'var(--amber-700)' }}>
                    <strong style={{ fontWeight: 600 }}>{t('yc.yu.short', { n: n(missing) })}</strong>{' '}
                    {t('yc.yu.advice', { n: n(need), ht: n(need / CRM_RECHARGE.perEuro), rest: n(w.balance + (crmRechargeQuote(need)?.received ?? need) - next.cost) })}
                  </span>
                  {canPay ? (
                    <Hv as="button" type="button" onClick={() => void pay(need)} style={{ height: 44, padding: '0 20px', borderRadius: 99, border: 0, background: 'var(--ink)', color: '#fff', fontSize: 14.5, fontWeight: 600, cursor: 'pointer', transition: 'background 160ms' }} hover={{ background: 'var(--sand-700)' }} active={{ transform: 'scale(.97)' }}>
                      {t('yc.yu.adviceCta', { n: n(need) })}
                    </Hv>
                  ) : (
                    <Hv as="button" type="button" onClick={() => { setV(need); goSlider(); }} style={{ height: 44, padding: '0 20px', borderRadius: 99, border: '1px solid rgba(154,99,0,.3)', background: '#fff', color: 'var(--amber-700)', fontSize: 14.5, fontWeight: 600, cursor: 'pointer' }} hover={{ background: 'var(--paper)' }}>
                      {t('yc.yu.recvVal', { n: n(need) })}
                    </Hv>
                  )}
                </div>
              ) : (
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14.5, fontWeight: 600, color: 'var(--green-700)' }}><Icon name="check" size={16} stroke={2.8} />{t('yc.yu.covered', { n: n(w.balance - next.cost) })}</span>
              )}
            </section>
          )}
        </div>
      </div>

      {/* Coût par envoi */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 16, ...rv(3) }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h2 style={h2}>{t('yc.yu.cost.t')}</h2>
          <span style={{ fontSize: 13.5, color: 'var(--sand-500)' }}>{t('yc.yu.cost.s', { n: n(quote.received) })}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,210px),1fr))', gap: 12 }}>
          <CostCard label={t('yc.yu.c.email')} rate={rate('email', 1)} count={quote.received} unit={t('yc.yu.c.emails')} live />
          <CostCard label={t('yc.yu.c.sms')} rate={rate('sms', 35)} count={quote.received} unit={t('yc.yu.c.smss')} live={smsLive} />
          <CostCard label={t('yc.yu.c.ig')} rate={rate('instagram', 10)} count={quote.received} unit={t('yc.yu.c.igs')} live={false} />
          <CostCard label={t('yc.yu.c.wa')} rate={rate('whatsapp', 100)} count={quote.received} unit={t('yc.yu.c.was')} live={false} />
        </div>
        <div style={{ borderRadius: 20, background: 'var(--green-50)', padding: '14px 20px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px' }}>
          <span style={{ height: 28, padding: '0 12px', borderRadius: 99, background: '#fff', color: 'var(--green-700)', fontSize: 13.5, fontWeight: 600, display: 'flex', alignItems: 'center' }}>{t('yc.yu.free')}</span>
          <span style={{ flex: '1 1 280px', fontSize: 14.5, lineHeight: 1.5, color: 'var(--green-700)', fontWeight: 500 }}>{t('yc.yu.freeS')}</span>
        </div>
      </section>

      {/* Historique + réglages */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 24 }}>
        <History credits={w.credits ?? []} fresh={last ? session ?? 'x' : null} dFull={dFull} />
        <div style={{ flex: '1 1 340px', maxWidth: '100%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 24 }}>
          <AutoRecharge />
          <SubscriptionCard b={b} dFull={dFull} />
        </div>
      </div>

      {busy && (
        <Portal>
          <div style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(255,255,255,.94)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, textAlign: 'center', padding: 24, animation: 'yc-fade 240ms both' }}>
            <span style={{ width: 40, height: 40, borderRadius: 99, border: '3px solid var(--red-100)', borderTopColor: 'var(--red-500)', animation: 'yc-spin 800ms linear infinite' }} />
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 32, letterSpacing: '-.04em' }}>{t('yc.yu.redirect')}</span>
            <span style={{ fontSize: 16, color: 'var(--sand-600)' }}>{t('yc.yu.recvVal', { n: n(quote.received) })} · {eur2(ttc)}</span>
          </div>
        </Portal>
      )}
      {cele && <Celebration c={cele} line2={smsLive ? t('yc.yu.ce.sub2', { mail: n(Math.floor(cele.to / rate('email', 1))), sms: n(Math.floor(cele.to / rate('sms', 35))) }) : t('yc.yu.ce.sub2Mail', { mail: n(Math.floor(cele.to / rate('email', 1))) })} onDone={() => setCele(null)} />}
    </main>
  );
}

function StepBtn({ label, icon, onClick }: { label: string; icon: 'minus' | 'plus'; onClick: () => void }) {
  return (
    <Hv as="button" type="button" aria-label={label} onClick={onClick} style={{ flex: 'none', width: 44, height: 44, borderRadius: 99, border: '1px solid var(--sand-200)', background: '#fff', color: 'var(--ink)', cursor: 'pointer', display: 'grid', placeItems: 'center', transition: 'all 160ms' }} hover={{ background: 'var(--sand-50)', borderColor: 'var(--sand-300)' }} active={{ transform: 'scale(.94)' }}>
      <Icon name={icon} size={18} stroke={2.4} />
    </Hv>
  );
}

function Slider({ v, pct, onChange, label, valueText }: { v: number; pct: number; onChange: (v: number | ((cur: number) => number)) => void; label: string; valueText: string }) {
  const { n } = useCrmT();
  const track = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);
  const span = CRM_RECHARGE.max - CRM_RECHARGE.min;
  const fromX = (x: number) => {
    const el = track.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (x - r.left) / r.width));
    onChange(CRM_RECHARGE.min + f * span);
  };
  const down = (e: ReactPointerEvent<HTMLDivElement>) => { e.currentTarget.setPointerCapture?.(e.pointerId); setDrag(true); fromX(e.clientX); e.currentTarget.focus(); };
  const key = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const s = CRM_RECHARGE.step;
    const map: Record<string, (cur: number) => number> = {
      ArrowRight: (c) => c + s, ArrowUp: (c) => c + s, ArrowLeft: (c) => c - s, ArrowDown: (c) => c - s,
      PageUp: (c) => c + 10 * s, PageDown: (c) => c - 10 * s, Home: () => CRM_RECHARGE.min, End: () => CRM_RECHARGE.max,
    };
    if (e.key in map) { e.preventDefault(); onChange(map[e.key]); }
  };
  const ticks = CRM_RECHARGE.tiers.map((tier) => ((tier.min - CRM_RECHARGE.min) / span) * 100);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={CRM_RECHARGE.min}
        aria-valuemax={CRM_RECHARGE.max}
        aria-valuenow={v}
        aria-valuetext={valueText}
        onPointerDown={down}
        onPointerMove={(e) => { if (drag) fromX(e.clientX); }}
        onPointerUp={() => setDrag(false)}
        onPointerCancel={() => setDrag(false)}
        onKeyDown={key}
        style={{ height: 44, padding: '0 16px', touchAction: 'none', cursor: drag ? 'grabbing' : 'grab', display: 'flex', alignItems: 'center', outline: 'none' }}
      >
        <div ref={track} style={{ position: 'relative', width: '100%', height: 10, borderRadius: 10, background: 'var(--sand-200)' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 10, background: 'var(--gradient-brand)', width: `${pct}%` }} />
          {ticks.map((x) => <span key={x} style={{ position: 'absolute', top: '50%', left: `${x}%`, width: 6, height: 6, margin: '-3px 0 0 -3px', borderRadius: 99, background: pct >= x ? '#fff' : 'var(--sand-400)' }} />)}
          <span style={{ position: 'absolute', top: '50%', left: `${pct}%`, width: 30, height: 30, margin: '-15px 0 0 -15px', borderRadius: 99, background: '#fff', border: '3px solid var(--red-500)', boxShadow: drag ? '0 0 0 6px var(--red-100),0 4px 12px rgba(28,21,23,.2)' : '0 2px 8px rgba(28,21,23,.2)', boxSizing: 'border-box', transition: 'box-shadow 160ms' }} />
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 4px', fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '.04em', color: 'var(--sand-500)' }}>
        <span>{n(CRM_RECHARGE.min)}</span><span>{n(CRM_RECHARGE.max)}</span>
      </div>
    </div>
  );
}

function SumRow({ l, v, strong, first, total }: { l: string; v: ReactNode; strong?: boolean; first?: boolean; total?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: total ? '14px 0' : '12px 0', borderTop: first ? 0 : '1px solid var(--sand-200)', fontWeight: total ? 600 : undefined, fontSize: total ? 17 : undefined }}>
      <span style={{ color: total ? 'var(--ink)' : 'var(--sand-600)' }}>{l}</span>
      <span style={{ fontWeight: strong || total ? 600 : 400, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{v}</span>
    </div>
  );
}

function Legend({ dot, l, r }: { dot: string; l: string; r: string }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: '2px 12px' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}><span style={{ width: 8, height: 8, borderRadius: 99, background: dot }} />{l}</span>
      <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{r}</span>
    </div>
  );
}

function CostCard({ label, rate, count, unit, live }: { label: string; rate: number; count: number; unit: string; live: boolean }) {
  const { t, tp, n } = useCrmT();
  return (
    <div style={{ borderRadius: 24, background: live ? '#fff' : 'var(--sand-50)', boxShadow: live ? 'inset 0 0 0 1px var(--sand-200),var(--shadow-xs)' : 'inset 0 0 0 1px var(--sand-200)', padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
        <span style={mono}>{label}</span>
        <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
          {!live && <span style={{ height: 28, padding: '0 10px', borderRadius: 99, background: 'var(--amber-50)', color: 'var(--amber-700)', fontSize: 12.5, fontWeight: 600, display: 'flex', alignItems: 'center' }}>{t('yc.yu.soon')}</span>}
          <span style={{ height: 28, padding: '0 12px', borderRadius: 99, background: live ? 'var(--sand-100)' : '#fff', fontSize: 13.5, fontWeight: 600, display: 'flex', alignItems: 'center' }}>{tp('yc.yu.c.rate', rate)}</span>
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 32, letterSpacing: '-.05em', lineHeight: 1, fontVariantNumeric: 'tabular-nums', color: live ? 'var(--ink)' : 'var(--sand-600)' }}>{n(Math.floor(count / rate))}</span>
        <span style={{ fontSize: 15, color: 'var(--sand-600)' }}>{unit}</span>
      </div>
    </div>
  );
}

function History({ credits, fresh, dFull }: { credits: NonNullable<CrmWallet['credits']>; fresh: string | null; dFull: (d: string) => string }) {
  const { t, n, eur2 } = useCrmT();
  return (
    <section style={{ ...card, flex: '1 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <h2 style={{ ...h2, marginBottom: 10 }}>{t('yc.yu.hist')}</h2>
      {credits.length === 0 && <span style={{ padding: '14px 0', borderTop: '1px solid var(--sand-100)', fontSize: 14.5, color: 'var(--sand-500)' }}>{t('yc.yu.h.none')}</span>}
      {credits.map((c, i) => {
        const purchase = c.lot_kind === 'purchase';
        const base = Number(c.meta?.base ?? c.delta);
        const bonus = purchase ? Math.max(0, c.delta - base) : 0;
        const amount = Number(c.meta?.amount_total ?? NaN);
        const isFresh = !!fresh && i === 0 && purchase;
        const title = purchase ? t('yc.yu.h.purchase', { n: n(base) }) : t(`yc.yu.h.${c.lot_kind ?? 'grant'}`);
        return (
          <div key={`${c.at}-${i}`} style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '6px 16px', alignItems: 'center', padding: '14px 0', borderTop: '1px solid var(--sand-100)', background: isFresh ? 'var(--green-50)' : 'transparent', transition: 'background 1.5s', animation: `yc-rise 520ms ${EASE} ${Math.min(i, 8) * 50}ms both` }}>
            <div style={{ flex: '1 1 200px', display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>{title}</span>
              <span style={{ fontSize: 13, color: 'var(--sand-500)' }}>{dFull(c.at)}{bonus ? t('yc.yu.h.bonus', { n: n(bonus) }) : ''}</span>
            </div>
            <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 14, marginLeft: 'auto' }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: purchase ? 'var(--green-700)' : 'var(--sand-600)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>+ {n(c.delta)}</span>
              <span style={{ fontSize: 14, color: 'var(--sand-600)', minWidth: 72, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{purchase && Number.isFinite(amount) ? eur2(amount / 100) : t('yc.yu.h.included')}</span>
              {purchase
                ? <Link to={CRM_ROUTES.accountSection('billing')} style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>{t('yc.yu.h.invoice')}</Link>
                : <span style={{ width: 52 }} />}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function AutoRecharge() {
  const { t } = useCrmT();
  const wl = useFeatureWaitlist();
  const on = wl.features.includes('auto_recharge');
  return (
    <section style={{ ...card, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h2 style={{ ...h2, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {t('yc.yu.ar.t')}
            <span style={{ height: 24, padding: '0 10px', borderRadius: 99, background: 'var(--amber-50)', color: 'var(--amber-700)', fontFamily: 'var(--font-body, inherit)', fontSize: 12.5, fontWeight: 600, letterSpacing: 0, display: 'inline-flex', alignItems: 'center' }}>{t('yc.yu.soon')}</span>
          </h2>
          <span style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--sand-600)', textWrap: 'pretty' }}>{t('yc.yu.ar.s')}</span>
        </div>
        <span aria-hidden style={{ flex: 'none', position: 'relative', width: 48, height: 28, borderRadius: 99, background: 'var(--sand-200)', opacity: 0.6 }}>
          <span style={{ position: 'absolute', top: 3, left: 3, width: 22, height: 22, borderRadius: 99, background: '#fff', boxShadow: '0 2px 6px rgba(28,21,23,.25)' }} />
        </span>
      </div>
      <div>
        <Hv
          as="button"
          type="button"
          onClick={() => void wl.set({ feature: 'auto_recharge', on: !on })}
          disabled={wl.pending || !wl.loaded}
          style={{ height: 42, padding: '0 18px', borderRadius: 99, border: on ? 0 : '1px solid var(--sand-200)', background: on ? 'var(--green-50)' : '#fff', color: on ? 'var(--green-700)' : 'var(--ink)', fontSize: 14.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', transition: `transform 200ms ${SPRING},background 200ms` }}
          hover={{ background: on ? 'var(--green-50)' : 'var(--paper)' }}
          active={{ transform: 'scale(.97)' }}
        >
          <Icon name={on ? 'check' : 'bell'} size={16} stroke={2.4} />{t(on ? 'yc.yu.ar.notified' : 'yc.yu.ar.notify')}
        </Hv>
      </div>
    </section>
  );
}

function SubscriptionCard({ b, dFull }: { b: CrmBilling; dFull: (d: string) => string }) {
  const { t, n } = useCrmT();
  const s = b.subscription;
  const annual = s?.interval === 'year';
  const trial = s?.status === 'trialing' && !!s.trial_ends_at;
  const paused = b.effective_plan === 'paused';
  const title = paused ? t('yc.yu.sub.paused') : trial ? t('yc.yu.sub.trial', { date: dFull(s?.trial_ends_at as string) }) : annual ? t('yc.yu.sub.year', { price: n(b.pricing.price_year) }) : t('yc.yu.sub.month', { price: n(b.pricing.price_month) });
  return (
    <section style={{ boxSizing: 'border-box', borderRadius: 24, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-xs)', padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={mono}>{t('yc.yu.sub.t')}</span>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 20, letterSpacing: '-.02em' }}>{title}</span>
        <span style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--sand-600)' }}>
          {annual ? t('yc.yu.sub.yearNote', { b: n(b.pricing.annual_bonus_yunits) }) : t('yc.yu.sub.launch')}
          {s?.has_stripe && s.current_period_end && !paused ? ` ${t('yc.yu.sub.next', { date: dFull(s.current_period_end) })}` : ''}
        </span>
      </div>
      {!annual && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '14px 16px', borderRadius: 16, background: 'var(--sand-50)' }}>
          <span style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.35 }}>
            {t('yc.yu.promo.t')}<span style={{ background: 'var(--gradient-brand)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>{t('yc.yu.promo.b', { b: n(b.pricing.annual_bonus_yunits) })}</span>
          </span>
          <span style={{ fontSize: 13, color: 'var(--sand-600)', lineHeight: 1.45 }}>{t('yc.yu.promo.s', { price: n(b.pricing.price_year) })}</span>
          <Hv as={Link} to={CRM_ROUTES.accountSection('billing')} style={{ alignSelf: 'flex-start', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none' }} hover={{ textDecoration: 'none' }}>
            {s?.has_stripe ? t('yc.yu.promo.cta') : t('yc.yu.subscribe')}<Icon name="arrowRight" size={15} stroke={2.4} />
          </Hv>
        </div>
      )}
    </section>
  );
}

/** Plein écran de nuit : le jeton, le compte qui monte, les jetons qui volent. */
function Celebration({ c, line2, onDone }: { c: { r: number; bonus: number; to: number }; line2: string; onDone: () => void }) {
  const { t, n } = useCrmT();
  const root = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(0);
  const [phase, setPhase] = useState<'in' | 'out'>('in');
  const reduce = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  // Le parent se redessine (portefeuille, en-tête) : la fin ne dépend que de la recharge.
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const close = useCallback(() => { setShown(c.r); setPhase('out'); window.setTimeout(() => doneRef.current(), 600); }, [c.r]);

  useEffect(() => {
    if (reduce) { setShown(c.r); const id = window.setTimeout(close, 2500); return () => window.clearTimeout(id); }
    const t0 = performance.now() + 500;
    let raf = 0;
    const tick = () => {
      const p = Math.max(0, Math.min(1, (performance.now() - t0) / 1700));
      setShown(Math.round(c.r * (1 - Math.pow(1 - p, 4))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const burst = (count: number) => {
      const box = root.current;
      if (!box) return;
      const r = box.getBoundingClientRect();
      for (let i = 0; i < count; i++) {
        const img = document.createElement('img');
        img.src = '/crm/yunit-token.webp';
        img.alt = '';
        const size = 34 + Math.random() * 30;
        Object.assign(img.style, { position: 'absolute', left: `${r.width / 2}px`, top: `${r.height * 0.46}px`, width: `${size}px`, height: `${size}px`, margin: `${-size / 2}px 0 0 ${-size / 2}px`, pointerEvents: 'none' });
        box.appendChild(img);
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.6;
        const d = 140 + Math.random() * 260;
        const an = img.animate([
          { transform: 'translate(0,0) scale(.4) rotate(0deg)', opacity: 1 },
          { transform: `translate(${Math.cos(a) * d}px,${Math.sin(a) * d}px) scale(1) rotate(${(Math.random() - 0.5) * 360}deg)`, opacity: 1, offset: 0.55 },
          { transform: `translate(${Math.cos(a) * d * 1.1}px,${Math.sin(a) * d + 120}px) scale(.7) rotate(${(Math.random() - 0.5) * 540}deg)`, opacity: 0 },
        ], { duration: 1100 + Math.random() * 600, easing: 'cubic-bezier(.2,.7,.3,1)', delay: Math.random() * 140 });
        an.onfinish = () => img.remove();
      }
    };
    const b1 = window.setTimeout(() => burst(30), 500);
    const b2 = window.setTimeout(() => burst(40), 2250);
    const end = window.setTimeout(close, 5600);
    return () => { cancelAnimationFrame(raf); window.clearTimeout(b1); window.clearTimeout(b2); window.clearTimeout(end); };
  }, [c.r, close, reduce]);

  return (
    <Portal>
      <div
        ref={root}
        onClick={close}
        role="status"
        aria-live="polite"
        style={{ position: 'fixed', inset: 0, zIndex: 130, boxSizing: 'border-box', overflow: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', color: 'var(--text-on-night)', cursor: 'pointer', opacity: phase === 'out' ? 0 : 1, transition: 'opacity 600ms ease', animation: 'yc-fade 350ms ease-out both', background: 'radial-gradient(60% 50% at 50% 58%,rgba(227,20,27,.5),transparent 72%),radial-gradient(40% 40% at 92% 0%,rgba(255,107,53,.28),transparent 70%),var(--noise-night),var(--night)' }}
      >
        <div aria-hidden style={{ position: 'absolute', left: '50%', top: '46%', width: '230vmax', height: '230vmax', margin: '-115vmax 0 0 -115vmax', background: 'repeating-conic-gradient(from 0deg,rgba(255,138,76,.16) 0deg 9deg,transparent 9deg 18deg)', WebkitMaskImage: 'radial-gradient(closest-side,#000 0%,transparent 60%)', maskImage: 'radial-gradient(closest-side,#000 0%,transparent 60%)', pointerEvents: 'none', animation: reduce ? undefined : 'yc-rays 40s linear infinite' }} />
        <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'clamp(10px,2vh,20px)' }}>
          <div style={{ animation: `yc-ce-face 900ms ${EASE} 150ms both` }}><YunitFace mood="ravi" size={124} /></div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, letterSpacing: '.14em', textTransform: 'uppercase', color: '#FFB27A', animation: `yc-row 600ms ${EASE} 350ms both` }}>{t('yc.yu.ce.lab')}</span>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', flexWrap: 'wrap', gap: '0 clamp(10px,2vw,24px)', animation: `yc-ce-num 900ms ${EASE} 450ms both` }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(72px,17vw,240px)', lineHeight: 1, letterSpacing: '-.06em', fontVariantNumeric: 'tabular-nums', color: '#fff', textShadow: '0 0 60px rgba(255,107,53,.55)' }}>+ {n(shown)}</span>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(24px,4vw,52px)', letterSpacing: '-.03em', color: '#FF8A4C' }}>Yunits</span>
          </div>
          {c.bonus > 0 && (
            <span style={{ height: 44, padding: '0 20px', borderRadius: 99, background: 'var(--gradient-brand)', color: '#fff', fontSize: 17, fontWeight: 600, display: 'flex', alignItems: 'center', boxShadow: 'var(--shadow-cta)', animation: `yc-ce-pop 650ms ${SPRING} 2250ms both` }}>{t('yc.yu.ce.bonus', { n: n(c.bonus) })}</span>
          )}
          <span style={{ fontSize: 'clamp(16px,1.8vw,20px)', lineHeight: 1.45, color: 'var(--text-on-night-2)', animation: `yc-rise 700ms ${EASE} 2500ms both` }}>
            {t('yc.yu.ce.sub', { to: n(c.to) })}<br />{line2}
          </span>
        </div>
        <span style={{ position: 'absolute', bottom: 28, left: 0, right: 0, fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,.4)', animation: `yc-rise 700ms ${EASE} 2500ms both` }}>{t('yc.yu.ce.tap')}</span>
      </div>
    </Portal>
  );
}
