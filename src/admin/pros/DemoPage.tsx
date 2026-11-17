/**
 * « Qui regarde une démo ? » (`/admin/pros/demo`).
 * UNE liste de tous les liens d'aperçu, Yuno Tickets et Yuno CRM réunis
 * (demo/data.ts), un tiroir par lien, un seul dialogue « Nouveau lien de
 * démo » qui demande d'abord le produit. L'onglet Vitrines garde les comptes
 * fantômes et les demandes d'activation.
 *
 * Adresse : `?product=tickets|crm` filtre la liste, `?state=all` montre aussi
 * les liens coupés ou expirés, `?open=<id>` ouvre un tiroir, `?new=1` (ou
 * `?invite=<invitation CRM>`) ouvre le dialogue.
 */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { DEMO_ACCOUNTS } from '@/lib/demoSession';
import { fmtDate, fmtNum, fmtRelative } from '@/lib/adminFormat';
import { Badge, Checkbox, DataTable, Kpi, KpiRow, Page, Status, Tabs, useAdminT, useTab, type ColumnDef } from '@/admin/ui';
import { isLive, signupStage, useDemo, type DemoRow } from './demo/data';
import { LinkDrawer } from './demo/LinkDrawer';
import { NewDemoDialog, type DemoProduct } from './demo/NewDemoDialog';
import { Showcases } from './demo/Showcases';
import { STATE_TONE } from './demo/state';

export default function DemoPage() {
  const { t, lang } = useAdminT();
  const q = useDemo();
  const [sp, setSp] = useSearchParams();
  const d = q.data;
  const items = [
    { value: 'links', label: t('adm.pros.dl.tabLinks'), count: d?.rows.length },
    { value: 'showcases', label: t('adm.pros.dl.tabShowcases'), count: d?.claims.length || undefined },
  ];
  const [tab, setTab] = useTab(items);
  const product = (['tickets', 'crm'] as const).find((p) => p === sp.get('product')) ?? 'all';
  const all = sp.get('state') === 'all';
  const openId = sp.get('open');
  const inviteParam = sp.get('invite');
  const [newOpen, setNewOpen] = useState(sp.get('new') === '1' || !!inviteParam);

  const setParam = (k: string, v: string | null) => setSp((prev) => {
    const n = new URLSearchParams(prev);
    if (v == null) n.delete(k); else n.set(k, v);
    return n;
  }, { replace: true });

  const rows = useMemo(() => (d?.rows ?? []).filter((r) => (product === 'all' || r.products.includes(product)) && (all || isLive(r.state) || r.state === 'created')), [d, product, all]);
  const opened = openId ? d?.rows.find((r) => r.id === openId) ?? null : null;
  const live = (d?.rows ?? []).filter((r) => isLive(r.state));
  const seen = live.filter((r) => r.used_count > 0).length;
  const prepared = (d?.rows ?? []).filter((r) => r.signup && !r.signup.user_id && r.state !== 'cut').length;
  const created = (d?.rows ?? []).filter((r) => r.signup?.user_id).length;

  // La ligne sous le nom : le compte préparé, l'invitation liée, ou le contact.
  const sub = (r: DemoRow) => (r.signup?.org_name ? `${t(`adm.pros.dl.su.${signupStage(r.signup)}`)} · ${r.signup.org_name}`
    : r.crm?.invite ? r.crm.invite.org_name : [r.crm?.contact_name, r.crm?.email].filter(Boolean).join(' · '));

  const columns: ColumnDef<DemoRow, unknown>[] = [
    {
      id: 'who', header: t('adm.pros.dl.col.who'),
      accessorFn: (r) => `${r.label} ${r.crm?.contact_name ?? ''} ${r.crm?.email ?? ''} ${r.signup?.org_name ?? ''} ${r.showcase ?? ''}`,
      cell: ({ row: { original: r } }) => (
        <div className="min-w-0">
          <div className="a-t1 truncate font-medium">{r.label}</div>
          {sub(r) && <div className="a-t3 truncate text-[12px]">{sub(r)}</div>}
        </div>
      ),
    },
    { id: 'product', header: t('adm.pros.col.products'), enableSorting: false, accessorFn: (r) => r.products.join(','), cell: ({ row: { original: r } }) => <span className="inline-flex gap-1">{r.products.map((p) => <Badge key={p} tone={p === 'crm' ? 'accent' : 'neutral'}>{t(`adm.pros.product.${p}`)}</Badge>)}</span> },
    {
      id: 'roles', header: t('adm.pros.dl.col.roles'), enableSorting: false,
      accessorFn: (r) => (r.showcase ? r.showcase : r.targets.map((a) => DEMO_ACCOUNTS[a]?.label ?? a).join(', ')),
      cell: ({ row: { original: r } }) => <span className="a-t2 line-clamp-1 text-[12.5px]">{r.showcase ? t(r.venue_id ? 'adm.pros.dl.showcaseClub' : 'adm.pros.dl.showcaseOrg', { name: r.showcase }) : r.targets.map((a) => DEMO_ACCOUNTS[a]?.label ?? a).join(', ')}</span>,
    },
    { id: 'lang', header: t('adm.pros.dl.col.lang'), accessorKey: 'language', cell: ({ row: { original: r } }) => <span className="a-mono a-t2 text-[12px]">{r.language.toUpperCase()}</span> },
    {
      id: 'opens', header: t('adm.pros.dl.col.opens'), accessorKey: 'used_count', meta: { align: 'right' },
      cell: ({ row: { original: r } }) => (
        <span title={r.last_used_at ? fmtDate(r.last_used_at, lang, 'datetime') : undefined}>
          {fmtNum(r.used_count, lang)}{r.last_used_at && <span className="a-t3 ml-1.5 text-[12px]">{fmtRelative(r.last_used_at, lang)}</span>}
        </span>
      ),
    },
    { id: 'exp', header: t('adm.pros.dl.col.expires'), accessorFn: (r) => (r.expires_at ? new Date(r.expires_at).getTime() : Number.MAX_SAFE_INTEGER), cell: ({ row: { original: r } }) => <span className="a-t2 a-num text-[12.5px]">{r.expires_at ? fmtDate(r.expires_at, lang) : t('adm.pros.dl.noExpiry')}</span> },
    { id: 'state', header: t('adm.pros.col.status'), accessorKey: 'state', cell: ({ row: { original: r } }) => <Status tone={STATE_TONE[r.state]}>{t(`adm.pros.dl.st.${r.state}`)}</Status> },
    { id: 'at', header: t('adm.pros.dl.d.created'), accessorFn: (r) => new Date(r.created_at).getTime(), cell: ({ row: { original: r } }) => <span className="a-t3 text-[12.5px]">{fmtRelative(r.created_at, lang)}</span> },
  ];

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <select className="a-input a-input--filter" value={product} aria-label={t('adm.pros.col.products')}
        onChange={(e) => setParam('product', e.target.value === 'all' ? null : e.target.value)}>
        <option value="all">{t('adm.pros.dl.allProducts')}</option>
        <option value="tickets">{t('adm.pros.product.tickets')}</option>
        <option value="crm">{t('adm.pros.product.crm')}</option>
      </select>
      <Checkbox checked={all} onChange={(v) => setParam('state', v ? 'all' : null)}>{t('adm.pros.dl.showClosed')}</Checkbox>
    </div>
  );

  return (
    <Page title={t('adm.pros.demo.title')} subtitle={t('adm.pros.dl.sub')}
      actions={<button type="button" className="a-btn a-btn--primary" onClick={() => setNewOpen(true)}><Plus className="h-4 w-4" />{t('adm.pros.dl.new')}</button>}>
      <KpiRow>
        <Kpi label={t('adm.pros.dl.k.live')} value={fmtNum(live.length, lang)} loading={q.isLoading} hint={t('adm.pros.dl.k.liveHint')} />
        <Kpi label={t('adm.pros.dl.k.seen')} value={fmtNum(seen, lang)} loading={q.isLoading} hint={t('adm.pros.dl.k.seenHint')} />
        <Kpi label={t('adm.pros.dl.k.prepared')} value={fmtNum(prepared, lang)} loading={q.isLoading} hint={t('adm.pros.dl.k.preparedHint')} />
        <Kpi label={t('adm.pros.dl.k.created')} value={fmtNum(created, lang)} loading={q.isLoading} hint={t('adm.pros.dl.k.createdHint')} />
      </KpiRow>
      <Tabs items={items} value={tab} onChange={setTab} />
      {tab === 'showcases' ? (
        <Showcases d={d} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <DataTable data={rows} columns={columns} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} searchable
          searchPlaceholder={t('adm.pros.dl.search')} getRowId={(r) => r.id} initialSort={[{ id: 'at', desc: true }]}
          onRowClick={(r) => setParam('open', r.id)} toolbar={toolbar}
          empty={{ title: t(all ? 'adm.pros.dl.empty' : 'adm.pros.dl.emptyLive'), action: <button type="button" className="a-btn a-btn--sm" onClick={() => setNewOpen(true)}>{t('adm.pros.dl.new')}</button> }} />
      )}
      {opened && <LinkDrawer key={opened.id} row={opened} onClose={() => setParam('open', null)} />}
      {d && (
        <NewDemoDialog open={newOpen} showcaseVenues={d.showcaseVenues} showcaseOrgs={d.showcaseOrgs} crmInvites={d.crmInvites}
          initialProduct={product === 'crm' ? 'crm' as DemoProduct : undefined} initialInvite={inviteParam}
          onOpenChange={(v) => { setNewOpen(v); if (!v) setSp((prev) => { const n = new URLSearchParams(prev); n.delete('new'); n.delete('invite'); return n; }, { replace: true }); }}
          onCreated={(id) => setParam('open', id)} />
      )}
    </Page>
  );
}
