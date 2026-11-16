/**
 * Argent › Commandes : « Qui a acheté quoi, et que faut-il rembourser ? ».
 * Une liste paginée côté serveur (admin_orders_list), la démo suit
 * l'interrupteur GLOBAL de la coquille. Une commande s'ouvre par l'adresse
 * (`?open=ticket:<id>` | `?open=table:<id>`), ce qui permet à ⌘K d'y mener.
 * Rembourser passe par `owner-refund` (super admin autorisé, journal d'audit)
 * derrière un ReasonDialog. Le bar (pilier en pause) n'a pas d'onglet.
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import {
  Badge, DataTable, Drawer, ErrorState, KeyValue, Kpi, KpiRow, Page, ReasonDialog, Tabs, useAdminFilters, useAdminT, useTab,
  type ColumnDef, type Tone,
} from '@/admin/ui';
import { supabase } from '@/integrations/supabase/client';
import { fmtDate, fmtEur, fmtNum, fmtPct } from '@/lib/adminFormat';
import { ORDERS_PAGE_SIZE, refundSale, useOrders, type OrderKind, type OrderRow } from './data';
import { parseOpen } from './orderLink';
import { TextLink } from '../pilotage/links';
import { personHref } from '../pilotage/format';

const STATUS_TONE: Record<string, Tone> = {
  paid: 'positive', confirmed: 'positive', used: 'positive', entered: 'positive', served: 'positive',
  refunded: 'negative', cancelled: 'negative', failed: 'negative', pending: 'warning', registered: 'neutral',
};

export default function OrdersPage() {
  const { t, lang } = useAdminT();
  const { includeDemo } = useAdminFilters();
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const tabs = [
    { value: 'tickets', label: t('adm.mon.ord.tab.tickets') },
    { value: 'tables', label: t('adm.mon.ord.tab.tables') },
    { value: 'guestlist', label: t('adm.mon.ord.tab.guestlist') },
  ];
  const [tab, setTabRaw] = useTab(tabs);
  const kind = tab as OrderKind;
  const isGuest = kind === 'guestlist';
  const status = sp.get('status') ?? 'all';
  const [search, setSearch] = useState(sp.get('q') ?? '');
  const [debounced, setDebounced] = useState(search);
  const [page, setPage] = useState(0);
  useEffect(() => { const h = setTimeout(() => setDebounced(search.trim()), 300); return () => clearTimeout(h); }, [search]);
  useEffect(() => { setPage(0); }, [kind, debounced, status, includeDemo]);

  const setParam = (k: string, v: string | null) => setSp((prev) => {
    const n = new URLSearchParams(prev); if (v == null || v === '' || v === 'all') n.delete(k); else n.set(k, v); return n;
  }, { replace: true });
  const setTab = (v: string) => { setParam('status', null); setTabRaw(v); };

  const q = useOrders(kind, debounced, status, page, includeDemo);
  const d = q.data;
  const total = d?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / ORDERS_PAGE_SIZE));

  const open = parseOpen(sp.get('open'));
  const [refundRow, setRefundRow] = useState<OrderRow | null>(null);
  const [amount, setAmount] = useState('');

  const statuses = isGuest ? ['all', 'registered', 'entered', 'cancelled'] : ['all', 'paid', 'confirmed', 'pending', 'refunded', 'cancelled'];

  const columns = useMemo<ColumnDef<OrderRow, unknown>[]>(() => {
    const cols: ColumnDef<OrderRow, unknown>[] = [
      { accessorKey: 'created_at', header: t('adm.mon.ord.date'), cell: (c) => fmtDate(c.getValue<string>(), lang, 'datetime') },
      { accessorKey: 'user_email', header: t('adm.mon.ord.buyer'), cell: (c) => {
        const e = c.row.original.user_email;
        return e ? <TextLink to={personHref(e)}>{c.row.original.full_name || e}</TextLink> : '—';
      } },
      { accessorKey: 'event_title', header: t('adm.mon.ord.event'), cell: (c) => c.getValue<string>() ?? '—' },
      { id: 'host', accessorFn: (r) => r.host_name ?? r.venue_name, header: t('adm.mon.ord.host'), cell: (c) => c.getValue<string>() ?? '—' },
    ];
    if (isGuest) {
      cols.push({ accessorKey: 'part_label', header: t('adm.mon.ord.part'), cell: (c) => c.getValue<string>() ?? '—' });
    } else {
      cols.push(
        { accessorKey: 'amount', header: t('adm.mon.ord.paid'), meta: { align: 'right' }, cell: (c) => fmtEur(c.getValue<number>(), lang) },
        { accessorKey: 'club_gross', header: t('adm.mon.ord.clubRevenue'), meta: { align: 'right' }, cell: (c) => fmtEur(c.getValue<number>(), lang) },
      );
    }
    cols.push({ accessorKey: 'status', header: t('adm.mon.ord.status'), cell: (c) => {
      const s = c.getValue<string>();
      return <Badge tone={STATUS_TONE[s] ?? 'neutral'}>{statusLabel(t, s)}</Badge>;
    } });
    return cols;
  }, [t, lang, isGuest]);

  const openRow = (r: OrderRow) => { if (!isGuest) setParam('open', `${kind === 'tickets' ? 'ticket' : 'table'}:${r.id}`); };

  return (
    <Page title={t('adm.mon.ord.title')} subtitle={t('adm.mon.ord.sub')}>
      <KpiRow>
        <Kpi label={t(isGuest ? 'adm.mon.ord.signups' : 'adm.mon.ord.count')} loading={!d} value={fmtNum(isGuest ? d?.signups ?? d?.total : d?.total, lang)} />
        {isGuest ? (
          <>
            <Kpi label={t('adm.mon.ord.entered')} loading={!d} value={fmtNum(d?.entered, lang)} />
            <Kpi label={t('adm.mon.ord.showRate')} hint={t('adm.mon.ord.showRate.hint')} loading={!d}
              value={d && (d.signups ?? 0) >= 10 ? fmtPct(((d.entered ?? 0) / (d.signups ?? 1)) * 100) : '—'} />
          </>
        ) : (
          <>
            <Kpi label={t('adm.mon.ord.clubRevenue')} hint={t('adm.mon.ord.clubRevenue.hint')} loading={!d} value={fmtEur(d?.revenue, lang)} />
            <Kpi label={t('adm.mon.ord.refunded')} loading={!d} value={fmtNum(d?.refunds, lang)} />
          </>
        )}
      </KpiRow>
      <p className="a-t3 -mt-3 text-[12px]">{t('adm.mon.ord.allTime')}</p>

      <Tabs items={tabs} value={tab} onChange={setTab} />

      {q.error && !d ? <ErrorState onRetry={() => void q.refetch()} /> : (
        <DataTable data={d?.rows} columns={columns} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}
          pageSize={ORDERS_PAGE_SIZE} onRowClick={isGuest ? undefined : openRow}
          empty={{ title: t('adm.mon.ord.empty') }}
          toolbar={(
            <div className="flex flex-wrap items-center gap-2">
              <input className="a-input" style={{ width: 240 }} value={search} placeholder={t('adm.mon.ord.search')}
                aria-label={t('adm.mon.ord.search')}
                onChange={(e) => { setSearch(e.target.value); setParam('q', e.target.value.trim() || null); }} />
              <select className="a-input" style={{ width: 170 }} value={status} aria-label={t('adm.mon.ord.status')}
                onChange={(e) => setParam('status', e.target.value)}>
                {statuses.map((s) => <option key={s} value={s}>{s === 'all' ? t('adm.mon.ord.allStatuses') : statusLabel(t, s)}</option>)}
              </select>
            </div>
          )} />
      )}
      {total > ORDERS_PAGE_SIZE && (
        <div className="a-t2 flex items-center gap-3 text-[12.5px]">
          <span className="a-num flex-1">{t('adm.mon.ord.page', { page: fmtNum(page + 1, lang), pages: fmtNum(pages, lang), total: fmtNum(total, lang) })}</span>
          <button type="button" className="a-btn a-btn--sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>{t('adm.ui.table.prev')}</button>
          <button type="button" className="a-btn a-btn--sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>{t('adm.ui.table.next')}</button>
        </div>
      )}

      <OrderDrawer open={open} onClose={() => setParam('open', null)}
        onRefund={(row) => { setAmount(String(row.refundable)); setRefundRow({ ...row.row }); }} />

      <ReasonDialog open={!!refundRow} onOpenChange={(v) => { if (!v) setRefundRow(null); }} tone="danger"
        title={t('adm.mon.ord.refundTitle')} description={t('adm.mon.ord.refundDesc')} confirmLabel={t('adm.mon.ord.refundConfirm')}
        onConfirm={async (reason) => {
          if (!refundRow || !open) return;
          const n = Number(amount.replace(',', '.'));
          if (!Number.isFinite(n) || n <= 0) throw new Error(t('adm.mon.ord.badAmount'));
          await refundSale(open.type === 'ticket' ? 'tickets' : 'tables', refundRow.id, n, reason);
          await qc.invalidateQueries({ queryKey: ['admin', 'money'] });
        }}>
        <label className="flex flex-col gap-1.5">
          <span className="a-t1 text-[12.5px] font-medium">{t('adm.mon.ord.refundAmount')}</span>
          <input className="a-input a-num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <span className="a-t3 text-[12px]">{t('adm.mon.ord.refundHint')}</span>
        </label>
      </ReasonDialog>
    </Page>
  );
}

function statusLabel(t: (k: string) => string, s: string): string {
  const k = `adm.mon.ord.st.${s}`;
  const v = t(k);
  return v === k ? s : v;
}

interface SaleDetail {
  row: OrderRow;
  refundable: number;
  items: Array<{ label: string; value: string }>;
}

function OrderDrawer({ open, onClose, onRefund }: { open: ReturnType<typeof parseOpen>; onClose: () => void; onRefund: (d: SaleDetail) => void }) {
  const { t, lang } = useAdminT();
  const q = useQuery({
    queryKey: ['admin', 'money', 'order', open?.type, open?.id],
    enabled: !!open,
    queryFn: async (): Promise<SaleDetail | null> => {
      if (!open) return null;
      const table = open.type === 'ticket' ? 'tickets' : 'table_reservations';
      const { data, error } = await supabase.from(table as never).select('*, events(title, start_at)').eq('id', open.id).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const r = data as Record<string, unknown> & { events?: { title?: string; start_at?: string } | null };
      const paid = Number(r.total_price ?? 0);
      const refunded = Number(r.refund_amount ?? 0);
      const fees = open.type === 'ticket'
        ? Number(r.service_fee ?? 0) + Number(r.insurance_fee ?? 0)
        : Number(r.service_fee ?? 0);
      const row: OrderRow = {
        id: String(r.id), user_email: (r.user_email as string) ?? null, full_name: (r.full_name as string) ?? null,
        venue_id: null, venue_name: null, event_title: r.events?.title ?? null, zone_name: null, amount: paid,
        club_gross: null, status: String(r.status ?? ''), created_at: String(r.created_at ?? ''),
      };
      return {
        row,
        // Plafond indicatif : payé hors frais Yuno, moins le déjà remboursé (owner-refund recalcule et tranche).
        refundable: Math.max(0, Math.round((paid - fees - refunded) * 100) / 100),
        items: [
          { label: t('adm.mon.ord.event'), value: r.events?.title ?? '—' },
          { label: t('adm.mon.ord.buyer'), value: [r.full_name, r.user_email].filter(Boolean).join(' · ') || '—' },
          { label: t('adm.mon.ord.date'), value: fmtDate(String(r.created_at ?? ''), lang, 'datetime') },
          { label: t('adm.mon.ord.status'), value: statusLabel(t, String(r.status ?? '')) },
          { label: t('adm.mon.ord.paid'), value: fmtEur(paid, lang) },
          { label: t('adm.money.term.fees'), value: fmtEur(fees, lang) },
          { label: t('adm.mon.ord.alreadyRefunded'), value: fmtEur(refunded, lang) },
          { label: t('adm.mon.ord.ref'), value: String(r.qr_code ?? r.id) },
        ],
      };
    },
  });
  const d = q.data;
  const canRefund = !!d && ['paid', 'used', 'confirmed'].includes(d.row.status) && d.refundable > 0;
  return (
    <Drawer open={!!open} onOpenChange={(v) => { if (!v) onClose(); }}
      title={open?.type === 'table' ? t('adm.mon.ord.tableTitle') : t('adm.mon.ord.ticketTitle')}
      description={d?.row.event_title ?? undefined}
      actions={canRefund ? (
        <button type="button" className="a-btn a-btn--sm a-btn--danger" onClick={() => onRefund(d)}>
          <RotateCcw className="h-3.5 w-3.5" />{t('adm.mon.ord.refund')}
        </button>
      ) : undefined}>
      {q.error ? <ErrorState onRetry={() => void q.refetch()} /> : !d ? (q.isLoading ? <div className="a-skel h-40" /> : <p className="a-t2 text-[13px]">{t('adm.mon.ord.notFound')}</p>) : (
        <KeyValue items={d.items} />
      )}
    </Drawer>
  );
}
