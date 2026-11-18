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
import { Badge, DataTable, Hero, Page, ReasonDialog, Status, Tabs, useAdminT, useTab, type ColumnDef, Spine, type SpineItem } from '@/admin/ui';
import { fmtDate, fmtNum, fmtRelative } from '@/lib/adminFormat';
import { accountHref } from './accounts';
import { Field } from '@/admin/ui';
import { ProductBadges } from './bits';
import { useProsRefresh, useSupportOverview, type SupportGrant } from './data';

const isOpen = (g: SupportGrant) => !g.revoked_at && (!g.expires_at || new Date(g.expires_at) > new Date());

// Un accès accordé qui ne sert plus (aucune session depuis 14 jours) est à couper : l'aide est finie.
const DORMANT_MS = 14 * 86400e3;
const isDormant = (g: SupportGrant) => g.status === 'active' && isOpen(g) && !(g.live_until && new Date(g.live_until) > new Date())
  && Date.now() - new Date(g.last_session_at ?? g.approved_at ?? g.created_at).getTime() > DORMANT_MS;

export default function SupportPage() {
  const { t, lang, label } = useAdminT();
  const q = useSupportOverview();
  const refresh = useProsRefresh();
  const grants = q.data?.grants ?? [];
  const active = grants.filter((g) => g.status === 'active' && isOpen(g));
  const pending = grants.filter((g) => g.status === 'pending' && isOpen(g));
  const live = grants.filter((g) => g.live_until && new Date(g.live_until) > new Date());
  const dormant = grants.filter(isDormant);
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
    {
      id: 'last', header: t('adm.pros.sup.lastUse'), accessorFn: (g) => (g.last_session_at ? new Date(g.last_session_at).getTime() : 0),
      cell: ({ row: { original: g } }) => (
        <span className="text-[12.5px]" style={{ color: isDormant(g) ? 'var(--a-warn)' : undefined }}>
          {g.last_session_at ? fmtRelative(g.last_session_at, lang) : t('adm.pros.sup.never')}{isDormant(g) ? ` · ${t('adm.pros.sup.toCut')}` : ''}
        </span>
      ),
    },
    { id: 'at', header: t('adm.pros.sup.asked'), accessorFn: (g) => new Date(g.created_at).getTime(), cell: ({ row: { original: g } }) => <span className="a-t2 text-[12.5px]" title={fmtDate(g.created_at, lang, 'datetime')}>{fmtRelative(g.created_at, lang)}</span> },
  ], [t, lang]);

  const data = tab === 'active' ? active : tab === 'pending' ? pending : grants;
  const accounts = q.data?.accounts ?? [];
  const picked = accounts.find((a) => a.key === target);

  const logItems: SpineItem[] = (q.data?.log ?? []).map((l, i) => ({
    id: String(i), at: l.at, family: l.by_admin ? 'admin' : 'pro', strong: l.by_admin,
    title: <><Link className="hover:underline" to={accountHref(l.key)}>{l.name}</Link> <span className="a-mono a-t3 text-[11.5px]">{label(l.action)}</span></>,
  }));
  const sentence = q.isLoading ? null : (
    <>
      {live.length === 0 ? t('adm.pros.v3.sup.noLive') : <><b>{fmtNum(live.length, lang)}</b> {t(live.length === 1 ? 'adm.pros.v3.sup.liveOne' : 'adm.pros.v3.sup.live')}</>}
      {'. '}<b>{fmtNum(active.length, lang)}</b> {t('adm.pros.v3.sup.granted')}, <b>{fmtNum(pending.length, lang)}</b> {t('adm.pros.v3.sup.waiting')}.
      {dormant.length > 0 && <> {t('adm.pros.sup.dormant', { n: fmtNum(dormant.length, lang), c: dormant.length })}</>}
    </>
  );

  return (
    <Page title={t('adm.pros.sup.title')} subtitle={t('adm.pros.sup.sub')}
      actions={<button type="button" className="a-btn a-btn--primary" onClick={() => setAsk(true)}>{t('adm.pros.g.support')}</button>}>
      <Hero kicker={t('adm.pros.sup.liveNow')} loading={q.isLoading} value={fmtNum(live.length, lang)} sentence={sentence}
        chart={live.length === 0 ? undefined : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {live.map((g) => (
              <li key={g.id} className="a-card flex flex-col gap-1.5 p-4" style={{ borderColor: 'var(--a-accent)' }}>
                <div className="flex items-center gap-2">
                  <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: 'var(--a-accent)' }} />
                  <Link className="a-t1 truncate text-[14px] font-medium hover:underline" to={accountHref(g.key)}>{g.name}</Link>
                </div>
                <span className="a-mono a-t3 text-[11px]">{t('adm.pros.v3.sup.until', { when: g.live_until ? fmtDate(g.live_until, lang, 'time') : '—' })}</span>
                {g.reason && <span className="a-t2 line-clamp-2 text-[12.5px]">{g.reason}</span>}
              </li>
            ))}
          </ul>
        )} />

      <div className="grid grid-cols-1 gap-x-10 gap-y-8 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-3">
          <Tabs items={items.filter((i) => i.value !== 'log')} value={tab === 'log' ? 'active' : tab} onChange={setTab} />
          <DataTable data={data} columns={columns} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} searchable
            getRowId={(g) => g.id} rowHref={(g) => accountHref(g.key)} initialSort={[{ id: 'at', desc: true }]}
            empty={{ title: t('adm.pros.sup.empty') }} />
        </div>
        <aside className="flex min-w-0 flex-col gap-3 xl:border-l xl:pl-8">
          <h2 className="a-t1 border-b pb-2 text-[14px] font-semibold">{t('adm.pros.sup.log')}</h2>
          <Spine items={logItems} limit={30} familyLabel={(f) => t(f === 'admin' ? 'adm.pros.sup.byAdmin' : 'adm.pros.sup.byPro')}
            familyColor={(f) => (f === 'admin' ? 'var(--a-text)' : 'var(--a-text-3)')} empty={t('adm.pros.sup.noLog')} />
        </aside>
      </div>

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
