/**
 * Étape « À qui l'envoyer ? » d'un e-mail PRATIQUE : il n'y a rien à
 * choisir. Les détenteurs d'un billet valide de la soirée, et eux seuls
 * (_crm_practical_audience) ; puis ce que l'e-mail peut dire et ce qu'il ne
 * dira jamais. Doc : docs/designs/CRM_PRACTICAL_EMAIL.md.
 */
import { Rich } from '@/crm/ui/Rich';
import { EASE } from '@/crm/ui/motion';
import { useCrmT } from '@/crm/i18n';
import type { PracticalNight } from '@/crm/data/practical';
import { practicalReasonKey } from '@/crm/lib/practicalEmail';
import { Card, CardHead, StepTitle } from './sendUi';

export function PracticalAudienceStep({ night, loading }: { night: PracticalNight | undefined; loading: boolean }) {
  const { t, tp, n } = useCrmT();
  const reach = night?.reachable ?? 0;
  const holders = night?.holders ?? 0;
  const onlyHere = Math.max(0, reach - (night?.marketing_optin ?? 0));
  const suppressed = Math.max(0, holders - reach);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22, animation: `yc-rise 520ms ${EASE} both` }}>
      <StepTitle kick={t('yc.em.sd.aud.kick')} a={t('yc.pe.aud.h.a')} b={t('yc.pe.aud.h.b')} c={t('yc.pe.aud.h.c')} sub={t('yc.pe.aud.sub', { title: night?.title ?? '' })} />

      <section style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '20px 24px', borderRadius: 24, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-sm)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '8px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(44px,5vw,64px)', lineHeight: 0.95, letterSpacing: '-.05em', fontVariantNumeric: 'tabular-nums' }}>{loading ? '…' : n(reach)}</span>
            <span style={{ fontSize: 16, color: 'var(--sand-500)' }}>{tp('yc.pe.aud.will', reach)}</span>
          </div>
          <span style={{ fontSize: 14, color: 'var(--sand-600)' }}><Rich text={t('yc.em.sd.cost', { n: n(reach * (night?.yunits_per_email ?? 1)) })} /></span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14, lineHeight: 1.45, color: 'var(--sand-600)' }}>
          {onlyHere > 0 && <span>{t('yc.pe.aud.onlyHere', { n: n(onlyHere) })}</span>}
          {suppressed > 0 && <span>{t('yc.pe.aud.suppressed', { n: n(suppressed) })}</span>}
          <span>{t('yc.pe.aud.fixed')}</span>
        </div>
      </section>

      {night && !night.eligible && (
        <div style={{ padding: '14px 18px', borderRadius: 18, background: 'var(--red-50)', color: 'var(--red-700)', fontSize: 14.5, lineHeight: 1.45, fontWeight: 500 }}>
          {t(practicalReasonKey(night.reason), { max: night.max ?? 3 })}
        </div>
      )}
      {night?.role === 'editor' && night.eligible && (
        <div style={{ padding: '14px 18px', borderRadius: 18, background: 'var(--amber-50)', color: 'var(--amber-700)', fontSize: 14.5, lineHeight: 1.45, fontWeight: 500 }}>
          {t('yc.pe.m.coorg')}
        </div>
      )}

      <Card gap={10}>
        <CardHead title={t('yc.pe.m.okT')} sub={t('yc.pe.m.ok')} />
        <CardHead title={t('yc.pe.m.noT')} sub={t('yc.pe.m.no')} />
      </Card>
    </div>
  );
}
