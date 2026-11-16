/**
 * Communication › Page bio : « Que fait la page de la bio Instagram / TikTok ? »
 * Yuno Links : audience et réglages. Les leads pro et la liste d'attente sont
 * repris par Pros › Prospects (lot 2) ; tant que cette fusion n'est pas faite
 * ils restent accessibles ici, dans leurs onglets d'origine (écran hérité).
 */
import { Link } from 'react-router-dom';
import { Card, Page, useAdminT } from '@/admin/ui';
import AdminLinks from '@/pages/admin/AdminLinks';
import { SuiteFrame } from '../shell/frames';

export default function Links() {
  const { t } = useAdminT();
  return (
    <Page title={t('adm.comms.ln.title')} subtitle={t('adm.comms.ln.sub')}>
      <Card>
        <p className="a-t2 text-[13px] leading-relaxed">
          {t('adm.comms.ln.note')} <Link to="/admin/pros/prospects" className="underline">{t('adm.comms.ln.noteLink')}</Link>
        </p>
      </Card>
      <SuiteFrame><AdminLinks /></SuiteFrame>
    </Page>
  );
}
