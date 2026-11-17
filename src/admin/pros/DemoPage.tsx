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
import { fmtDate, fmtNum, fmtPct, fmtRelative } from '@/lib/adminFormat';
import { Checkbox, DataTable, FunnelSteps, Hero, Page, Status, Tabs, useAdminT, useTab, type ColumnDef, Spine, type SpineItem } from '@/admin/ui';
import { ProductBadges } from './bits';
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

  const allRows = d?.rows ?? [];
  const funnel = [
    { key: 'made', label: t('adm.pros.v3.demo.f.made'), value: allRows.length, display: fmtNum(allRows.length, lang) },
    { key: 'open', label: t('adm.pros.v3.demo.f.open'), value: allRows.filter((r) => r.used_count > 0).length, display: fmtNum(allRows.filter((r) => r.used_count > 0).length, lang) },
    { key: 'prep', label: t('adm.pros.v3.demo.f.prep'), value: allRows.filter((r) => r.signup).length, display: fmtNum(allRows.filter((r) => r.signup).length, lang) },
    { key: 'acc', label: t('adm.pros.v3.demo.f.acc'), value: created, display: fmtNum(created, lang) },
  ];
  const recent: SpineItem[] = allRows.filter((r) => r.last_used_at).map((r) => ({
    id: r.id, at: r.last_used_at as string, family: r.products[0] ?? 'tickets',
    title: <button type="button" className="a-t1 border-0 bg-transparent p-0 text-left hover:underline" onClick={() => setParam('open', r.id)}>{r.label}</button>,
    value: t('adm.pros.v3.demo.opens', { n: fmtNum(r.used_count, lang) }),
  }));

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
    { id: 'product', header: t('adm.pros.col.products'), enableSorting: false, accessorFn: (r) => r.products.join(','), cell: ({ row: { original: r } }) => <ProductBadges products={r.products} /> },
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
      <Hero kicker={t('adm.pros.dl.k.live')} loading={q.isLoading} value={fmtNum(live.length, lang)}
        sentence={q.isLoading ? null : (
          <>
            {live.length === 0 ? t('adm.pros.v3.demo.none') : <><b>{fmtNum(live.length, lang)}</b> {t(live.length === 1 ? 'adm.pros.v3.demo.liveOne' : 'adm.pros.v3.demo.live')}{', '}<b>{fmtNum(seen, lang)}</b> {t('adm.pros.v3.demo.seen')}</>}
            {'. '}<b>{fmtNum(created, lang)}</b> {t(created === 1 ? 'adm.pros.v3.demo.createdOne' : 'adm.pros.v3.demo.created')}{prepared > 0 ? <>, <b>{fmtNum(prepared, lang)}</b> {t('adm.pros.v3.demo.prepared')}</> : null}.
          </>
        )}
        chart={q.isLoading || funnel[0].value === 0 ? undefined : (
          <FunnelSteps steps={funnel} fmtShare={(r) => fmtPct(r * 100, 0, lang)} lossLabel={(lost, share) => t('adm.pros.v3.demo.loss', { n: lost, pct: share })} />
        )}
        aside={(
          <section className="flex flex-col gap-3">
            <h2 className="a-kicker">{t('adm.pros.v3.demo.recent')}</h2>
            <Spine items={recent} limit={8} familyLabel={(f) => t(`adm.pros.product.${f}`)} empty={t('adm.pros.v3.demo.noOpen')}
              familyColor={() => 'var(--a-text-2)'} />
          </section>
        )} />
      <div className="flex flex-col gap-3 border-t pt-4">
        <Tabs items={items} value={tab} onChange={setTab} />
        {tab === 'showcases' ? (
          <Showcases d={d} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <DataTable data={rows} columns={columns} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} searchable
            searchPlaceholder={t('adm.pros.dl.search')} getRowId={(r) => r.id} initialSort={[{ id: 'at', desc: true }]}
            onRowClick={(r) => setParam('open', r.id)} toolbar={toolbar} selectedId={opened?.id ?? null}
            empty={{ title: t(all ? 'adm.pros.dl.empty' : 'adm.pros.dl.emptyLive'), action: <button type="button" className="a-btn a-btn--sm" onClick={() => setNewOpen(true)}>{t('adm.pros.dl.new')}</button> }} />
        )}
      </div>
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
