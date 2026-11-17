/**
 * Argent › Commandes (v3) : un registre. « Qui a acheté quoi, et que faut-il rembourser ? »
 *   - à gauche : la liste dense (date et montants en chiffres mono, statut en
 *     pastille), le pilier et le statut en puces, la recherche ; j / k bougent,
 *     entrée ouvre ;
 *   - à droite : l'aperçu de la commande choisie (acheteur, soirée, vendeur,
 *     paiement, remboursement par ReasonDialog), ouvrable par l'adresse
 *     (`?open=ticket:<id>` | `?open=table:<id>`, ce qui permet à ⌘K d'y mener).
 * Liste paginée côté serveur (admin_orders_list), la démo suit l'interrupteur
 * global. Rembourser passe par `owner-refund` (super admin autorisé, journal
 * d'audit). Le bar (pilier en pause) n'a pas de puce.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Search, X } from 'lucide-react';
import { ErrorState, KeyValue, Page, ReasonDialog, SplitView, useAdminFilters, useAdminT, type Tone, Chips, Status } from '@/admin/ui';
import { supabase } from '@/integrations/supabase/client';
import { fmtDate, fmtEur, fmtNum, fmtPct } from '@/lib/adminFormat';
import { isTyping } from '../shell/keys';
import { ORDERS_PAGE_SIZE, refundSale, useOrders, type OrderKind, type OrderRow } from './data';
import { parseOpen } from './orderLink';
import { TextLink } from '../pilotage/links';
import { personHref } from '../pilotage/format';
import { shareOrNull } from '../pilotage/rules';

const STATUS_TONE: Record<string, Tone> = {
  paid: 'positive', confirmed: 'positive', used: 'positive', entered: 'positive', served: 'positive',
  refunded: 'neutral', cancelled: 'neutral', failed: 'negative', pending: 'warning', registered: 'neutral',
};
const KINDS: OrderKind[] = ['tickets', 'tables', 'guestlist'];

export default function OrdersPage() {
  const { t, lang } = useAdminT();
  const { includeDemo } = useAdminFilters();
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const rawTab = sp.get('tab');
  const kind: OrderKind = KINDS.includes(rawTab as OrderKind) ? (rawTab as OrderKind) : 'tickets';
  const isGuest = kind === 'guestlist';
  const status = sp.get('status') ?? 'all';
  const [search, setSearch] = useState(sp.get('q') ?? '');
  const [debounced, setDebounced] = useState(search);
  const [page, setPage] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => { const h = setTimeout(() => setDebounced(search.trim()), 300); return () => clearTimeout(h); }, [search]);
  useEffect(() => { setPage(0); }, [kind, debounced, status, includeDemo]);

  const setParams = (patch: Record<string, string | null>) => setSp((prev) => {
    const n = new URLSearchParams(prev);
    Object.entries(patch).forEach(([k, v]) => { if (v == null || v === '' || v === 'all' || (k === 'tab' && v === 'tickets')) n.delete(k); else n.set(k, v); });
    return n;
  }, { replace: true });

  const q = useOrders(kind, debounced, status, page, includeDemo);
  const d = q.data;
  const rows = useMemo(() => d?.rows ?? [], [d]);
  const total = d?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / ORDERS_PAGE_SIZE));

  const open = parseOpen(sp.get('open'));
  const openType = kind === 'tickets' ? 'ticket' : 'table';
  const selectedId = open?.id ?? picked;
  const selectedRow = rows.find((r) => r.id === selectedId) ?? null;
  const [refundRow, setRefundRow] = useState<OrderRow | null>(null);
  const [amount, setAmount] = useState('');

  const statuses = isGuest ? ['all', 'registered', 'entered', 'cancelled'] : ['all', 'paid', 'confirmed', 'pending', 'refunded', 'cancelled'];
  const choose = (r: OrderRow) => { if (isGuest) { setPicked(r.id); setParams({ open: null }); } else { setPicked(null); setParams({ open: `${openType}:${r.id}` }); } };

  // j / k dans la liste, Échap ferme l'aperçu.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || rows.length === 0) return;
      const i = rows.findIndex((r) => r.id === selectedId);
      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); choose(rows[Math.min(rows.length - 1, i + 1)]); }
      else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); choose(rows[Math.max(0, i < 0 ? 0 : i - 1)]); }
      else if (e.key === 'Escape') { setPicked(null); setParams({ open: null }); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });

  const summary = !d ? null : isGuest ? (
    t('adm.mon.v3o.sumGuest', {
      n: fmtNum(d.signups ?? d.total, lang), e: fmtNum(d.entered ?? 0, lang),
      pct: (() => { const s = shareOrNull(d.entered ?? 0, d.signups ?? 0); return s == null ? '' : t('adm.mon.v3o.showPct', { pct: fmtPct(s * 100, 0, lang) }); })(),
    })
  ) : t('adm.mon.v3o.sum', { n: fmtNum(d.total, lang), eur: fmtEur(d.revenue, lang, { cents: false }), r: fmtNum(d.refunds, lang) });

  return (
    <Page title={t('adm.mon.ord.title')}>
      <div className="flex flex-col gap-4">
        <p className="a-t2 text-[13.5px]">{summary ?? <span className="a-skel inline-block h-4 w-72" />} <span className="a-t3">{t('adm.mon.ord.allTime')}</span></p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Chips<OrderKind> value={kind} label={t('adm.mon.ord.title')} onChange={(v) => { setPicked(null); setParams({ tab: v, status: null, open: null }); }}
            options={KINDS.map((k) => ({ value: k, label: t(`adm.mon.ord.tab.${k}`) }))} />
          <span aria-hidden className="h-5 border-l" />
          <Chips<string> value={status} label={t('adm.mon.ord.status')} onChange={(v) => setParams({ status: v })}
            options={statuses.map((s) => ({ value: s, label: s === 'all' ? t('adm.mon.ord.allStatuses') : statusLabel(t, s) }))} />
          <label className="relative ml-auto flex items-center">
            <Search className="a-t3 pointer-events-none absolute left-2.5 h-3.5 w-3.5" />
            <input className="a-input" style={{ width: 260, paddingLeft: 30 }} value={search} placeholder={t('adm.mon.ord.search')} aria-label={t('adm.mon.ord.search')}
              onChange={(e) => { setSearch(e.target.value); setParams({ q: e.target.value.trim() || null }); }} />
          </label>
        </div>
      </div>

      <SplitView
        list={q.error && !d ? <ErrorState onRetry={() => void q.refetch()} /> : (
          <div className="flex flex-col">
            <div className="a-kicker grid grid-cols-[6.5rem_minmax(0,1.2fr)_minmax(0,1.4fr)_5.5rem_6.5rem] gap-3 border-b px-2 pb-2">
              <span>{t('adm.mon.ord.date')}</span><span>{t('adm.mon.ord.buyer')}</span><span>{t('adm.mon.ord.event')}</span>
              <span className="text-right">{isGuest ? t('adm.mon.ord.part') : t('adm.mon.ord.paid')}</span><span className="text-right">{t('adm.mon.ord.status')}</span>
            </div>
            {q.isLoading && !d ? Array.from({ length: 8 }, (_, i) => <div key={i} className="a-skel my-1 h-8 w-full" />) : rows.length === 0 ? (
              <p className="a-t2 px-2 py-6 text-[13px]">{t('adm.mon.ord.empty')}</p>
            ) : (
              <ul role="listbox" aria-label={t('adm.mon.ord.title')} style={{ opacity: q.isFetching ? 0.6 : 1 }}>
                {rows.map((r) => {
                  const on = r.id === selectedId;
                  return (
                    <li key={r.id} role="option" aria-selected={on}>
                      <button type="button" onClick={() => choose(r)}
                        className={`a-focus grid w-full grid-cols-[6.5rem_minmax(0,1.2fr)_minmax(0,1.4fr)_5.5rem_6.5rem] items-center gap-3 border-0 border-b bg-transparent px-2 py-1.5 text-left font-[inherit] text-[13px] hover:bg-[var(--a-hover)] ${on ? 'a-row-active' : ''}`}
                        style={{ cursor: 'pointer' }}>
                        <span className="a-mono a-t3 truncate text-[11.5px]">{fmtDate(r.created_at, lang, 'short')}</span>
                        <span className="a-t1 truncate">{r.full_name || r.user_email || '—'}</span>
                        <span className="a-t2 truncate">{r.event_title ?? '—'}{(r.host_name ?? r.venue_name) && <span className="a-t3"> · {r.host_name ?? r.venue_name}</span>}</span>
                        <span className="a-mono a-t1 truncate text-right text-[12px]">{isGuest ? (r.part_label ?? '—') : fmtEur(r.amount, lang)}</span>
                        <span className="flex justify-end"><Status tone={STATUS_TONE[r.status] ?? 'neutral'}>{statusLabel(t, r.status)}</Status></span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {total > ORDERS_PAGE_SIZE && (
              <div className="a-t2 flex items-center gap-3 pt-3 text-[12.5px]">
                <span className="a-mono flex-1 text-[11.5px]">{t('adm.mon.ord.page', { page: fmtNum(page + 1, lang), pages: fmtNum(pages, lang), total: fmtNum(total, lang) })}</span>
                <button type="button" className="a-btn a-btn--sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>{t('adm.ui.table.prev')}</button>
                <button type="button" className="a-btn a-btn--sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>{t('adm.ui.table.next')}</button>
              </div>
            )}
            <p className="a-mono a-t3 pt-3 text-[11px]">{t('adm.mon.v3o.keys')}</p>
          </div>
        )}
        panel={open ? (
          <OrderPanel open={open} row={selectedRow} onClose={() => setParams({ open: null })}
            onRefund={(det) => { setAmount(String(det.refundable)); setRefundRow({ ...det.row }); }} />
        ) : isGuest && selectedRow ? (
          <GuestPanel row={selectedRow} onClose={() => setPicked(null)} />
        ) : (
          <div className="flex flex-col gap-2 border-t pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
            <span className="a-kicker">{t('adm.mon.v3o.panel')}</span>
            <p className="a-t2 text-[13px]">{isGuest ? t('adm.mon.v3o.pickGuest') : t('adm.mon.v3o.pick')}</p>
          </div>
        )}
      />

      <ReasonDialog open={!!refundRow} onOpenChange={(v) => { if (!v) setRefundRow(null); }} tone="danger"
        title={t('adm.mon.ord.refundTitle')} description={t('adm.mon.ord.refundDesc')} confirmLabel={t('adm.mon.ord.refundConfirm')}
        onConfirm={async (reason) => {
          if (!refundRow || !open) return;
          const v = Number(amount.replace(',', '.'));
          if (!Number.isFinite(v) || v <= 0) throw new Error(t('adm.mon.ord.badAmount'));
          await refundSale(open.type === 'ticket' ? 'tickets' : 'tables', refundRow.id, v, reason);
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
  paid: number;
  fees: number;
  refunded: number;
  ref: string;
  eventAt: string | null;
}

function PanelShell({ title, sub, onClose, children }: { title: string; sub?: string | null; onClose: () => void; children: ReactNode }) {
  const { t } = useAdminT();
  return (
    <div className="flex flex-col gap-5 border-t pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="a-kicker">{title}</span>
          {sub && <h2 className="a-t1 text-[17px] font-semibold leading-snug tracking-[-0.01em]">{sub}</h2>}
        </div>
        <button type="button" className="a-btn a-btn--ghost a-btn--icon" onClick={onClose} aria-label={t('adm.mon.v3o.close')}><X className="h-4 w-4" /></button>
      </div>
      {children}
    </div>
  );
}

function OrderPanel({ open, row, onClose, onRefund }: { open: NonNullable<ReturnType<typeof parseOpen>>; row: OrderRow | null; onClose: () => void; onRefund: (d: SaleDetail) => void }) {
  const { t, lang } = useAdminT();
  const q = useQuery({
    queryKey: ['admin', 'money', 'order', open.type, open.id],
    queryFn: async (): Promise<SaleDetail | null> => {
      const table = open.type === 'ticket' ? 'tickets' : 'table_reservations';
      const { data, error } = await supabase.from(table as never).select('*, events(title, start_at)').eq('id', open.id).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const r = data as Record<string, unknown> & { events?: { title?: string; start_at?: string } | null };
      const paid = Number(r.total_price ?? 0);
      const refunded = Number(r.refund_amount ?? 0);
      const fees = open.type === 'ticket' ? Number(r.service_fee ?? 0) + Number(r.insurance_fee ?? 0) : Number(r.service_fee ?? 0);
      return {
        row: {
          id: String(r.id), user_email: (r.user_email as string) ?? null, full_name: (r.full_name as string) ?? null,
          venue_id: null, venue_name: null, event_title: r.events?.title ?? null, zone_name: null, amount: paid,
          club_gross: null, status: String(r.status ?? ''), created_at: String(r.created_at ?? ''),
        },
        // Plafond indicatif : payé hors frais Yuno, moins le déjà remboursé (owner-refund recalcule et tranche).
        refundable: Math.max(0, Math.round((paid - fees - refunded) * 100) / 100),
        paid, fees, refunded, ref: String(r.qr_code ?? r.id), eventAt: r.events?.start_at ?? null,
      };
    },
  });
  const det = q.data;
  const canRefund = !!det && ['paid', 'used', 'confirmed'].includes(det.row.status) && det.refundable > 0;
  const title = open.type === 'table' ? t('adm.mon.ord.tableTitle') : t('adm.mon.ord.ticketTitle');
  if (q.error) return <PanelShell title={title} onClose={onClose}><ErrorState onRetry={() => void q.refetch()} /></PanelShell>;
  if (!det) return <PanelShell title={title} onClose={onClose}>{q.isLoading ? <div className="a-skel h-48 w-full" /> : <p className="a-t2 text-[13px]">{t('adm.mon.ord.notFound')}</p>}</PanelShell>;
  const email = det.row.user_email;
  return (
    <PanelShell title={title} sub={det.row.event_title} onClose={onClose}>
      <div className="flex flex-wrap items-center gap-3">
        <Status tone={STATUS_TONE[det.row.status] ?? 'neutral'}>{statusLabel(t, det.row.status)}</Status>
        <span className="a-mono a-t3 text-[11px]">{fmtDate(det.row.created_at, lang, 'datetime')}</span>
      </div>
      <div className="flex flex-col gap-1">
        <span className="a-kicker">{t('adm.mon.ord.buyer')}</span>
        {email ? <TextLink to={personHref(email)} className="text-[14px]">{det.row.full_name || email}</TextLink> : <span className="a-t2 text-[13px]">—</span>}
        {email && det.row.full_name && <span className="a-mono a-t3 text-[11.5px]">{email}</span>}
      </div>
      <KeyValue items={[
        { label: t('adm.mon.ord.event'), value: det.row.event_title ?? '—' },
        { label: t('adm.mon.v3o.night'), value: det.eventAt ? fmtDate(det.eventAt, lang, 'datetime') : null },
        { label: t('adm.mon.ord.host'), value: row?.host_name ?? row?.venue_name ?? null },
        { label: t('adm.mon.ord.ref'), value: det.ref, mono: true },
      ].filter((x) => x.value)} />
      <div className="flex flex-col">
        <span className="a-kicker mb-1">{t('adm.mon.v3o.payment')}</span>
        {([
          [t('adm.mon.ord.paid'), det.paid, false],
          [t('adm.money.term.fees'), det.fees, false],
          [t('adm.mon.ord.alreadyRefunded'), det.refunded, true],
        ] as const).map(([l, v, neg]) => (
          <div key={l} className="flex items-baseline gap-3 border-b py-1.5 text-[13px]">
            <span className="a-t2 flex-1">{l}</span>
            <span className="a-mono a-t1 text-[12.5px]">{neg && v > 0 ? `− ${fmtEur(v, lang)}` : fmtEur(v, lang)}</span>
          </div>
        ))}
        <div className="flex items-baseline gap-3 py-1.5 text-[13px]">
          <span className="a-t1 flex-1 font-medium">{t('adm.mon.v3o.refundable')}</span>
          <span className="a-mono a-t1 text-[13px] font-semibold">{fmtEur(det.refundable, lang)}</span>
        </div>
      </div>
      {canRefund ? (
        <button type="button" className="a-btn a-btn--danger self-start" onClick={() => onRefund(det)}>
          <RotateCcw className="h-3.5 w-3.5" />{t('adm.mon.ord.refund')}
        </button>
      ) : <p className="a-t3 text-[12px]">{t('adm.mon.v3o.noRefund')}</p>}
    </PanelShell>
  );
}

function GuestPanel({ row, onClose }: { row: OrderRow; onClose: () => void }) {
  const { t, lang } = useAdminT();
  return (
    <PanelShell title={t('adm.mon.ord.tab.guestlist')} sub={row.event_title} onClose={onClose}>
      <div className="flex flex-wrap items-center gap-3">
        <Status tone={STATUS_TONE[row.status] ?? 'neutral'}>{statusLabel(t, row.status)}</Status>
        <span className="a-mono a-t3 text-[11px]">{fmtDate(row.created_at, lang, 'datetime')}</span>
      </div>
      <div className="flex flex-col gap-1">
        <span className="a-kicker">{t('adm.mon.ord.buyer')}</span>
        {row.user_email ? <TextLink to={personHref(row.user_email)} className="text-[14px]">{row.full_name || row.user_email}</TextLink> : <span className="a-t2 text-[13px]">{row.full_name ?? '—'}</span>}
      </div>
      <KeyValue items={[
        { label: t('adm.mon.ord.host'), value: row.host_name ?? row.venue_name ?? null },
        { label: t('adm.mon.ord.part'), value: row.part_label ?? null },
        { label: t('adm.mon.v3o.night'), value: row.event_start_at ? fmtDate(row.event_start_at, lang, 'datetime') : null },
        { label: t('adm.mon.v3o.scanned'), value: row.scanned_at ? fmtDate(row.scanned_at, lang, 'datetime') : null },
      ].filter((x) => x.value)} />
      <p className="a-t3 text-[12px]">{t('adm.mon.v3o.guestFree')}</p>
    </PanelShell>
  );
}
