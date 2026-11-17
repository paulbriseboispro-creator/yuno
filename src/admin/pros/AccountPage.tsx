/**
 * La fiche d'un pro (`/admin/pros/<clé>`) : UNE fiche par compte, quel que
 * soit son produit. Un compte Billetterie + CRM se lit ici en entier.
 * Données : admin_account (migration 20261218120000), qui réutilise
 * admin_venue_overview et crm_admin_account sans recalculer.
 */
import { Navigate, Link, useLocation, useParams } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { Badge, ErrorState, Page, Status, Tabs, useAdminT, useTab, type TabItem } from '@/admin/ui';
import { legacyAdminTarget } from '../redirects';
import { LIFECYCLE_TONE, parseAccountKey } from './accounts';
import { useAccount } from './data';
import { ProductBadges, TypeLabel } from './bits';
import { AccountGestures } from './gestures';
import { OverviewTab, SalesTab, EventsTab } from './account/MainTabs';
import { CrmTab } from './account/CrmTab';
import { TeamTab, SupportLegalTab, JournalTab } from './account/OtherTabs';

export default function AccountPage() {
  const { key: raw } = useParams();
  const { pathname, search, hash } = useLocation();
  const { t } = useAdminT();
  const parsed = parseAccountKey(raw);
  const key = parsed ? `${parsed.kind}:${parsed.ref}` : undefined;
  const q = useAccount(key);
  const card = q.data;
  const hasCrm = !!card?.row?.products.includes('crm') || !!card?.crm;

  const items: TabItem[] = [
    { value: 'overview', label: t('adm.pros.v3.tab.card') },
    { value: 'sales', label: t('adm.pros.tab.sales') },
    { value: 'events', label: t('adm.pros.tab.events'), count: card?.events.length },
    ...(hasCrm ? [{ value: 'crm', label: 'CRM' }] : []),
    { value: 'team', label: t('adm.pros.tab.team'), count: card ? card.team.length + 1 : undefined },
    { value: 'support', label: t('adm.pros.tab.support') },
    { value: 'journal', label: t('adm.pros.tab.journal'), count: card?.notes.length || undefined },
  ];
  const [tab, setTab] = useTab(items);

  // Une ancienne adresse sous /admin/pros (`/admin/pros/sales`…) ou une clé illisible.
  if (!parsed) return <Navigate to={legacyAdminTarget(pathname, search, hash) ?? '/admin/pros'} replace />;

  if (q.error) {
    const notFound = (q.error as { code?: string }).code === 'P0002';
    return (
      <Page title={t(notFound ? 'adm.pros.card.notFound' : 'adm.ui.error.title')}>
        {notFound
          ? <div className="border-y py-8 text-center"><Link to="/admin/pros" className="a-btn">{t('adm.pros.card.back')}</Link></div>
          : <ErrorState onRetry={() => void q.refetch()} />}
      </Page>
    );
  }
  if (!card) {
    return (
      <Page title={<span className="a-skel inline-block h-6 w-56" />}>
        <div className="a-skel h-10 w-full" /><div className="a-skel h-64 w-full" />
      </Page>
    );
  }

  const row = card.row;
  const id = card.identity;
  return (
    <Page
      title={String(id.name ?? card.ref)}
      subtitle={(
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          {row && <Status tone={LIFECYCLE_TONE[row.status]}>{t(`adm.pros.st.${row.status}`)}</Status>}
          {row && <span title={t(`adm.pros.st.${row.status}.def`)} className="a-t3">·</span>}
          {row ? <TypeLabel type={row.type} /> : null}
          {id.city && <span>· {String(id.city)}</span>}
          {row && <ProductBadges products={row.products} />}
          {row?.is_demo && <Badge>{t('adm.pros.demo')}</Badge>}
          {id.public_url && (
            <a className="a-t2 inline-flex items-center gap-1 underline-offset-2 hover:underline" href={String(id.public_url)} target="_blank" rel="noreferrer">
              {t('adm.pros.card.publicPage')}<ExternalLink className="h-3 w-3" />
            </a>
          )}
        </span>
      )}
      actions={<AccountGestures card={card} />}
    >
      <Tabs items={items} value={tab} onChange={setTab} />
      {tab === 'overview' && <OverviewTab card={card} onTab={setTab} />}
      {tab === 'sales' && <SalesTab card={card} />}
      {tab === 'events' && <EventsTab card={card} />}
      {tab === 'crm' && hasCrm && <CrmTab card={card} />}
      {tab === 'team' && <TeamTab card={card} />}
      {tab === 'support' && <SupportLegalTab card={card} />}
      {tab === 'journal' && <JournalTab card={card} />}
    </Page>
  );
}
