/**
 * Étape Audience › « Qui peut recevoir cet e-mail ? » : à l'accord seul (tout
 * contenu), ou « Tous vos clients » (l'accord + les personnes qui ont pris une
 * place aux soirées du compte, pour ne parler que de ses soirées). Le second
 * choix n'existe que si « Vos clients » est ouvert dans Réglages › Envoi ; il
 * ne s'ouvre jamais d'ici (le titulaire signe dans les réglages).
 */
import { Link } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { useCrmT } from '@/crm/i18n';
import { CRM_ROUTES } from '@/crm/shell/nav';
import type { CustomerAudiencePreview, CustomerBasis } from '@/crm/data/customerBasis';

export type LegalBasis = 'consent' | 'customer';

export function CustomerBasisPicker({ basis, value, onChange, preview, consentNet }: {
  basis: CustomerBasis | undefined;
  value: LegalBasis;
  onChange: (v: LegalBasis) => void;
  preview: CustomerAudiencePreview | undefined;
  /** L'audience à l'accord seul (aperçu habituel de l'étape). */
  consentNet: number | null;
}) {
  const { t, n } = useCrmT();
  const active = basis?.status === 'active';
  const opt = (v: LegalBasis, title: string, sub: string, right: string | null, disabled: boolean) => {
    const on = value === v;
    return (
      <Hv
        as="button" type="button" role="radio" aria-checked={on} disabled={disabled}
        onClick={() => { if (!disabled) onChange(v); }}
        style={{
          flex: '1 1 260px', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 4, padding: '14px 16px', borderRadius: 18, border: 0,
          background: on ? 'var(--sand-50)' : '#fff', color: 'var(--ink)', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1,
          boxShadow: `inset 0 0 0 ${on ? '2px' : '1px'} ${on ? 'var(--ink)' : 'var(--sand-200)'}`,
        }}
        hover={disabled || on ? undefined : { boxShadow: 'inset 0 0 0 1.5px var(--sand-400)' }}
      >
        <span style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
          <b style={{ fontSize: 15 }}>{title}</b>
          {right && <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, fontVariantNumeric: 'tabular-nums' }}>{right}</span>}
        </span>
        <span style={{ fontSize: 13.5, lineHeight: 1.4, color: 'var(--sand-600)' }}>{sub}</span>
      </Hv>
    );
  };
  const customerRight = value === 'customer' && preview?.total !== undefined ? n(preview.total)
    : basis ? t('yc.cb.a.upTo', { n: n(basis.counts.extra) }) : null;
  return (
    <section role="radiogroup" aria-label={t('yc.cb.a.t')} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sand-500)' }}>{t('yc.cb.a.t')}</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {opt('consent', t('yc.cb.a.consent'), t('yc.cb.a.consentS'), consentNet === null ? null : n(consentNet), false)}
        {opt('customer', t('yc.cb.a.customer'), active ? t('yc.cb.a.customerS') : t('yc.cb.a.closed'), customerRight, !active && value !== 'customer')}
      </div>
      {!active && (
        <span style={{ fontSize: 13.5, color: 'var(--sand-600)' }}>
          <Hv as={Link} to={CRM_ROUTES.emailSettings} style={{ color: 'var(--ink)', fontWeight: 600 }} hover={{ color: 'var(--ink)' }}>{t('yc.cb.a.openCta')}</Hv>
        </span>
      )}
      {value === 'customer' && preview?.customer_basis && (
        <span style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--sand-600)' }}>
          {t('yc.cb.a.split', { consent: n(preview.consent ?? 0), customer: n(preview.customer ?? 0) })}
          {!preview.open ? ` · ${t('yc.cb.a.notReady')}`
            : (preview.customer ?? 0) > (preview.today_room ?? Infinity) ? ` · ${t('yc.cb.a.ramp', { cap: n(preview.today_room ?? 0) })}` : ''}
        </span>
      )}
    </section>
  );
}
