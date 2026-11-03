/**
 * Étape Audience › la ligne sous le chiffre (« Vos clients », 03/11) : un seul
 * nombre de personnes joignables, sans jamais distinguer à l'écran l'accord
 * marketing de la relation client (la différence reste en base). Cette ligne ne
 * parle que quand l'e-mail ne partira pas à toute la base joignable (contenu,
 * renvoi, déclaration à signer) ; la base légale est posée par le serveur.
 */
import { Link } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { useCrmT } from '@/crm/i18n';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { customerIssueKey, type CustomerBasis, type UnifiedAudience } from '@/crm/data/customerBasis';

export function CustomerReachNote({ basis, unified }: { basis: CustomerBasis | undefined; unified: UnifiedAudience | undefined }) {
  const { t, n } = useCrmT();
  if (!basis || !unified) return null;
  const extra = basis.counts.extra;
  let text: string | null = null;
  let tone: 'info' | 'warn' = 'info';
  let cta = false;
  if (unified.include) {
    text = (unified.ramp_waiting ?? 0) > 0 ? t('yc.cb.a.incRamp', { n: n(unified.ramp_waiting ?? 0) }) : null;
  } else if (unified.reason === 'content') {
    const why = [...new Set((unified.issues ?? []).map((i) => t(customerIssueKey(i.code))))].slice(0, 2).join(' · ');
    text = t('yc.cb.a.content', { why });
    tone = 'warn';
  } else if (unified.reason === 'feature' && basis.open) {
    text = t('yc.cb.a.feature');
  } else if (unified.reason === 'closed' && extra > 0 && basis.can_declare) {
    text = basis.status === 'active' ? t('yc.cb.a.notReady') : t('yc.cb.a.after');
    cta = basis.status !== 'active';
  }
  if (!text) return null;
  return (
    <div role="status" style={{
      padding: '12px 16px', borderRadius: 16, fontSize: 14, lineHeight: 1.5, textWrap: 'pretty',
      background: tone === 'warn' ? 'var(--amber-50)' : 'var(--sand-50)', color: tone === 'warn' ? 'var(--amber-700)' : 'var(--sand-700)',
    }}>
      {text}
      {cta && (
        <>{' '}<Hv as={Link} to={CRM_ROUTES.emailSettings} style={{ color: 'var(--ink)', fontWeight: 600 }} hover={{ color: 'var(--ink)' }}>{t(basis.is_owner ? 'yc.cb.a.signCta' : 'yc.cb.a.seeCta')}</Hv></>
      )}
    </div>
  );
}
