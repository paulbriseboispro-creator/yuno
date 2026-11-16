/**
 * Communication › Page bio : « Que fait la page de la bio Instagram / TikTok ? »
 * Yuno Links : audience, réglages et liste d'attente. Les leads pro se traitent
 * dans Pros › Prospects (une seule liste, une seule case « contacté »).
 */
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Page, Tabs, useAdminT, useTab } from '@/admin/ui';
import { LINKS_PUBLIC_URL } from '@/lib/yunoLinks';
import { useWaitlist } from './data';
import LinksAudience from './LinksAudience';
import LinksSettings from './LinksSettings';
import LinksWaitlist from './LinksWaitlist';

export default function Links() {
  const { t } = useAdminT();
  const wl = useWaitlist();
  const tabs = [
    { value: 'audience', label: t('adminLinks.tabAudience') },
    { value: 'settings', label: t('adminLinks.tabSettings') },
    { value: 'waitlist', label: t('adm.links.tabWaitlist'), count: wl.data?.length },
  ];
  const [tab, setTab] = useTab(tabs);
  const copy = async () => {
    try { await navigator.clipboard.writeText(LINKS_PUBLIC_URL); toast.success(t('adminLinks.copied')); } catch { toast.error(t('adminLinks.copyError')); }
  };
  return (
    <Page title={t('adm.comms.ln.title')} subtitle={<>{t('adm.comms.ln.sub')} <Link to="/admin/pros/prospects" className="underline">{t('adm.comms.ln.noteLink')}</Link></>}
      period={tab === 'audience'}
      actions={(
        <>
          <button type="button" className="a-btn" onClick={() => void copy()}>{t('adminLinks.copy')}</button>
          <a className="a-btn a-btn--primary" href={LINKS_PUBLIC_URL} target="_blank" rel="noopener noreferrer">{t('adminLinks.open')}</a>
        </>
      )}>
      <Tabs items={tabs} value={tab} onChange={setTab} />
      {tab === 'audience' && <LinksAudience />}
      {tab === 'settings' && <LinksSettings />}
      {tab === 'waitlist' && <LinksWaitlist waitlist={wl} />}
    </Page>
  );
}
