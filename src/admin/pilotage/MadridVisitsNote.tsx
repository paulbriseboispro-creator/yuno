/**
 * Avertissement temporaire : les visites de la plateforme (get_platform_traffic,
 * admin_product_insights, admin_cockpit) comptent encore les pages de la
 * marketplace de Madrid et leurs robots. À retirer quand la migration décrite
 * dans docs/designs/ADMIN_REBUILD_PLAN.md (section « Visites et Madrid ») sera
 * appliquée.
 */
import { Link } from 'react-router-dom';
import { useAdminT } from '@/admin/ui';

export function MadridVisitsNote() {
  const { t } = useAdminT();
  return (
    <p role="note" className="a-t2 border-l-2 py-0.5 pl-3 text-[12.5px] leading-relaxed" style={{ borderColor: 'var(--a-warn)' }}>
      {t('adm.pil.madridNote')}{' '}
      <Link to="/admin/madrid/audience" className="a-t1 underline underline-offset-2">{t('adm.pil.madridNote.link')}</Link>
    </p>
  );
}
