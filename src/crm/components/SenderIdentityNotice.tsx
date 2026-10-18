/**
 * « L'identité de l'expéditeur est incomplète » : ce qui manque avant tout
 * envoi (porte `_crm_email_identity`), et le lien vers Réglages › Envoi.
 * Se tait quand tout est en place, pendant le chargement et sur la démo
 * (qui n'envoie jamais). `missing` force la liste (refus rendu par le serveur).
 */
import { Link } from 'react-router-dom';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { useCrmT } from '@/crm/i18n';
import { CRM_ROUTES } from '@/crm/shell/nav';
import { useEmailSettings } from '@/crm/data/emails';

export function SenderIdentityNotice({ missing: forced, compact }: { missing?: string[]; compact?: boolean }) {
  const { t } = useCrmT();
  const q = useEmailSettings();
  const r = q.data?.readiness;
  const missing = forced?.length ? forced : r && !r.ready && !r.demo ? r.missing : [];
  if (!missing.length) return null;
  const list = missing.map((m) => t(`yc.em.id.${m}`)).join(', ');
  return (
    <div role="status" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 16px', padding: compact ? '12px 14px' : '16px 18px', borderRadius: compact ? 14 : 20, background: 'var(--amber-50)', boxShadow: 'inset 0 0 0 1px #F2D9A2' }}>
      <span style={{ flex: 'none', width: 34, height: 34, borderRadius: 99, background: '#fff', color: 'var(--amber-700)', display: 'grid', placeItems: 'center' }}>
        <Icon name="shield" size={17} stroke={2.4} />
      </span>
      <span style={{ flex: '1 1 240px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <b style={{ fontSize: 14.5, color: 'var(--amber-700)' }}>{t('yc.em.id.t')}</b>
        <span style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--sand-700)', textWrap: 'pretty' }}>{t('yc.em.id.s', { list })}</span>
      </span>
      <Hv as={Link} to={CRM_ROUTES.emailSettings} style={{ flex: 'none', height: 38, padding: '0 16px', borderRadius: 99, background: 'var(--ink)', color: '#fff', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }} hover={{ background: 'var(--sand-700)', color: '#fff', textDecoration: 'none' }}>
        {t('yc.em.id.go')}<Icon name="arrowRight" size={15} stroke={2.4} />
      </Hv>
    </div>
  );
}
