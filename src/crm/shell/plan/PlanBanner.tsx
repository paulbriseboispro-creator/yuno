/**
 * Le bandeau d'abonnement sous la barre du haut (maquette B, 03/11) : un seul
 * à la fois, sur toutes les pages. Il monte en urgence quand la fin approche
 * (neutre → ambre à J-3 → rouge le dernier jour) et disparaît dès que
 * l'abonnement est pris. Un membre de l'équipe voit la même urgence, sans
 * bouton de paiement : il peut prévenir le titulaire.
 */
import { useState } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { EASE } from '@/crm/ui/motion';
import { useCrmToast } from '@/crm/ui/toast';
import { useCrmT } from '@/crm/i18n';
import { useCrmScope } from '@/crm/scope';
import { rpc } from '@/crm/lib/rpc';
import { bannerHideKey } from '@/crm/lib/plan';
import { useBillingAction } from '@/crm/data/account';
import { useChooser, usePlan, usePriceLabel } from './usePlan';

type Tone = 'neutral' | 'amber' | 'red' | 'night';
const TONES: Record<Tone, { bg: string; ring: string; title: string; text: string; pillBg: string; pillFg: string }> = {
  neutral: { bg: '#fff', ring: 'var(--shadow-sm)', title: 'var(--ink)', text: 'var(--sand-600)', pillBg: 'var(--sand-100)', pillFg: 'var(--sand-700)' },
  amber: { bg: 'var(--amber-50)', ring: 'inset 0 0 0 1px rgba(229,154,11,.35)', title: 'var(--amber-700)', text: '#7A4F00', pillBg: '#fff', pillFg: 'var(--amber-700)' },
  red: { bg: 'var(--red-50)', ring: 'inset 0 0 0 1px var(--red-200)', title: 'var(--red-800)', text: 'var(--red-700)', pillBg: '#fff', pillFg: 'var(--red-600)' },
  night: { bg: 'radial-gradient(70% 140% at 100% 0%,rgba(255,107,53,.45),transparent 65%),var(--night)', ring: 'none', title: 'var(--text-on-night)', text: 'var(--text-on-night-2)', pillBg: 'rgba(255,255,255,.1)', pillFg: '#FF8A4C' },
};

function readHidden(key: string): boolean {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}

export function PlanBanner() {
  const { t, tp, n, dLong, time } = useCrmT();
  const toast = useCrmToast();
  const { space, rpc: args } = useCrmScope();
  const plan = usePlan();
  const chooser = useChooser();
  const price = usePriceLabel();
  const act = useBillingAction();
  const hideKey = bannerHideKey(space.key);
  const [hidden, setHidden] = useState(() => readHidden(hideKey));
  const [busy, setBusy] = useState(false);
  const [nudged, setNudged] = useState(false);

  const banner = plan.banner;
  const b = plan.billing;
  if (!banner || !b || plan.exempt) return null;
  if (banner.dismissible && hidden) return null;
  // Les rappels d'un abonnement payé ne concernent que celui qui paie.
  if (!plan.holder && (banner.kind === 'pastDue' || banner.kind === 'ending')) return null;

  const date = banner.at ? dLong(banner.at) : '';
  const monthly = price(b.pricing.price_month, 'month', plan.vat);
  const trialish = banner.kind === 'trial' || banner.kind === 'trialSoon' || banner.kind === 'trialLast' || banner.kind === 'founder';
  const member = trialish && !plan.holder;

  const tone: Tone = banner.kind === 'founder' ? 'night'
    : banner.kind === 'trialLast' || banner.kind === 'pastDue' ? 'red'
      : banner.kind === 'trialSoon' || banner.kind === 'ending' ? 'amber' : 'neutral';
  const c = TONES[tone];

  const pill = banner.kind === 'trial' ? t('yc.plan.b.pill.trial')
    : banner.kind === 'trialSoon' ? tp('yc.plan.b.pill.days', banner.days)
      : banner.kind === 'trialLast' ? t('yc.plan.b.pill.last')
        : banner.kind === 'founder' ? t('yc.plan.b.pill.founder')
          : banner.kind === 'pastDue' ? t('yc.plan.b.pill.payment') : null;

  const lastWhen = () => {
    const end = new Date(banner.at ?? '');
    const today = new Date();
    return end.toDateString() === today.toDateString() ? t('yc.plan.b.last.today') : t('yc.plan.b.last.tomorrow');
  };

  let title = '';
  let sub = '';
  if (member) {
    title = tp('yc.plan.b.member.t', banner.days, { space: space.name });
    sub = t('yc.plan.b.member.s');
  } else if (banner.kind === 'trial') {
    title = tp('yc.plan.b.trial.t', banner.days);
    sub = t('yc.plan.b.trial.s', { date, yunits: n(b.pricing.monthly_yunits) });
  } else if (banner.kind === 'trialSoon') {
    title = tp('yc.plan.b.soon.t', banner.days);
    sub = t('yc.plan.b.soon.s', { date });
  } else if (banner.kind === 'trialLast') {
    title = t('yc.plan.b.last.t', { when: lastWhen(), time: banner.at ? time(banner.at) : '' });
    sub = t('yc.plan.b.last.s');
  } else if (banner.kind === 'founder') {
    title = tp('yc.plan.b.founder.t', banner.days, { date });
    sub = t('yc.plan.b.founder.s', { price: monthly });
  } else if (banner.kind === 'pastDue') {
    title = t('yc.plan.b.pastDue.t');
    sub = t('yc.plan.b.pastDue.s');
  } else {
    title = t('yc.plan.b.ending.t', { date });
    sub = t('yc.plan.b.ending.s');
  }

  const run = async (action: 'crm_portal' | 'crm_resume') => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await act.mutateAsync({ action });
      if (r.url) { window.location.assign(r.url); return; }
      if (action === 'crm_resume') toast(t('yc.plan.b.resumed'));
    } catch {
      toast(t('yc.acc.b.err'));
    }
    setBusy(false);
  };

  const nudge = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await rpc('crm_nudge_owner_subscribe', args);
      setNudged(true);
      toast(t('yc.plan.b.nudged'));
    } catch {
      toast(t('yc.acc.b.err'));
    }
    setBusy(false);
  };

  const gradient = { background: 'var(--gradient-brand)', color: '#fff', boxShadow: '0 8px 16px rgba(227,20,27,.22)' };
  const ink = { background: 'var(--ink)', color: '#fff', boxShadow: 'none' };
  const white = { background: '#fff', color: 'var(--ink)', boxShadow: 'none' };
  const outline = { background: '#fff', color: 'var(--ink)', boxShadow: 'inset 0 0 0 1.5px var(--sand-200)' };

  let cta: { label: string; onClick: () => void; style: Record<string, string> } | null = null;
  if (member) {
    cta = nudged ? null : { label: t('yc.plan.b.cta.nudge'), onClick: () => void nudge(), style: outline };
  } else if (banner.kind === 'trial') cta = { label: t('yc.plan.b.cta.choose'), onClick: () => chooser.open(), style: gradient };
  else if (banner.kind === 'trialSoon') cta = { label: t('yc.plan.b.cta.keepAll'), onClick: () => chooser.open(), style: gradient };
  else if (banner.kind === 'trialLast') cta = { label: t('yc.plan.b.cta.subscribe', { price: monthly }), onClick: () => chooser.open(), style: gradient };
  else if (banner.kind === 'founder') cta = { label: t('yc.plan.b.cta.card'), onClick: () => chooser.open(), style: white };
  else if (banner.kind === 'pastDue') cta = { label: t('yc.plan.b.cta.updateCard'), onClick: () => void run('crm_portal'), style: ink };
  else cta = { label: t('yc.plan.b.cta.keepSub'), onClick: () => void run('crm_resume'), style: ink };

  return (
    <div style={{ padding: '14px clamp(16px,2.4vw,28px) 0' }}>
      <div
        role={tone === 'red' ? 'alert' : 'status'}
        style={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 18px', padding: '12px 12px 12px 18px', borderRadius: 18,
          background: c.bg, boxShadow: c.ring, color: c.title, animation: `yc-rise 500ms ${EASE} both`,
        }}
      >
        {pill && (
          <span style={{ height: 26, padding: '0 10px', borderRadius: 99, background: c.pillBg, color: c.pillFg, fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', display: 'inline-flex', alignItems: 'center', flex: 'none' }}>{pill}</span>
        )}
        <div style={{ flex: '1 1 340px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: c.title }}>{title}</span>
          <span style={{ fontSize: 13.5, lineHeight: 1.45, color: c.text, textWrap: 'pretty' }}>{sub}</span>
        </div>
        {cta && (
          <Hv
            as="button" type="button" onClick={cta.onClick} disabled={busy}
            style={{ flex: 'none', height: 42, padding: '0 18px', border: 0, borderRadius: 99, fontSize: 14, fontWeight: 600, cursor: busy ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, ...cta.style }}
            hover={{ filter: 'brightness(1.05)', transform: 'translateY(-1px)' }}
          >
            {cta.label}
          </Hv>
        )}
        {banner.dismissible && (
          <Hv
            as="button" type="button" aria-label={t('yc.plan.b.hide')} title={t('yc.plan.b.hide')}
            onClick={() => { try { localStorage.setItem(hideKey, '1'); } catch { /* préférence perdue : sans gravité */ } setHidden(true); }}
            style={{ flex: 'none', width: 36, height: 36, border: 0, borderRadius: 99, background: 'transparent', color: tone === 'night' ? 'var(--text-on-night-2)' : 'var(--sand-500)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}
            hover={{ background: tone === 'night' ? 'rgba(255,255,255,.08)' : 'var(--sand-100)' }}
          >
            <Icon name="x" size={16} stroke={2.2} />
          </Hv>
        )}
      </div>
    </div>
  );
}
