/**
 * Étape Audience › la ligne sous le chiffre (« Vos clients », 03/11) : le pro ne
 * choisit plus « à l'accord » ou « tous vos clients ». Le chiffre est UN nombre :
 * les personnes « Accepté » (accord donné) et, quand le titulaire a signé et que
 * l'e-mail ne parle que de ses soirées, ses clients « Pas de mention ». Cette ligne
 * dit seulement ce qui les en écarte, ou ce que la signature ajouterait ; la base
 * légale est posée par le serveur quand la campagne est programmée ou envoyée.
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
    text = (unified.ramp_waiting ?? 0) > 0 ? t('yc.cb.a.incRamp', { n: n(unified.ramp_waiting ?? 0) }) : t('yc.cb.a.inc');
  } else if (unified.reason === 'content') {
    const why = [...new Set((unified.issues ?? []).map((i) => t(customerIssueKey(i.code))))].slice(0, 2).join(' · ');
    text = t('yc.cb.a.content', { why });
    tone = 'warn';
  } else if (unified.reason === 'feature' && basis.open) {
    text = t('yc.cb.a.feature');
  } else if (unified.reason === 'closed' && extra > 0 && basis.can_declare) {
    text = basis.status === 'active' ? t('yc.cb.a.notReady') : t('yc.cb.a.after', { n: n(extra) });
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
