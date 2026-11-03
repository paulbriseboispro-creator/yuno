/**
 * Retour de Stripe (maquette D, 03/11) : « C'est fait ». Stripe confirme
 * l'abonnement par le webhook, quelques secondes après le retour : la carte
 * relit l'abonnement toutes les 2 s (40 s au plus) et dit « on active votre
 * compte » d'ici là, jamais un succès avant que la base ne l'ait vu.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { EASE } from '@/crm/ui/motion';
import { useCrmT } from '@/crm/i18n';
import { useCrmScope } from '@/crm/scope';
import { CRM_ROUTES } from '@/crm/shell/nav';
import type { CrmBilling } from '@/crm/data/account';

export function SubscribedCard({ b, onClose }: { b: CrmBilling; onClose: () => void }) {
  const { t, n, eur, dShort } = useCrmT();
  const { space, qk } = useCrmScope();
  const qc = useQueryClient();
  const sub = b.subscription;
  const ready = !!sub?.has_stripe && b.effective_plan === 'base';
  const tries = useRef(0);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (ready) {
      void qc.invalidateQueries({ queryKey: ['crm', qk, 'shell'] });
      void qc.invalidateQueries({ queryKey: ['crm', qk, 'billing-overview'] });
      return;
    }
    const id = window.setInterval(() => {
      tries.current += 1;
      if (tries.current > 20) { window.clearInterval(id); setSlow(true); return; }
      void qc.invalidateQueries({ queryKey: ['crm', qk, 'billing'] });
    }, 2000);
    return () => window.clearInterval(id);
  }, [ready, qc, qk]);

  const trialing = sub?.status === 'trialing' && !!sub.trial_ends_at;
  const founder = !!sub?.offer;
  const year = sub?.interval === 'year';
  const amount = year ? b.pricing.price_year : b.pricing.price_month;
  const ht = b.pricing.vat_rate > 0 ? ` ${t('yc.acc.b.ht')}` : '';
  const nextAt = trialing ? sub?.trial_ends_at : sub?.current_period_end;
  const tiles = [
    { k: t('yc.plan.ok.paidToday'), v: trialing ? eur(0) : `${eur(amount)}${ht}` },
    { k: t(trialing ? 'yc.plan.ok.firstPay' : 'yc.plan.ok.next'), v: nextAt ? `${eur(amount)}${ht} · ${dShort(nextAt)}` : '—' },
    {
      k: founder ? t('yc.plan.ok.founderYunits') : t('yc.plan.ok.yunits'),
      v: founder ? n(b.yunits_balance)
        : trialing && sub?.trial_ends_at ? t('yc.plan.ok.yunitsAt', { n: n(b.pricing.monthly_yunits), date: dShort(sub.trial_ends_at) })
          : t('yc.plan.ok.yunitsNow', { n: n(b.pricing.monthly_yunits) }),
    },
  ];

  return (
    <section
      role="status"
      style={{
        position: 'relative', boxSizing: 'border-box', borderRadius: 28, padding: 'clamp(22px,3.4vw,36px)', color: 'var(--text-on-night)',
        background: 'radial-gradient(70% 90% at 100% 0%,rgba(255,107,53,.45),transparent 65%),radial-gradient(60% 80% at 0% 100%,rgba(227,20,27,.35),transparent 70%),var(--noise-night),var(--night)',
        display: 'flex', flexDirection: 'column', gap: 22, animation: `yc-rise 700ms ${EASE} both`,
      }}
    >
      <Hv as="button" type="button" aria-label={t('yc.plan.ok.close')} onClick={onClose} style={{ position: 'absolute', top: 14, right: 14, width: 36, height: 36, border: 0, borderRadius: 99, background: 'transparent', color: 'var(--text-on-night-2)', display: 'grid', placeItems: 'center', cursor: 'pointer' }} hover={{ background: 'rgba(255,255,255,.08)' }}>
        <Icon name="x" size={16} stroke={2.2} />
      </Hv>
      <span style={{ width: 56, height: 56, borderRadius: 99, background: 'var(--gradient-brand)', display: 'grid', placeItems: 'center' }}>
        {ready
          ? <Icon name="check" size={26} stroke={2.8} color="#fff" />
          : <span style={{ width: 22, height: 22, borderRadius: 99, border: '2.6px solid rgba(255,255,255,.35)', borderTopColor: '#fff', animation: 'yc-spin 700ms linear infinite' }} />}
      </span>
      {ready ? (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(30px,4.4vw,44px)', letterSpacing: '-.045em', lineHeight: 1, textWrap: 'balance' }}>{t('yc.plan.ok.title', { space: space.name })}</h2>
            <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: 'var(--text-on-night-2)', maxWidth: 620 }}>{t(trialing ? 'yc.plan.ok.subTrial' : 'yc.plan.ok.subNow')}</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,200px),1fr))', gap: 10 }}>
            {tiles.map((x) => (
              <div key={x.k} style={{ padding: 16, borderRadius: 18, background: 'rgba(255,255,255,.08)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-on-night-2)' }}>{x.k}</span>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600, letterSpacing: '-.02em' }}>{x.v}</span>
              </div>
            ))}
          </div>
          <div>
            <Hv as={Link} to={CRM_ROUTES.home} style={{ height: 48, padding: '0 22px', borderRadius: 99, background: '#fff', color: 'var(--ink)', fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }} hover={{ color: 'var(--ink)', textDecoration: 'none', transform: 'translateY(-1px)' }}>
              {t('yc.plan.ok.back')}
            </Hv>
          </div>
        </>
      ) : (
        <p style={{ margin: 0, fontSize: 17, fontWeight: 600, lineHeight: 1.45 }}>{t(slow ? 'yc.plan.ok.slow' : 'yc.plan.ok.pending')}</p>
      )}
    </section>
  );
}
