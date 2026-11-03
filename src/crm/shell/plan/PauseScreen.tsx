/**
 * La Console en pause (maquettes E et F, 03/11) : affichée À LA PLACE de la
 * page quand le compte n'a plus d'abonnement, sauf sur les pages qui restent
 * ouvertes (`openWhilePaused` : la base reste lisible et exportable, comme le
 * promettent les Conditions Yuno CRM). Le titulaire voit ce qu'il a construit,
 * ce qui attend, et réactive en un clic ; un membre prévient le titulaire.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Skel } from '@/crm/ui/kit';
import { EASE, SPRING } from '@/crm/ui/motion';
import { useCrmToast } from '@/crm/ui/toast';
import { useCrmT } from '@/crm/i18n';
import { useCrmScope } from '@/crm/scope';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { rpc } from '@/crm/lib/rpc';
import { downloadCsv } from '@/crm/lib/csv';
import { useBillingAction } from '@/crm/data/account';
import { annualFreeMonths } from '@/crm/lib/plan';
import { usePauseSummary, usePlan, usePriceLabel, type PauseSummary } from './usePlan';

type Interval = 'month' | 'year';

export function PauseScreen() {
  const plan = usePlan();
  const summary = usePauseSummary(true);
  if (!plan.billing || summary.isLoading) {
    return (
      <div style={{ padding: 32, display: 'flex', justifyContent: 'center' }}>
        <Skel h={560} r={28} style={{ width: '100%', maxWidth: 820 }} />
      </div>
    );
  }
  return plan.holder ? <HolderPause s={summary.data ?? null} /> : <MemberPause s={summary.data ?? null} />;
}

const mono = { fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase' as const, color: 'var(--sand-500)' };
const frame = { width: '100%', maxWidth: 820, boxSizing: 'border-box' as const, borderRadius: 28, background: '#fff', boxShadow: 'var(--shadow-md)', padding: 'clamp(22px,4vw,36px)', display: 'flex', flexDirection: 'column' as const, gap: 24, animation: `yc-rise 600ms ${EASE} both` };

function useKicker(s: PauseSummary | null) {
  const { t, dShort } = useCrmT();
  if (!s || s.reason === 'none' || !s.since) return t('yc.plan.p.k.none');
  return t(`yc.plan.p.k.${s.reason}`, { date: dShort(s.since) });
}

function HolderPause({ s }: { s: PauseSummary | null }) {
  const { t, tp, n, dShort, lang } = useCrmT();
  const toast = useCrmToast();
  const { rpc: args } = useCrmScope();
  const plan = usePlan();
  const price = usePriceLabel();
  const act = useBillingAction();
  const [sel, setSel] = useState<Interval>('month');
  const [busy, setBusy] = useState<string | null>(null);
  const kicker = useKicker(s);
  const b = plan.billing!;
  const free = annualFreeMonths(b.pricing.price_month, b.pricing.price_year);

  const checkout = async () => {
    if (busy) return;
    setBusy('checkout');
    try {
      const r = await act.mutateAsync({ action: 'crm_checkout', extra: { interval: sel, lang } });
      if (r.url) { window.location.assign(r.url); return; }
    } catch (e) {
      const code = e instanceof Error ? e.message : '';
      toast(t(code === 'billing_not_configured' ? 'yc.acc.b.errConfig' : code === 'support_session_forbidden' ? 'yc.acc.b.errSupport' : 'yc.acc.b.err'));
    }
    setBusy(null);
  };

  const exportBase = async () => {
    if (busy) return;
    setBusy('export');
    try {
      const r = await rpc<{ columns: string[]; rows: unknown[][] }>('crm_clients_export', { ...args, p_def: {}, p_emails: null });
      downloadCsv(`yuno-clients-${new Date().toISOString().slice(0, 10)}.csv`, r.columns, r.rows);
      toast(t('yc.plan.p.exported', { n: n(r.rows.length) }));
    } catch {
      toast(t('yc.plan.p.exportFailed'));
    }
    setBusy(null);
  };

  const stats = s ? [
    { v: s.contacts, k: 'yc.plan.p.contacts' },
    { v: s.nights, k: 'yc.plan.p.nights' },
    { v: s.emails_sent, k: 'yc.plan.p.emails' },
    { v: s.automations, k: 'yc.plan.p.autos' },
  ].filter((x) => x.v > 0) : [];

  const waiting: string[] = [];
  if (s?.sync_provider) waiting.push(t('yc.plan.p.w.sync', { provider: s.sync_provider === 'shotgun' ? 'Shotgun' : s.sync_provider }));
  if (s && s.automations > 0) waiting.push(tp('yc.plan.p.w.autos', s.automations, { n: n(s.automations) }));
  waiting.push(t('yc.plan.p.w.sends'));
  if (s && s.yunits_balance > 0) waiting.push(t('yc.plan.p.w.yunits', { n: n(s.yunits_balance) }));

  const option = (k: Interval) => ({
    textAlign: 'left' as const, border: 0, padding: '16px 18px', borderRadius: 20, background: '#fff', fontFamily: 'inherit', color: 'inherit', cursor: 'pointer',
    display: 'flex', flexDirection: 'column' as const, gap: 4,
    boxShadow: sel === k ? 'inset 0 0 0 2px var(--red-500)' : 'inset 0 0 0 1px var(--sand-200)',
  });

  return (
    <div style={{ padding: 'clamp(20px,4vw,40px) clamp(16px,3vw,32px)', display: 'flex', justifyContent: 'center' }}>
      <section style={frame}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ alignSelf: 'flex-start', height: 26, padding: '0 10px', borderRadius: 99, background: 'var(--red-50)', color: 'var(--red-700)', ...mono, fontSize: 11, display: 'inline-flex', alignItems: 'center' }}>{kicker}</span>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(32px,5vw,46px)', letterSpacing: '-.045em', lineHeight: 1 }}>{t('yc.plan.p.title')}</h1>
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: 'var(--sand-600)' }}>{t('yc.plan.p.sub')}</p>
        </div>

        {stats.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={mono}>{t('yc.plan.p.built')}</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,150px),1fr))', gap: 10 }}>
              {stats.map((x) => (
                <div key={x.k} style={{ padding: 16, borderRadius: 18, background: 'var(--sand-50)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 600, letterSpacing: '-.04em', fontVariantNumeric: 'tabular-nums' }}>{n(x.v)}</span>
                  <span style={{ fontSize: 13, color: 'var(--sand-600)' }}>{t(x.k)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '16px 18px', borderRadius: 18, background: 'var(--amber-50)' }}>
          <span style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--amber-700)' }}>
            {s?.since ? t('yc.plan.p.waiting', { date: dShort(s.since) }) : t('yc.plan.p.waitingNoDate')}
          </span>
          <span style={{ fontSize: 14, lineHeight: 1.5, color: '#7A4F00' }}>{waiting.join(' · ')}</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,240px),1fr))', gap: 12 }}>
          <Hv as="button" type="button" aria-pressed={sel === 'month'} onClick={() => setSel('month')} style={option('month')} hover={{ transform: 'translateY(-1px)' }}>
            <span style={{ fontSize: 14.5, fontWeight: 600 }}>{t('yc.plan.c.month')}</span>
            <span style={{ fontSize: 14, color: 'var(--sand-600)' }}>{t('yc.plan.p.optMonth', { price: price(b.pricing.price_month, 'month', plan.vat), n: n(b.pricing.monthly_yunits) })}</span>
          </Hv>
          <Hv as="button" type="button" aria-pressed={sel === 'year'} onClick={() => setSel('year')} style={option('year')} hover={{ transform: 'translateY(-1px)' }}>
            <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 14.5, fontWeight: 600 }}>
              {t('yc.plan.c.year')}
              {free > 0 && <span style={{ height: 22, padding: '0 9px', borderRadius: 99, background: 'var(--red-50)', color: 'var(--red-700)', fontSize: 11.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>{tp('yc.plan.c.yearBadge', free)}</span>}
            </span>
            <span style={{ fontSize: 14, color: 'var(--sand-600)' }}>{t('yc.plan.p.optMonth', { price: price(b.pricing.price_year, 'year', plan.vat), n: n(b.pricing.monthly_yunits) })}</span>
          </Hv>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Hv
            as="button" type="button" onClick={() => void checkout()} disabled={!!busy}
            style={{ height: 54, border: 0, borderRadius: 99, background: 'var(--gradient-brand)', color: '#fff', fontSize: 16, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, cursor: busy ? 'wait' : 'pointer', boxShadow: 'var(--shadow-cta)', transition: `transform 200ms ${SPRING},filter 160ms` }}
            hover={{ filter: 'brightness(1.05)', transform: 'translateY(-1px)' }} active={{ transform: 'scale(.98)' }}
          >
            {busy === 'checkout' ? t('yc.plan.c.redirect') : t('yc.plan.p.cta', { price: price(sel === 'year' ? b.pricing.price_year : b.pricing.price_month, sel, plan.vat) })}
          </Hv>
          <span style={{ textAlign: 'center', fontSize: 13, color: 'var(--sand-600)' }}>{t('yc.plan.p.ctaSub')}</span>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '4px 22px', paddingTop: 6, borderTop: '1px solid var(--sand-100)' }}>
          <SoftLink to={CRM_ROUTES.clients} icon="users" label={t('yc.plan.p.clients')} />
          <Hv as="button" type="button" onClick={() => void exportBase()} disabled={!!busy} style={softStyle} hover={softHover}>
            <Icon name="download" size={15} stroke={2.2} />{busy === 'export' ? '…' : t('yc.plan.p.export')}
          </Hv>
          <SoftLink to={CRM_ROUTES.accountSection('help')} icon="help" label={t('yc.plan.p.help')} />
        </div>
      </section>
    </div>
  );
}

function MemberPause({ s }: { s: PauseSummary | null }) {
  const { t } = useCrmT();
  const toast = useCrmToast();
  const { space, rpc: args } = useCrmScope();
  const kicker = useKicker(s);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(!!s?.nudged_at && Date.now() - new Date(s.nudged_at).getTime() < 86_400_000);
  const name = s?.owner_first_name || t('yc.plan.p.m.holder');

  const nudge = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await rpc('crm_nudge_owner_subscribe', args);
      setDone(true);
      toast(t('yc.plan.b.nudged'));
    } catch {
      toast(t('yc.acc.b.err'));
    }
    setBusy(false);
  };

  return (
    <div style={{ padding: 'clamp(24px,6vw,64px) clamp(16px,3vw,32px)', display: 'flex', justifyContent: 'center' }}>
      <section style={{ ...frame, maxWidth: 620, gap: 20 }}>
        <span style={{ alignSelf: 'flex-start', height: 26, padding: '0 10px', borderRadius: 99, background: 'var(--sand-100)', color: 'var(--sand-700)', ...mono, display: 'inline-flex', alignItems: 'center' }}>{kicker}</span>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(28px,4.4vw,38px)', letterSpacing: '-.045em', lineHeight: 1.05 }}>{t('yc.plan.p.m.title', { space: space.name })}</h1>
        <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: 'var(--sand-600)' }}>{t('yc.plan.p.m.sub', { name })}</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {done ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 48, padding: '0 18px', borderRadius: 99, background: 'var(--green-50)', color: 'var(--green-700)', fontSize: 15, fontWeight: 600 }}>
              <Icon name="check" size={16} stroke={2.6} />{t('yc.plan.b.nudged')}
            </span>
          ) : (
            <Hv as="button" type="button" onClick={() => void nudge()} disabled={busy} style={{ height: 48, padding: '0 22px', border: 0, borderRadius: 99, background: 'var(--ink)', color: '#fff', fontSize: 15, fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }} hover={{ background: 'var(--sand-700)' }}>
              {t('yc.plan.b.cta.nudgeName', { name })}
            </Hv>
          )}
          <Hv as={Link} to={CRM_ROUTES.clients} style={{ height: 48, padding: '0 22px', borderRadius: 99, boxShadow: 'inset 0 0 0 1.5px var(--sand-200)', background: '#fff', color: 'var(--ink)', fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }} hover={{ background: 'var(--sand-50)', color: 'var(--ink)', textDecoration: 'none' }}>
            {t('yc.plan.p.clients')}
          </Hv>
        </div>
        {!done && <span style={{ fontSize: 13.5, color: 'var(--sand-500)' }}>{t('yc.plan.p.m.note', { name })}</span>}
      </section>
    </div>
  );
}

const softStyle = { height: 44, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '0 6px', border: 0, background: 'none', fontSize: 14, fontWeight: 600, color: 'var(--sand-700)', cursor: 'pointer', textDecoration: 'none', fontFamily: 'inherit' } as const;
const softHover = { color: 'var(--ink)', textDecoration: 'none' };

function SoftLink({ to, icon, label }: { to: string; icon: 'users' | 'help'; label: string }) {
  return (
    <Hv as={Link} to={to} style={softStyle} hover={softHover}>
      <Icon name={icon} size={15} stroke={2.2} />{label}
    </Hv>
  );
}

/** Bande discrète pour l'équipe Yuno (démo, aperçu, accès assisté) : le compte est en pause, la page reste ouverte. */
export function PauseExemptNote() {
  const { t } = useCrmT();
  return (
    <div style={{ padding: '14px clamp(16px,2.4vw,28px) 0' }}>
      <div role="status" style={{ padding: '10px 16px', borderRadius: 14, background: 'var(--sand-100)', color: 'var(--sand-700)', fontSize: 13.5 }}>{t('yc.plan.p.exempt')}</div>
    </div>
  );
}
