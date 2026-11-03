/**
 * L'abonnement dans le menu (maquettes A et B, 03/11) : le compte à rebours de
 * l'essai, ou « Abonné · 1er paiement le … » quand la carte est enregistrée
 * pendant l'essai. Rien quand il n'y a rien à dire (abonné, compte offert).
 */
import { Hv } from '@/crm/ui/Hv';
import { useCrmT } from '@/crm/i18n';
import { daysLeft } from '@/crm/lib/plan';
import { useChooser, usePlan } from './usePlan';

export function PlanSideCard({ expanded }: { expanded: boolean }) {
  const { t, tp, dShort } = useCrmT();
  const plan = usePlan();
  const chooser = useChooser();
  const b = plan.billing;
  const sub = b?.subscription;
  if (!expanded || !b || !sub || plan.exempt || plan.paused) return null;

  const box = { margin: '0 0 8px', padding: 14, borderRadius: 16, background: 'var(--sand-50)', display: 'flex', flexDirection: 'column' as const, gap: 8 };

  if (sub.status === 'trialing' && sub.has_stripe && sub.trial_ends_at) {
    return (
      <div style={box}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{t(`yc.plan.side.subscribed.${sub.interval === 'year' ? 'year' : 'month'}`)}</span>
        <span style={{ fontSize: 12.5, color: 'var(--sand-600)' }}>{t('yc.plan.side.firstPay', { date: dShort(sub.trial_ends_at) })}</span>
      </div>
    );
  }
  const banner = plan.banner;
  if (!banner || !['trial', 'trialSoon', 'trialLast', 'founder'].includes(banner.kind) || !banner.at) return null;

  const founder = banner.kind === 'founder';
  const total = founder ? Math.max(banner.days, (sub.offer?.free_months ?? 6) * 30) : Math.max(banner.days, b.pricing.trial_days || 14);
  const done = Math.min(1, Math.max(0.04, 1 - daysLeft(banner.at) / total));
  return (
    <div style={box}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{tp(founder ? 'yc.plan.side.founder' : 'yc.plan.side.trial', banner.days)}</span>
      <div aria-hidden style={{ height: 5, borderRadius: 99, background: 'var(--sand-200)', overflow: 'hidden' }}>
        <div style={{ width: `${done * 100}%`, height: '100%', borderRadius: 99, background: 'var(--gradient-brand)' }} />
      </div>
      {plan.holder && (
        <Hv as="button" type="button" onClick={() => chooser.open()} style={{ alignSelf: 'flex-start', padding: 0, border: 0, background: 'none', fontSize: 13, fontWeight: 600, color: 'var(--red-600)', cursor: 'pointer', fontFamily: 'inherit' }} hover={{ color: 'var(--red-700)' }}>
          {t('yc.plan.side.cta')}
        </Hv>
      )}
    </div>
  );
}
