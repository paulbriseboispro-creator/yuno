import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Pagination, PaginationContent, PaginationItem, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { Search, Wine, Ticket, Armchair, UserCheck, RefreshCw, ShoppingCart, TrendingUp, RotateCcw, DoorOpen, XCircle, X, FlaskConical, type LucideIcon } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED         = '#E8192C';
const POS         = '#34D399';
const NEG         = '#FF5C63';
const T1          = 'rgba(255,255,255,0.96)';
const T2          = 'rgba(255,255,255,0.58)';
const T3          = 'rgba(255,255,255,0.36)';
const C_FAINT     = 'rgba(255,255,255,0.06)';
const BORDER      = 'rgba(255,255,255,0.085)';
const F_BORDER    = 'rgba(255,255,255,0.055)';
const INNER_BG    = 'rgba(255,255,255,0.032)';
const CARD_BG     = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

// Une ligne, quel que soit l'onglet : `admin_orders_list` normalise les trois
// tables (commande, billet, réservation) sous cette forme, libellés résolus
// côté serveur.
interface OrderRow {
  id: string;
  user_email: string | null;
  full_name: string | null;
  venue_id: string | null;
  venue_name: string | null;
  event_title: string | null;
  zone_name: string | null;
  amount: number;
  status: string;
  created_at: string;
  items: unknown;
  // Guest list seulement : une inscription ne se paie pas, elle se rattache à
  // un hôte (club OU organisateur), à une part et à un type d'entrée.
  host_name?: string | null;
  part_label?: string | null;
  holder_type?: string | null;
  entry_type?: string | null;
  event_start_at?: string | null;
  scanned_at?: string | null;
}

const PAGE_SIZE = 25;

const fmtEur = (n: number) => `${(n || 0).toFixed(2)} €`;

const inputStyle: React.CSSProperties = {
  background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10,
  color: T1, fontSize: 13, padding: '9px 12px 9px 34px', width: '100%', outline: 'none',
};

const selectStyle: React.CSSProperties = {
  background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10,
  color: T1, fontSize: 13, padding: '9px 12px', outline: 'none', cursor: 'pointer', minWidth: 160,
};

// ─── Status pill ──────────────────────────────────────────────────────────────
function StatusPill({ status, label }: { status: string; label?: string }) {
  const pos = status === 'paid' || status === 'confirmed' || status === 'served' || status === 'entered';
  const neg = status === 'refunded' || status === 'cancelled';
  const tone = pos
    ? { color: POS, background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)' }
    : neg
    ? { color: NEG, background: 'rgba(255,92,99,0.1)', border: '1px solid rgba(255,92,99,0.25)' }
    : { color: T3, background: C_FAINT, border: `1px solid ${BORDER}` };
  return (
    <span style={{ ...tone, fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 999, textTransform: 'capitalize', display: 'inline-block' }}>
      {label || status}
    </span>
  );
}

export default function AdminOrders() {
  const { t } = useLanguage();
  const [tab, setTab] = useState('drinks');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [data, setData] = useState<OrderRow[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [venues, setVenues] = useState<Record<string, string>>({});
  const [kpis, setKpis] = useState({ total: 0, revenue: 0, refunds: 0, entered: 0, signups: 0 });
  const [includeDemo, setIncludeDemo] = useState(false);
  const [refundRow, setRefundRow] = useState<OrderRow | null>(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [refunding, setRefunding] = useState(false);

  // La guest list est le seul pilier sans argent : pas de montant, pas de
  // remboursement, et des compteurs qui parlent de gens plutôt que d'euros.
  const isGuest = tab === 'guestlist';

  // drinks tab → 'order' ; tickets → 'ticket' ; tables → 'table_reservation'
  const refundType = tab === 'drinks' ? 'order' : tab === 'tickets' ? 'ticket' : 'table_reservation';

  const openRefund = (row: OrderRow) => {
    setRefundRow(row);
    setRefundAmount(String(row.amount ?? 0));
    setRefundReason('');
  };

  const submitRefund = async () => {
    if (!refundRow) return;
    const amount = Number(refundAmount);
    if (!amount || amount <= 0) { toast.error(t('adm.orders.invalidAmount')); return; }
    if (!refundReason.trim()) { toast.error(t('adm.orders.reasonRequired')); return; }
    setRefunding(true);
    try {
      const { data, error } = await supabase.functions.invoke('owner-refund', {
        body: { items: [{ type: refundType, id: refundRow.id, amount }], reason: refundReason.trim() },
      });
      if (error) throw error;
      const result = data?.results?.[0];
      if (result && !result.success) throw new Error(result.error || t('adm.orders.refundFailed'));
      toast.success(t('adm.orders.refunded').replace('{v}', fmtEur(result?.amount ?? amount)));
      setRefundRow(null);
      load();
    } catch (err) {
      toast.error((err as Error)?.message || t('adm.orders.refundUnavailable'));
    } finally {
      setRefunding(false);
    }
  };

  // Recherche débouncée : un appel serveur par pause de frappe, pas par touche.
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => { const id = window.setTimeout(() => setDebouncedSearch(search), 300); return () => clearTimeout(id); }, [search]);

  // Liste ET compteurs viennent du même appel serveur. La démo est exclue par
  // défaut : au 08/09 les 1 210 commandes, 2 616 billets et 84 réservations de
  // cet écran venaient toutes du seed démo et de Stripe test. Le bouton
  // « Démo » les rouvre — elles restent consultables, elles ne sont plus
  // comptées comme du réel.
  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('admin_orders_list', {
      p_kind: tab,
      p_search: debouncedSearch || null,
      p_status: statusFilter === 'all' ? null : statusFilter,
      p_limit: PAGE_SIZE,
      p_offset: page * PAGE_SIZE,
      p_include_demo: includeDemo,
    });
    if (error) console.error('[AdminOrders] list error', error);
    const payload = data as unknown as
      { total: number; revenue: number; refunds: number; entered?: number; signups?: number; rows: OrderRow[] } | null;
    setData(payload?.rows ?? []);
    setCount(payload?.total ?? 0);
    setKpis({
      total: payload?.total ?? 0,
      revenue: Number(payload?.revenue ?? 0),
      refunds: payload?.refunds ?? 0,
      entered: payload?.entered ?? 0,
      // `signups` ignore le filtre de statut : c'est le dénominateur du taux
      // de présence, il ne doit pas fondre quand on isole les entrées.
      signups: payload?.signups ?? payload?.total ?? 0,
    });
    setLoading(false);
  }, [tab, debouncedSearch, statusFilter, page, includeDemo]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(0); }, [tab, debouncedSearch, statusFilter, includeDemo]);
  // Les états d'une guest list (inscrit / entré / annulé) ne sont pas ceux d'une
  // vente : garder le filtre en changeant d'onglet renverrait une liste vide.
  useEffect(() => { setStatusFilter('all'); }, [tab]);

  const totalPages = Math.ceil(count / PAGE_SIZE);

  // Sur la guest list le chiffre qui décide n'est pas un euro, c'est le taux de
  // présence : combien d'inscrits sont vraiment passés à la porte.
  const showRate = kpis.signups > 0 ? Math.round((kpis.entered / kpis.signups) * 100) : 0;

  const kpiCards = useMemo(() => (isGuest ? [
    { label: t('adm.orders.gl.signups'), value: kpis.signups.toLocaleString(), sub: undefined as string | undefined, icon: UserCheck, highlight: false, tone: undefined as 'pos' | 'neg' | undefined },
    { label: t('adm.orders.gl.entered'), value: kpis.entered.toLocaleString(), sub: t('adm.orders.gl.showRate').replace('{v}', `${showRate} %`), icon: DoorOpen, highlight: true, tone: undefined as 'pos' | 'neg' | undefined },
    { label: t('adm.orders.gl.cancelled'), value: kpis.refunds.toLocaleString(), sub: undefined as string | undefined, icon: XCircle, highlight: false, tone: (kpis.refunds > 0 ? 'neg' : undefined) as 'pos' | 'neg' | undefined },
  ] : [
    { label: t('admin.orders.totalTransactions'), value: kpis.total.toLocaleString(), sub: undefined as string | undefined, icon: ShoppingCart, highlight: false, tone: undefined as 'pos' | 'neg' | undefined },
    { label: t('admin.orders.totalRevenue'), value: fmtEur(kpis.revenue), sub: undefined as string | undefined, icon: TrendingUp, highlight: true, tone: undefined as 'pos' | 'neg' | undefined },
    { label: t('admin.orders.totalRefunds'), value: kpis.refunds.toLocaleString(), sub: undefined as string | undefined, icon: RotateCcw, highlight: false, tone: (kpis.refunds > 0 ? 'neg' : undefined) as 'pos' | 'neg' | undefined },
  ]), [kpis, t, isGuest, showRate]);

  const tabs: { key: string; label: string; icon: LucideIcon }[] = [
    { key: 'drinks', label: t('admin.orders.drinks'), icon: Wine },
    { key: 'tickets', label: t('admin.orders.tickets'), icon: Ticket },
    { key: 'tables', label: t('admin.orders.tables'), icon: Armchair },
    { key: 'guestlist', label: t('adm.orders.guestlist'), icon: UserCheck },
  ];

  const statusOptions = isGuest ? [
    { value: 'all', label: t('admin.orders.allStatuses') },
    { value: 'registered', label: t('owner.gl.st.registered') },
    { value: 'entered', label: t('owner.gl.st.entered') },
    { value: 'cancelled', label: t('owner.gl.st.cancelled') },
  ] : [
    { value: 'all', label: t('admin.orders.allStatuses') },
    { value: 'paid', label: t('admin.orders.paid') },
    { value: 'confirmed', label: t('admin.orders.confirmed') },
    { value: 'pending', label: t('admin.orders.pending') },
    { value: 'served', label: t('admin.orders.served') },
    { value: 'refunded', label: t('admin.orders.refunded') },
    { value: 'cancelled', label: t('admin.orders.cancelled') },
  ];

  // Une colonne par pilier plutôt qu'une cascade de ternaires : quatre onglets
  // ne partagent plus assez de colonnes pour que l'inline reste lisible.
  const columns = useMemo<{ key: string; label: string; align?: 'right'; cell: (r: OrderRow) => ReactNode }[]>(() => {
    const glType = (r: OrderRow) => {
      const ty = r.entry_type || 'normal';
      const key = `owner.gl.type.${ty}`;
      const label = t(key);
      return label === key ? ty : label;
    };
    const glPart = (r: OrderRow) => {
      if (r.part_label) return r.part_label;
      // La part maison n'est pas « Club » : une soirée d'organisateur en a une aussi.
      if (r.holder_type === 'club') return t('guestList.holderType.house');
      return r.holder_type ? t(`guestList.holderType.${r.holder_type}`) : '—';
    };
    const cols: { key: string; label: string; align?: 'right'; cell: (r: OrderRow) => ReactNode }[] = [
      { key: 'email', label: t('admin.orders.email'), cell: r => <span style={{ color: T1 }}>{r.user_email || '—'}</span> },
    ];
    if (tab !== 'drinks') cols.push({ key: 'name', label: t('admin.orders.name'), cell: r => r.full_name || '—' });
    cols.push({
      key: 'venue',
      label: isGuest ? t('adm.orders.gl.host') : t('admin.orders.venue'),
      cell: r => (isGuest ? r.host_name : r.venue_name) || venues[r.venue_id] || '—',
    });
    if (tab === 'tickets' || isGuest) cols.push({ key: 'event', label: t('admin.orders.event'), cell: r => r.event_title || '—' });
    if (tab === 'tables') cols.push({ key: 'zone', label: t('admin.orders.zone'), cell: r => r.zone_name || '—' });
    if (isGuest) {
      cols.push({ key: 'part', label: t('adm.orders.gl.part'), cell: glPart });
      cols.push({ key: 'type', label: t('adm.orders.gl.type'), cell: glType });
    } else {
      cols.push({ key: 'amount', label: t('admin.orders.amount'), align: 'right', cell: r => <span className="tabular-nums font-[620]" style={{ color: T1 }}>{fmtEur(r.amount ?? 0)}</span> });
    }
    cols.push({
      key: 'status',
      label: t('admin.orders.status'),
      cell: r => <StatusPill status={r.status} label={isGuest ? t(`owner.gl.st.${r.status}`) : undefined} />,
    });
    cols.push({
      key: 'date',
      label: t('admin.orders.date'),
      cell: r => <span className="tabular-nums" style={{ color: T3 }}>{format(new Date(r.created_at), 'dd/MM/yy HH:mm')}</span>,
    });
    if (!isGuest) {
      cols.push({
        key: 'action',
        label: '',
        align: 'right',
        cell: r => ['paid', 'confirmed', 'served'].includes(r.status) ? (
          <button
            onClick={() => openRefund(r)}
            className="inline-flex items-center gap-1.5 rounded-lg cursor-pointer transition-all"
            style={{ padding: '5px 10px', background: 'rgba(255,92,99,0.1)', border: '1px solid rgba(255,92,99,0.28)', color: NEG, fontSize: 12, fontWeight: 600 }}
          >
            <RotateCcw className="h-3.5 w-3.5" /> {t('adm.orders.refund')}
          </button>
        ) : <span style={{ color: T3, fontSize: 12 }}>—</span>,
      });
    }
    return cols;
  }, [tab, isGuest, t, venues]);

  return (
    <div className="min-h-screen pb-16" style={{ background: '#000' }}>
      <div className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(232,25,44,.05),transparent 55%)' }} />

      <div className="relative z-10 mx-auto max-w-[1340px] px-4 sm:px-6 py-6 space-y-6">
        {/* Header */}
        <div>
          <h1 style={{ color: T1, fontSize: 'clamp(22px,3vw,28px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1 }}>
            {t('admin.orders.title')}
          </h1>
          <p style={{ color: T3, fontSize: 13, marginTop: 4 }}>{t('admin.orders.subtitle')}</p>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {kpiCards.map((kpi) => {
            const valueColor = kpi.tone === 'neg' ? NEG : kpi.tone === 'pos' ? POS : kpi.highlight ? RED : T1;
            return (
              <div
                key={kpi.label}
                style={{
                  background: kpi.highlight
                    ? 'linear-gradient(135deg,rgba(232,25,44,0.14),rgba(232,25,44,0.035)),#0a0a0c'
                    : CARD_BG,
                  border: `1px solid ${kpi.highlight ? 'rgba(232,25,44,0.24)' : BORDER}`,
                  borderRadius: 16,
                  boxShadow: CARD_SHADOW,
                  padding: '16px 18px',
                }}
                className="flex items-center gap-3"
              >
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-xl flex-none"
                  style={{ background: kpi.highlight ? 'rgba(232,25,44,0.12)' : C_FAINT, border: `1px solid ${kpi.highlight ? 'rgba(232,25,44,0.2)' : F_BORDER}` }}
                >
                  <kpi.icon className="h-5 w-5" style={{ color: kpi.highlight ? RED : T2 }} />
                </div>
                <div>
                  <p style={{ color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{kpi.label}</p>
                  <p className="tabular-nums" style={{ color: valueColor, fontSize: 20, fontWeight: 640, letterSpacing: '-0.02em', marginTop: 3 }}>{kpi.value}</p>
                  {kpi.sub && <p style={{ color: T3, fontSize: 11.5, marginTop: 1 }}>{kpi.sub}</p>}
                </div>
              </div>
            );
          })}
        </div>

        {/* Tab bar */}
        <div className="flex gap-0.5" style={{ borderBottom: `1px solid ${BORDER}` }}>
          {tabs.map(tabItem => {
            const Icon = tabItem.icon;
            const isActive = tab === tabItem.key;
            return (
              <button
                key={tabItem.key}
                onClick={() => setTab(tabItem.key)}
                className="relative inline-flex items-center gap-2 px-4 py-3 text-[13.5px] font-[560] transition-colors duration-150 cursor-pointer"
                style={{ color: isActive ? T1 : T3, background: 'transparent', border: 'none' }}
              >
                <Icon className="w-4 h-4" />
                <span>{tabItem.label}</span>
                {isActive && (
                  <span className="absolute left-3 right-3 rounded-full" style={{ bottom: -1, height: 2, background: RED, boxShadow: '0 0 10px rgba(232,25,44,0.6)' }} />
                )}
              </button>
            );
          })}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: T3 }} />
            <input placeholder={isGuest ? t('adm.orders.gl.searchPh') : t('admin.orders.searchEmail')} value={search} onChange={(e) => setSearch(e.target.value)} style={inputStyle} />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={selectStyle}>
            {statusOptions.map(o => <option key={o.value} value={o.value} style={{ background: '#0a0a0c', color: T1 }}>{o.label}</option>)}
          </select>
          {/* La démo reste consultable, elle n'est simplement plus comptée. */}
          <button
            onClick={() => setIncludeDemo(v => !v)}
            title={t('admin.orders.demoHint')}
            className="inline-flex items-center gap-1.5 rounded-xl cursor-pointer transition-all duration-150"
            style={includeDemo
              ? { padding: '0 12px', height: 38, background: RED, color: '#fff', border: '1px solid transparent', fontSize: 12.5, fontWeight: 600 }
              : { padding: '0 12px', height: 38, background: INNER_BG, color: T3, border: `1px solid ${BORDER}`, fontSize: 12.5, fontWeight: 600 }}
          >
            <FlaskConical className="h-3.5 w-3.5" />
            {t('admin.orders.demoToggle')}
          </button>
          <button
            onClick={load}
            className="inline-flex items-center justify-center rounded-xl cursor-pointer transition-all duration-150"
            style={{ width: 38, height: 38, background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <span style={{ color: T3, fontSize: 13 }} className="tabular-nums">{count} {t('admin.orders.results')}</span>
          {!includeDemo && (
            <span style={{ color: T3, fontSize: 12 }}>{t('admin.orders.demoExcluded')}</span>
          )}
        </div>

        {/* Table */}
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, overflow: 'hidden' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]" style={{ minWidth: 640 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${F_BORDER}` }}>
                  {columns.map(col => (
                    <th
                      key={col.key}
                      className={`px-4 py-3 font-medium ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                      style={{ color: T3, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={columns.length} className="text-center py-10">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 mx-auto mb-2" style={{ borderColor: `${BORDER} ${BORDER} ${BORDER} ${RED}` }} />
                    <span style={{ color: T3, fontSize: 12 }}>{t('admin.orders.loading')}</span>
                  </td></tr>
                ) : data.length === 0 ? (
                  <tr><td colSpan={columns.length} className="text-center py-12">
                    <ShoppingCart className="h-9 w-9 mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.12)' }} />
                    <span style={{ color: T3, fontSize: 12 }}>{t('admin.orders.noResults')}</span>
                  </td></tr>
                ) : data.map((item, index) => (
                  <tr key={item.id} style={{ borderBottom: index < data.length - 1 ? `1px solid ${F_BORDER}` : 'none' }}>
                    {columns.map(col => (
                      <td
                        key={col.key}
                        className={`px-4 py-3 ${col.align === 'right' ? 'text-right' : ''} ${col.key === 'email' ? 'max-w-[180px] truncate' : ''}`}
                        style={{ color: T2 }}
                      >
                        {col.cell(item)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {totalPages > 1 && (
          <Pagination>
            <PaginationContent>
              <PaginationItem><PaginationPrevious onClick={() => setPage(p => Math.max(0, p - 1))} className={page === 0 ? 'pointer-events-none opacity-50' : 'cursor-pointer'} /></PaginationItem>
              <PaginationItem><span className="text-sm px-3 tabular-nums" style={{ color: T3 }}>{page + 1} / {totalPages}</span></PaginationItem>
              <PaginationItem><PaginationNext onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} className={page >= totalPages - 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'} /></PaginationItem>
            </PaginationContent>
          </Pagination>
        )}
      </div>

      {/* Refund modal */}
      {refundRow && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
          onClick={() => !refunding && setRefundRow(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md"
            style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 22 }}
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 style={{ color: T1, fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>{t('adm.orders.refund')}</h2>
                <p style={{ color: T3, fontSize: 12.5, marginTop: 2 }}>{refundRow.user_email || '—'} · {refundRow.venue_name || '—'}</p>
              </div>
              <button onClick={() => !refunding && setRefundRow(null)} className="p-1 rounded-lg cursor-pointer" style={{ color: T3 }}>
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="rounded-xl p-3 mb-4" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
              <p style={{ color: T3, fontSize: 11.5 }}>{t('adm.orders.paidAmount')}</p>
              <p className="tabular-nums" style={{ color: T1, fontSize: 18, fontWeight: 640 }}>{fmtEur(refundRow.amount ?? 0)}</p>
            </div>

            <label style={{ color: T2, fontSize: 12.5, fontWeight: 560, display: 'block', marginBottom: 6 }}>{t('adm.orders.refundAmount')}</label>
            <input
              type="number" step="0.01" min="0"
              value={refundAmount}
              onChange={(e) => setRefundAmount(e.target.value)}
              style={{ ...inputStyle, paddingLeft: 12, marginBottom: 14 }}
            />

            <label style={{ color: T2, fontSize: 12.5, fontWeight: 560, display: 'block', marginBottom: 6 }}>{t('adm.orders.reason')}</label>
            <textarea
              value={refundReason}
              onChange={(e) => setRefundReason(e.target.value)}
              rows={3}
              placeholder={t('adm.orders.reasonPh')}
              style={{ ...inputStyle, paddingLeft: 12, resize: 'vertical' }}
            />

            <p style={{ color: T3, fontSize: 11.5, marginTop: 10, lineHeight: 1.5 }}>
              {t('adm.orders.refundHint')}
            </p>

            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setRefundRow(null)}
                disabled={refunding}
                className="flex-1 rounded-xl cursor-pointer transition-all"
                style={{ padding: '10px', background: INNER_BG, border: `1px solid ${BORDER}`, color: T2, fontSize: 13, fontWeight: 560 }}
              >
                {t('adm.common.cancel')}
              </button>
              <button
                onClick={submitRefund}
                disabled={refunding}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl cursor-pointer transition-all"
                style={{ padding: '10px', background: RED, border: '1px solid rgba(232,25,44,0.6)', color: '#fff', fontSize: 13, fontWeight: 600, opacity: refunding ? 0.6 : 1 }}
              >
                <RotateCcw className="h-4 w-4" /> {refunding ? t('adm.orders.processing') : t('adm.orders.confirmRefund')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
