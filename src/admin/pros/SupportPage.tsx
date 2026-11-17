/**
 * « Dans quels comptes peut-on entrer, et qu'y a-t-on fait ? » (`/admin/pros/support`).
 * Une page pour l'accès assisté des deux produits (admin_support_overview) :
 * accordés, en attente, journal. Demander un accès passe par le même chemin
 * que la fiche (admin-account-recovery `request-support-access`, motif
 * obligatoire) ; « Voir sa Console » s'ouvre depuis la fiche du compte.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Badge, DataTable, Kpi, KpiRow, Page, ReasonDialog, Status, Tabs, Timeline, useAdminT, useTab, type ColumnDef } from '@/admin/ui';
import { fmtDate, fmtNum, fmtRelative } from '@/lib/adminFormat';
import { accountHref } from './accounts';
import { Field } from '@/admin/ui';
import { ProductBadges } from './bits';
import { useProsRefresh, useSupportOverview, type SupportGrant } from './data';

const isOpen = (g: SupportGrant) => !g.revoked_at && (!g.expires_at || new Date(g.expires_at) > new Date());

export default function SupportPage() {
  const { t, lang } = useAdminT();
  const q = useSupportOverview();
  const refresh = useProsRefresh();
  const grants = q.data?.grants ?? [];
  const active = grants.filter((g) => g.status === 'active' && isOpen(g));
  const pending = grants.filter((g) => g.status === 'pending' && isOpen(g));
  const live = grants.filter((g) => g.live_until && new Date(g.live_until) > new Date());
  const items = [
    { value: 'active', label: t('adm.pros.sup.active'), count: active.length },
    { value: 'pending', label: t('adm.pros.sup.pending'), count: pending.length },
    { value: 'all', label: t('adm.pros.sup.all') },
    { value: 'log', label: t('adm.pros.sup.log') },
  ];
  const [tab, setTab] = useTab(items);
  const [ask, setAsk] = useState(false);
  const [target, setTarget] = useState('');

  const columns = useMemo<ColumnDef<SupportGrant, unknown>[]>(() => [
    {
      id: 'name', header: t('adm.pros.col.account'), accessorFn: (g) => g.name,
      cell: ({ row: { original: g } }) => (
        <div className="min-w-0">
          <Link className="a-t1 truncate font-medium hover:underline" to={accountHref(g.key)} onClick={(e) => e.stopPropagation()}>{g.name}</Link>
          <div className="a-t3 mt-0.5 flex gap-2 text-[12px]">{t(`adm.pros.type.${g.type}`)} <ProductBadges products={g.products} /></div>
        </div>
      ),
    },
    {
      id: 'status', header: t('adm.pros.col.status'), accessorKey: 'status',
      cell: ({ row: { original: g } }) => {
        const s = g.revoked_at ? 'revoked' : !isOpen(g) ? 'expired' : g.status;
        return <Status tone={s === 'active' ? 'positive' : s === 'pending' ? 'warning' : 'neutral'}>{t(`adm.pros.sl.grant.${s}`)}</Status>;
      },
    },
    { id: 'reason', header: t('adm.pros.sup.reason'), accessorKey: 'reason', cell: ({ row: { original: g } }) => <span className="a-t2 line-clamp-2 text-[12.5px]">{g.reason ?? '—'}</span> },
    {
      id: 'live', header: t('adm.pros.sup.sessions'), accessorKey: 'sessions', meta: { align: 'right' },
      cell: ({ row: { original: g } }) => (
        <span className="inline-flex items-center gap-2">
          {g.live_until && new Date(g.live_until) > new Date() && <Badge tone="accent">{t('adm.pros.sup.live')}</Badge>}
          <span className="a-num">{fmtNum(g.sessions, lang)}</span>
        </span>
      ),
    },
    { id: 'at', header: t('adm.pros.sup.asked'), accessorFn: (g) => new Date(g.created_at).getTime(), cell: ({ row: { original: g } }) => <span className="a-t2 text-[12.5px]" title={fmtDate(g.created_at, lang, 'datetime')}>{fmtRelative(g.created_at, lang)}</span> },
  ], [t, lang]);

  const data = tab === 'active' ? active : tab === 'pending' ? pending : grants;
  const accounts = q.data?.accounts ?? [];
  const picked = accounts.find((a) => a.key === target);

  return (
    <Page title={t('adm.pros.sup.title')} subtitle={t('adm.pros.sup.sub')}
      actions={<button type="button" className="a-btn a-btn--primary" onClick={() => setAsk(true)}>{t('adm.pros.g.support')}</button>}>
      <KpiRow>
        <Kpi label={t('adm.pros.sup.active')} value={fmtNum(active.length, lang)} loading={q.isLoading} />
        <Kpi label={t('adm.pros.sup.pending')} value={fmtNum(pending.length, lang)} loading={q.isLoading} />
        <Kpi label={t('adm.pros.sup.liveNow')} value={fmtNum(live.length, lang)} loading={q.isLoading} />
      </KpiRow>
      <Tabs items={items} value={tab} onChange={setTab} />
      {tab === 'log' ? (
        <div className="a-card p-4">
          <Timeline empty={t('adm.pros.sup.noLog')} items={(q.data?.log ?? []).map((l, i) => ({
            id: String(i), at: l.at, tone: l.by_admin ? 'accent' as const : 'neutral' as const,
            title: <span><Link className="hover:underline" to={accountHref(l.key)}>{l.name}</Link> · {l.action}{l.table ? ` · ${l.table}` : ''}</span>,
            actor: t(l.by_admin ? 'adm.pros.sup.byAdmin' : 'adm.pros.sup.byPro'),
          }))} />
        </div>
      ) : (
        <DataTable data={data} columns={columns} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} searchable
          getRowId={(g) => g.id} rowHref={(g) => accountHref(g.key)} initialSort={[{ id: 'at', desc: true }]}
          empty={{ title: t('adm.pros.sup.empty') }} />
      )}

      <ReasonDialog open={ask} onOpenChange={(v) => { setAsk(v); if (!v) setTarget(''); }}
        title={t('adm.pros.g.support')} description={t('adm.pros.sup.askBody')} confirmLabel={t('adm.pros.g.supportSend')}
        onConfirm={async (reason) => {
          if (!picked) throw new Error(t('adm.pros.sup.pickFirst'));
          const crmOnly = !picked.products.includes('tickets');
          const { data: d, error } = await supabase.functions.invoke('admin-account-recovery', { body: { action: 'request-support-access', userId: picked.owner_id, reason, ...(crmOnly ? { product: 'crm' } : {}) } });
          if (error || (d as { error?: string } | null)?.error) throw new Error((d as { error?: string } | null)?.error ?? error?.message ?? 'error');
          toast.success(t((d as { already_active?: boolean } | null)?.already_active ? 'adm.pros.g.supportAlready' : 'adm.pros.g.supportSent'));
          void refresh();
        }}>
        <Field label={t('adm.pros.col.account')}>
          <select className="a-input" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">{t('adm.pros.sup.pick')}</option>
            {accounts.map((a) => <option key={a.key} value={a.key}>{a.name}{a.owner_email ? ` (${a.owner_email})` : ''}</option>)}
          </select>
        </Field>
      </ReasonDialog>
    </Page>
  );
}
