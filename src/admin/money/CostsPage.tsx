/**
 * Argent › Coûts et marge : « Combien coûte Yuno, et que reste-t-il ? ».
 * Revenu de Yuno par mois (admin_pilot_overview, mêmes chiffres que la vue
 * d'ensemble) − coûts = marge. Les coûts sont SAISIS à la main (admin_costs,
 * motif + journal), sauf l'IA, lue dans ai_usage_events (USD convertis au taux
 * indicatif) tant qu'aucune saisie ne la remplace. Onglet Factures : les
 * numéros émis (admin_invoices_list), les échecs en tête.
 */
import { useMemo, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import {
  Badge, Card, Chart, DataTable, ErrorState, Kpi, KpiRow, Page, ReasonDialog, Section, Tabs, useAdminFilters, useAdminT, useTab,
  type ColumnDef,
} from '@/admin/ui';
import { fmtDate, fmtEur, fmtNum } from '@/lib/adminFormat';
import { COST_ITEMS, margin, moneyLabelKey, monthCosts, yunoRevenue } from './terms';
import { INVOICES_PAGE_SIZE, useCostActions, useCosts, useInvoices, useMoneyIssues, type CostsMonth, type InvoiceRow } from './data';
import { usePilotOverview } from '../pilotage/data';
import { fmtMonth } from '../pilotage/format';
import { TextLink } from '../pilotage/links';
import { proHref } from '../pilotage/format';
import { orderHref } from './orderLink';

interface MarginRow { m: string; revenue: number; costs: number; margin: number; aiFromAuto: boolean; month: CostsMonth | null }

export default function CostsPage() {
  const { t } = useAdminT();
  const tabs = [{ value: 'margin', label: t('adm.mon.cost.tab.margin') }, { value: 'invoices', label: t('adm.mon.cost.tab.invoices') }];
  const [tab, setTab] = useTab(tabs);
  return (
    <Page title={t('adm.mon.cost.title')} subtitle={t('adm.mon.cost.sub')}>
      <Tabs items={tabs} value={tab} onChange={setTab} />
      {tab === 'margin' ? <MarginTab /> : <InvoicesTab />}
    </Page>
  );
}

function MarginTab() {
  const { t, lang } = useAdminT();
  const { range, includeDemo } = useAdminFilters();
  const ov = usePilotOverview(range, includeDemo);
  const cq = useCosts();
  const act = useCostActions();
  const [edit, setEdit] = useState<{ m: string; item: string; amount: string; note: string } | null>(null);
  const [del, setDel] = useState<{ id: string; label: string } | null>(null);

  const rows = useMemo<MarginRow[] | null>(() => {
    if (!ov.data || !cq.data) return null;
    const byMonth = new Map(cq.data.months.map((m) => [m.m, m]));
    return [...ov.data.months].reverse().map((m) => {
      const cm = byMonth.get(m.m) ?? null;
      const c = monthCosts(cm?.lines ?? [], cm?.ai_auto ?? 0);
      const rev = yunoRevenue(m);
      return { m: m.m, revenue: rev, costs: c.total, margin: margin(rev, c.total), aiFromAuto: c.aiFromAuto, month: cm };
    });
  }, [ov.data, cq.data]);

  const chart = useMemo(() => rows ? [...rows].reverse().map((r) => ({ m: r.m, revenue: r.revenue, costs: r.costs })) : null, [rows]);
  const cur = rows?.[0];
  const prev = rows?.[1];

  const columns = useMemo<ColumnDef<MarginRow, unknown>[]>(() => [
    { accessorKey: 'm', header: t('adm.pil.ov.month'), cell: (c) => fmtMonth(c.getValue<string>(), lang) },
    { accessorKey: 'revenue', header: t(moneyLabelKey('yunoRevenue')), meta: { align: 'right' }, cell: (c) => fmtEur(c.getValue<number>(), lang) },
    { id: 'lines', header: t('adm.mon.cost.items'), enableSorting: false, cell: (c) => {
      const m = c.row.original.month;
      return (
        <span className="flex flex-wrap gap-1">
          {(m?.lines ?? []).map((l) => (
            <span key={l.id} className="inline-flex items-center gap-1">
              <Badge>{costItemLabel(t, l.item)} {fmtEur(l.amount, lang)}</Badge>
              <button type="button" className="a-btn a-btn--ghost a-btn--icon" aria-label={t('adm.mon.cost.edit')}
                onClick={(e) => { e.stopPropagation(); setEdit({ m: c.row.original.m, item: l.item, amount: String(l.amount), note: l.note ?? '' }); }}>
                <Pencil className="h-3 w-3" />
              </button>
              <button type="button" className="a-btn a-btn--ghost a-btn--icon" aria-label={t('adm.mon.cost.delete')}
                onClick={(e) => { e.stopPropagation(); setDel({ id: l.id, label: `${costItemLabel(t, l.item)} · ${fmtMonth(c.row.original.m, lang)}` }); }}>
                <Trash2 className="h-3 w-3" />
              </button>
            </span>
          ))}
          {c.row.original.aiFromAuto && (m?.ai_auto ?? 0) > 0 && <Badge tone="accent">{t('adm.mon.cost.aiAuto', { v: fmtEur(m?.ai_auto ?? 0, lang) })}</Badge>}
        </span>
      );
    } },
    { accessorKey: 'costs', header: t(moneyLabelKey('costs')), meta: { align: 'right' }, cell: (c) => fmtEur(c.getValue<number>(), lang) },
    { accessorKey: 'margin', header: t(moneyLabelKey('margin')), meta: { align: 'right' }, cell: (c) => (
      <span style={{ color: c.getValue<number>() < 0 ? 'var(--a-neg)' : undefined }}>{fmtEur(c.getValue<number>(), lang)}</span>
    ) },
    { id: 'add', header: '', enableSorting: false, meta: { align: 'right' }, cell: (c) => (
      <button type="button" className="a-btn a-btn--sm" onClick={(e) => { e.stopPropagation(); setEdit({ m: c.row.original.m, item: 'resend', amount: '', note: '' }); }}>
        {t('adm.mon.cost.add')}
      </button>
    ) },
  ], [t, lang]);

  if ((ov.error || cq.error) && !rows) return <ErrorState onRetry={() => { void ov.refetch(); void cq.refetch(); }} />;

  return (
    <>
      <KpiRow>
        <Kpi label={t('adm.mon.cost.revThisMonth')} loading={!cur} value={fmtEur(cur?.revenue, lang)} current={cur?.revenue} previous={prev?.revenue} to="/admin/pilot" />
        <Kpi label={t('adm.mon.cost.costsThisMonth')} loading={!cur} invert value={fmtEur(cur?.costs, lang)} current={cur?.costs} previous={prev?.costs} to="#costs" />
        <Kpi label={t('adm.mon.cost.marginThisMonth')} loading={!cur} value={fmtEur(cur?.margin, lang)} current={cur?.margin} previous={prev?.margin} to="#costs" />
      </KpiRow>
      <p className="a-t3 -mt-3 text-[12px]">{t('adm.mon.cost.manualNote')}</p>

      <Card title={t('adm.mon.cost.chart')}>
        <Chart kind="bar" data={chart} x="m" unit="eur" loading={!chart} formatX={(v) => fmtMonth(v, lang)}
          series={[
            { key: 'revenue', label: t(moneyLabelKey('yunoRevenue')), color: 'var(--a-chart-1)' },
            { key: 'costs', label: t(moneyLabelKey('costs')), color: 'var(--a-chart-3)' },
          ]} />
      </Card>

      <Section title={t('adm.mon.cost.byMonth')} description={t('adm.mon.cost.byMonthSub')}>
        <div id="costs"><DataTable data={rows} columns={columns} loading={!rows} pageSize={12} /></div>
      </Section>

      <ReasonDialog open={!!edit} onOpenChange={(v) => { if (!v) setEdit(null); }}
        title={t('adm.mon.cost.setTitle', { m: edit ? fmtMonth(edit.m, lang) : '' })} description={t('adm.mon.cost.setDesc')}
        onConfirm={async (reason) => {
          if (!edit) return;
          const n = Number(edit.amount.replace(',', '.'));
          if (!Number.isFinite(n) || n < 0) throw new Error(t('adm.mon.ord.badAmount'));
          await act.set.mutateAsync({ month: edit.m, item: edit.item, amount: n, note: edit.note, reason });
        }}>
        {edit && (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="a-t1 text-[12.5px] font-medium">{t('adm.mon.cost.item')}</span>
              <select className="a-input" value={edit.item} onChange={(e) => setEdit({ ...edit, item: e.target.value })}>
                {COST_ITEMS.map((i) => <option key={i} value={i}>{t(`adm.mon.cost.item.${i}`)}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="a-t1 text-[12.5px] font-medium">{t('adm.mon.cost.amount')}</span>
              <input className="a-input a-num" inputMode="decimal" value={edit.amount} onChange={(e) => setEdit({ ...edit, amount: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="a-t1 text-[12.5px] font-medium">{t('adm.mon.cost.note')}</span>
              <input className="a-input" value={edit.note} maxLength={500} onChange={(e) => setEdit({ ...edit, note: e.target.value })} />
            </label>
          </div>
        )}
      </ReasonDialog>
      <ReasonDialog open={!!del} onOpenChange={(v) => { if (!v) setDel(null); }} tone="danger"
        title={t('adm.mon.cost.deleteTitle')} description={del?.label}
        onConfirm={async (reason) => { if (del) await act.remove.mutateAsync({ id: del.id, reason }); }} />
    </>
  );
}

function InvoicesTab() {
  const { t, lang } = useAdminT();
  const { includeDemo } = useAdminFilters();
  const [page, setPage] = useState(0);
  const q = useInvoices(page, includeDemo);
  const iss = useMoneyIssues(includeDemo);
  const failed = iss.data?.alerts.filter((a) => a.type === 'admin_invoice_failed') ?? [];
  const total = q.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / INVOICES_PAGE_SIZE));

  const columns = useMemo<ColumnDef<InvoiceRow, unknown>[]>(() => [
    { accessorKey: 'number', header: t('adm.mon.inv.number'), cell: (c) => <span className="a-mono text-[12.5px]">{c.getValue<string>()}</span> },
    { accessorKey: 'seller', header: t('adm.mon.inv.seller'), cell: (c) => <TextLink to={proHref(c.row.original.seller_key)}>{c.row.original.seller ?? c.row.original.seller_key}</TextLink> },
    { accessorKey: 'sale_type', header: t('adm.mon.inv.sale'), cell: (c) => {
      const r = c.row.original;
      const label = t(`adm.mon.inv.type.${r.sale_type}`);
      return r.sale_type === 'order' ? label : <TextLink to={orderHref(r.sale_type, r.sale_id)}>{label}</TextLink>;
    } },
    { accessorKey: 'amount', header: t('adm.mon.inv.amount'), meta: { align: 'right' }, cell: (c) => fmtEur(c.getValue<number>(), lang) },
    { accessorKey: 'at', header: t('adm.mon.ord.date'), cell: (c) => fmtDate(c.getValue<string>(), lang, 'datetime') },
  ], [t, lang]);

  return (
    <>
      {failed.length > 0 && (
        <Card title={t('adm.mon.inv.failed', { n: fmtNum(failed.length, lang) })}
          footer={<TextLink to="/admin/money/issues#alerts">{t('adm.mon.inv.toIssues')}</TextLink>}>
          <ul className="flex flex-col gap-1.5 text-[13px]">
            {failed.map((a) => <li key={a.id} className="flex gap-2"><Badge tone="negative">{fmtDate(a.at, lang)}</Badge><span className="a-t1">{a.title}</span><span className="a-t3 truncate">{a.message}</span></li>)}
          </ul>
        </Card>
      )}
      <p className="a-t3 text-[12px]">{t('adm.mon.inv.note')}</p>
      <DataTable data={q.data?.rows} columns={columns} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}
        pageSize={INVOICES_PAGE_SIZE} empty={{ title: t('adm.mon.inv.empty') }} />
      {total > INVOICES_PAGE_SIZE && (
        <div className="a-t2 flex items-center gap-3 text-[12.5px]">
          <span className="a-num flex-1">{t('adm.mon.ord.page', { page: fmtNum(page + 1, lang), pages: fmtNum(pages, lang), total: fmtNum(total, lang) })}</span>
          <button type="button" className="a-btn a-btn--sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>{t('adm.ui.table.prev')}</button>
          <button type="button" className="a-btn a-btn--sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>{t('adm.ui.table.next')}</button>
        </div>
      )}
    </>
  );
}

/** Libellé d'un poste de coût ; un poste inconnu (saisi avant une liste plus courte) garde son nom. */
function costItemLabel(t: (k: string) => string, item: string): string {
  const k = `adm.mon.cost.item.${item}`;
  const v = t(k);
  return v === k ? item : v;
}
