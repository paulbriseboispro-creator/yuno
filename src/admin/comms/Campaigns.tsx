/**
 * Communication › Campagnes de Yuno : « À qui Yuno écrit, et qu'est-ce que ça
 * donne ? » La base marketing de Yuno (joignables, désabonnés) et les campagnes
 * e-mail, SMS et push de Yuno dans une seule liste à onglets. Les éditeurs
 * (Email Studio, SMS, formulaire push) restent ceux d'avant, dans leur cadre.
 */
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge, Card, DataTable, Kpi, KpiRow, Page, Tabs, useAdminT, useTab, type ColumnDef, type Tone } from '@/admin/ui';
import { fmtDate, fmtNum, fmtPct } from '@/lib/adminFormat';
import { rpc } from '../system/data';
import {
  COMMS_KEY, useEmailCampaigns, useMarketingOverview, usePushCampaigns, useSmsCampaigns,
  type EmailCampaignRow, type PushCampaignRow, type SmsCampaignRow,
} from './data';

const STATUS_TONE: Record<string, Tone> = { draft: 'neutral', scheduled: 'accent', sending: 'warning', sent: 'positive', paused: 'warning', failed: 'negative', cancelled: 'neutral' };

export default function Campaigns() {
  const { t, lang } = useAdminT();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const ov = useMarketingOverview();
  const emails = useEmailCampaigns();
  const sms = useSmsCampaigns();
  const push = usePushCampaigns();
  const tabs = [
    { value: 'email', label: t('adm.comms.cp.tab.email'), count: emails.data?.length },
    { value: 'sms', label: t('adm.comms.cp.tab.sms'), count: sms.data?.length },
    { value: 'push', label: t('adm.comms.cp.tab.push'), count: push.data?.length },
  ];
  const [tab, setTab] = useTab(tabs);

  const sync = useMutation({
    mutationFn: () => rpc<{ email_added: number; sms_added: number }>('sync_platform_marketing_contacts', { p_sources: ['clients', 'pros', 'waitlist', 'leads'] }),
    onSuccess: (r) => { toast.success(t('adm.comms.cp.synced', { email: r?.email_added ?? 0, sms: r?.sms_added ?? 0 })); void qc.invalidateQueries({ queryKey: COMMS_KEY }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const o = ov.data;
  const sentCount = (o?.campaigns.email_sent ?? 0) + (o?.campaigns.sms_sent ?? 0);
  const draftCount = (o?.campaigns.email_drafts ?? 0) + (o?.campaigns.sms_drafts ?? 0);
  const status = (s: string) => <Badge tone={STATUS_TONE[s] ?? 'neutral'}>{t(`adm.comms.cp.st.${s}`) === `adm.comms.cp.st.${s}` ? s : t(`adm.comms.cp.st.${s}`)}</Badge>;
  const when = (r: { sent_at?: string | null; scheduled_at: string | null; created_at: string }) => fmtDate(r.sent_at ?? r.scheduled_at ?? r.created_at, lang);

  const emailCols: ColumnDef<EmailCampaignRow, unknown>[] = [
    { accessorKey: 'name', header: t('adm.comms.cp.c.name'), cell: ({ row }) => <div className="min-w-0"><div className="a-t1 truncate font-medium">{row.original.name}</div><div className="a-t3 truncate text-[12px]">{row.original.subject}</div></div> },
    { accessorKey: 'status', header: t('adm.comms.cp.c.status'), cell: (c) => status(c.getValue<string>()) },
    { accessorKey: 'recipients_count', header: t('adm.comms.cp.c.sent'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
    // L'ouverture d'un e-mail est un signal faible (préchargement des messageries) : on la montre, sans la mettre en avant.
    { id: 'opens', header: t('adm.comms.cp.c.opens'), meta: { align: 'right' }, accessorFn: (r) => (r.recipients_count >= 30 ? r.opens_count / r.recipients_count : -1), cell: ({ row }) => (row.original.recipients_count >= 30 ? fmtPct((row.original.opens_count * 100) / row.original.recipients_count, 1) : '—') },
    { id: 'clicks', header: t('adm.comms.cp.c.clicks'), meta: { align: 'right' }, accessorFn: (r) => (r.recipients_count >= 30 ? r.clicks_count / r.recipients_count : -1), cell: ({ row }) => (row.original.recipients_count >= 30 ? fmtPct((row.original.clicks_count * 100) / row.original.recipients_count, 1) : '—') },
    { id: 'date', header: t('adm.comms.cp.c.date'), accessorFn: (r) => r.sent_at ?? r.scheduled_at ?? r.created_at, cell: ({ row }) => when(row.original) },
  ];
  const smsCols: ColumnDef<SmsCampaignRow, unknown>[] = [
    { id: 'name', header: t('adm.comms.cp.c.name'), accessorFn: (r) => r.name ?? '', cell: ({ row }) => <span className="a-t1 font-medium">{row.original.name || t('adm.comms.cp.c.untitled')}</span> },
    { accessorKey: 'status', header: t('adm.comms.cp.c.status'), cell: (c) => status(c.getValue<string>()) },
    { id: 'sent', header: t('adm.comms.cp.c.sent'), meta: { align: 'right' }, accessorFn: (r) => r.sent_count ?? 0, cell: (c) => fmtNum(c.getValue<number>(), lang) },
    { id: 'delivered', header: t('adm.comms.cp.c.delivered'), meta: { align: 'right' }, accessorFn: (r) => (r.sent_count ? (r.delivered_count ?? 0) / r.sent_count : -1), cell: ({ row }) => (row.original.sent_count && row.original.sent_count >= 30 ? fmtPct(((row.original.delivered_count ?? 0) * 100) / row.original.sent_count, 1) : '—') },
    { id: 'failed', header: t('adm.comms.cp.c.failed'), meta: { align: 'right' }, accessorFn: (r) => r.failed_count ?? 0, cell: (c) => fmtNum(c.getValue<number>(), lang) },
    { id: 'date', header: t('adm.comms.cp.c.date'), accessorFn: (r) => r.sent_at ?? r.scheduled_at ?? r.created_at, cell: ({ row }) => when(row.original) },
  ];
  const pushCols: ColumnDef<PushCampaignRow, unknown>[] = [
    { accessorKey: 'title', header: t('adm.comms.cp.c.name'), cell: ({ row }) => <div className="min-w-0"><div className="a-t1 truncate font-medium">{row.original.title}</div><div className="a-t3 text-[12px]">{row.original.segment}</div></div> },
    { id: 'status', header: t('adm.comms.cp.c.status'), accessorFn: (r) => r.status ?? 'sent', cell: ({ row }) => status(row.original.status ?? 'sent') },
    { accessorKey: 'targeted_count', header: t('adm.comms.cp.c.targeted'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number | null>() ?? 0, lang) },
    { accessorKey: 'sent_count', header: t('adm.comms.cp.c.sent'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
    { id: 'failed', header: t('adm.comms.cp.c.failed'), meta: { align: 'right' }, accessorFn: (r) => r.failed_count ?? 0, cell: (c) => fmtNum(c.getValue<number>(), lang) },
    { id: 'date', header: t('adm.comms.cp.c.date'), accessorFn: (r) => r.scheduled_at ?? r.created_at, cell: ({ row }) => fmtDate(row.original.scheduled_at ?? row.original.created_at, lang) },
  ];

  return (
    <Page title={t('adm.comms.cp.title')} subtitle={t('adm.comms.cp.sub')}
      actions={(
        <>
          <button type="button" className="a-btn" onClick={() => sync.mutate()} disabled={sync.isPending}>{sync.isPending ? t('adm.ui.working') : t('adm.comms.cp.sync')}</button>
          <button type="button" className="a-btn" onClick={() => navigate('/admin/comms/automations')}>{t('adm.comms.cp.recipes')}</button>
          <button type="button" className="a-btn" onClick={() => navigate('/admin/comms/push')}>{t('adm.comms.cp.newPush')}</button>
          <button type="button" className="a-btn" onClick={() => navigate('/admin/comms/sms')}>{t('adm.comms.cp.newSms')}</button>
          <button type="button" className="a-btn a-btn--primary" onClick={() => navigate('/admin/comms/email/new')}>{t('adm.comms.cp.newEmail')}</button>
        </>
      )}>
      <KpiRow>
        <Kpi label={t('adm.comms.cp.k.email')} value={fmtNum(o?.email.reachable ?? 0, lang)} hint={t('adm.comms.cp.k.emailHint')} loading={ov.isLoading} />
        <Kpi label={t('adm.comms.cp.k.sms')} value={fmtNum(o?.sms.reachable ?? 0, lang)} hint={t('adm.comms.cp.k.smsHint')} loading={ov.isLoading} />
        <Kpi label={t('adm.comms.cp.k.out')} value={fmtNum((o?.email.opted_out ?? 0) + (o?.sms.unsubscribed ?? 0), lang)} invert hint={t('adm.comms.cp.k.outHint')} loading={ov.isLoading} />
        <Kpi label={t('adm.comms.cp.k.sent')} value={fmtNum(sentCount, lang)} hint={t('adm.comms.cp.k.sentHint')} loading={ov.isLoading} />
        <Kpi label={t('adm.comms.cp.k.drafts')} value={fmtNum(draftCount, lang)} loading={ov.isLoading} />
      </KpiRow>
      <Tabs items={tabs} value={tab} onChange={setTab} />
      <Card padded={false}>
        {tab === 'email' && (
          <DataTable data={emails.data} columns={emailCols} loading={emails.isLoading} error={emails.error} onRetry={() => void emails.refetch()} searchable getRowId={(r) => r.id}
            onRowClick={(r) => navigate(r.status === 'draft' ? `/admin/comms/email/${r.id}/edit` : `/admin/comms/email/${r.id}/report`)}
            empty={{ title: t('adm.comms.cp.emptyEmail'), body: t('adm.comms.cp.emptyBody') }} />
        )}
        {tab === 'sms' && (
          <DataTable data={sms.data} columns={smsCols} loading={sms.isLoading} error={sms.error} onRetry={() => void sms.refetch()} searchable getRowId={(r) => r.id}
            onRowClick={(r) => navigate(`/admin/comms/sms/${r.id}`)} empty={{ title: t('adm.comms.cp.emptySms'), body: t('adm.comms.cp.emptyBody') }} />
        )}
        {tab === 'push' && (
          <DataTable data={push.data} columns={pushCols} loading={push.isLoading} error={push.error} onRetry={() => void push.refetch()} searchable getRowId={(r) => r.id}
            onRowClick={() => navigate('/admin/comms/push')} empty={{ title: t('adm.comms.cp.emptyPush'), body: t('adm.comms.cp.emptyBody') }} />
        )}
      </Card>
    </Page>
  );
}
