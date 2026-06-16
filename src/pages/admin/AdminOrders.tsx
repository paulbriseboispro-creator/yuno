import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Pagination, PaginationContent, PaginationItem, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { Search, Wine, Ticket, Armchair, RefreshCw, ShoppingCart, TrendingUp, RotateCcw, X, type LucideIcon } from 'lucide-react';
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
function StatusPill({ status }: { status: string }) {
  const pos = status === 'paid' || status === 'confirmed' || status === 'served';
  const neg = status === 'refunded' || status === 'cancelled';
  const tone = pos
    ? { color: POS, background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)' }
    : neg
    ? { color: NEG, background: 'rgba(255,92,99,0.1)', border: '1px solid rgba(255,92,99,0.25)' }
    : { color: T3, background: C_FAINT, border: `1px solid ${BORDER}` };
  return (
    <span style={{ ...tone, fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 999, textTransform: 'capitalize', display: 'inline-block' }}>
      {status}
    </span>
  );
}

export default function AdminOrders() {
  const { t } = useLanguage();
  const [tab, setTab] = useState('drinks');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [data, setData] = useState<any[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [venues, setVenues] = useState<Record<string, string>>({});
  const [kpis, setKpis] = useState({ total: 0, revenue: 0, refunds: 0 });
  const [refundRow, setRefundRow] = useState<any | null>(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [refunding, setRefunding] = useState(false);

  // drinks tab → 'order' ; tickets → 'ticket' ; tables → 'table_reservation'
  const refundType = tab === 'drinks' ? 'order' : tab === 'tickets' ? 'ticket' : 'table_reservation';

  const openRefund = (row: any) => {
    setRefundRow(row);
    setRefundAmount(String(row.total ?? row.total_price ?? 0));
    setRefundReason('');
  };

  const submitRefund = async () => {
    if (!refundRow) return;
    const amount = Number(refundAmount);
    if (!amount || amount <= 0) { toast.error('Montant invalide'); return; }
    if (!refundReason.trim()) { toast.error('La raison est obligatoire'); return; }
    setRefunding(true);
    try {
      const { data, error } = await supabase.functions.invoke('owner-refund', {
        body: { items: [{ type: refundType, id: refundRow.id, amount }], reason: refundReason.trim() },
      });
      if (error) throw error;
      const result = data?.results?.[0];
      if (result && !result.success) throw new Error(result.error || 'Échec du remboursement');
      toast.success(`Remboursement de ${(result?.amount ?? amount).toFixed(2)} € effectué`);
      setRefundRow(null);
      load();
    } catch (err: any) {
      toast.error(err.message || 'Erreur — la fonction owner-refund doit être déployée (cap 402).');
    } finally {
      setRefunding(false);
    }
  };

  useEffect(() => {
    supabase.from('venues').select('id, name').then(({ data }) => {
      if (data) setVenues(Object.fromEntries(data.map(v => [v.id, v.name])));
    });
  }, []);

  // Load KPIs once per tab change
  useEffect(() => {
    const loadKpis = async () => {
      if (tab === 'drinks') {
        const [{ count: total }, { count: refunds }] = await Promise.all([
          supabase.from('orders').select('id', { count: 'exact', head: true }),
          supabase.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'refunded'),
        ]);
        const { data: revData } = await supabase.from('orders').select('total').in('status', ['paid', 'confirmed', 'served']);
        const revenue = (revData || []).reduce((sum, o) => sum + (o.total || 0), 0);
        setKpis({ total: total ?? 0, revenue, refunds: refunds ?? 0 });
      } else if (tab === 'tickets') {
        const [{ count: total }, { count: refunds }] = await Promise.all([
          supabase.from('tickets').select('id', { count: 'exact', head: true }),
          supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('status', 'refunded'),
        ]);
        const { data: revData } = await supabase.from('tickets').select('total_price').in('status', ['paid', 'confirmed']);
        const revenue = (revData || []).reduce((sum, o) => sum + (o.total_price || 0), 0);
        setKpis({ total: total ?? 0, revenue, refunds: refunds ?? 0 });
      } else {
        const [{ count: total }, { count: refunds }] = await Promise.all([
          supabase.from('table_reservations').select('id', { count: 'exact', head: true }),
          supabase.from('table_reservations').select('id', { count: 'exact', head: true }).eq('status', 'refunded'),
        ]);
        const { data: revData } = await supabase.from('table_reservations').select('total_price').in('status', ['paid', 'confirmed']);
        const revenue = (revData || []).reduce((sum, o) => sum + (o.total_price || 0), 0);
        setKpis({ total: total ?? 0, revenue, refunds: refunds ?? 0 });
      }
    };
    loadKpis();
  }, [tab]);

  const load = useCallback(async () => {
    setLoading(true);

    if (tab === 'drinks') {
      let query = supabase.from('orders').select('id, user_email, venue_id, total, status, created_at, items', { count: 'exact' });
      if (search) query = query.ilike('user_email', `%${search}%`);
      if (statusFilter !== 'all') query = query.eq('status', statusFilter);
      const { data, count } = await query.order('created_at', { ascending: false }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      setData(data || []);
      setCount(count ?? 0);
    } else if (tab === 'tickets') {
      let query = supabase.from('tickets').select('id, user_email, event_id, total_price, status, created_at, full_name', { count: 'exact' });
      if (search) query = query.ilike('user_email', `%${search}%`);
      if (statusFilter !== 'all') query = query.eq('status', statusFilter);
      const { data: ticketData, count } = await query.order('created_at', { ascending: false }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      if (ticketData && ticketData.length > 0) {
        const eventIds = [...new Set(ticketData.map(t => t.event_id))];
        const { data: evts } = await supabase.from('events').select('id, title, venue_id').in('id', eventIds);
        const evtMap = Object.fromEntries((evts || []).map(e => [e.id, e]));
        setData(ticketData.map(t => ({ ...t, eventTitle: evtMap[t.event_id]?.title, venue_id: evtMap[t.event_id]?.venue_id })));
      } else {
        setData([]);
      }
      setCount(count ?? 0);
    } else {
      let query = supabase.from('table_reservations').select('id, user_email, full_name, zone_id, total_price, status, created_at, event_id', { count: 'exact' });
      if (search) query = query.ilike('user_email', `%${search}%`);
      if (statusFilter !== 'all') query = query.eq('status', statusFilter);
      const { data: tableData, count } = await query.order('created_at', { ascending: false }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      if (tableData && tableData.length > 0) {
        const zoneIds = [...new Set(tableData.map(t => t.zone_id))];
        const { data: zones } = await supabase.from('table_zones').select('id, name, venue_id').in('id', zoneIds);
        const zoneMap = Object.fromEntries((zones || []).map(z => [z.id, z]));
        setData(tableData.map(t => ({ ...t, zoneName: zoneMap[t.zone_id]?.name, venue_id: zoneMap[t.zone_id]?.venue_id })));
      } else {
        setData([]);
      }
      setCount(count ?? 0);
    }

    setLoading(false);
  }, [tab, search, statusFilter, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(0); }, [tab, search, statusFilter]);

  const totalPages = Math.ceil(count / PAGE_SIZE);

  const kpiCards = useMemo(() => [
    { label: t('admin.orders.totalTransactions'), value: kpis.total.toLocaleString(), icon: ShoppingCart, highlight: false, tone: undefined as 'pos' | 'neg' | undefined },
    { label: t('admin.orders.totalRevenue'), value: fmtEur(kpis.revenue), icon: TrendingUp, highlight: true, tone: undefined as 'pos' | 'neg' | undefined },
    { label: t('admin.orders.totalRefunds'), value: kpis.refunds.toLocaleString(), icon: RotateCcw, highlight: false, tone: (kpis.refunds > 0 ? 'neg' : undefined) as 'pos' | 'neg' | undefined },
  ], [kpis, t]);

  const tabs: { key: string; label: string; icon: LucideIcon }[] = [
    { key: 'drinks', label: t('admin.orders.drinks'), icon: Wine },
    { key: 'tickets', label: t('admin.orders.tickets'), icon: Ticket },
    { key: 'tables', label: t('admin.orders.tables'), icon: Armchair },
  ];

  const statusOptions = [
    { value: 'all', label: t('admin.orders.allStatuses') },
    { value: 'paid', label: t('admin.orders.paid') },
    { value: 'confirmed', label: t('admin.orders.confirmed') },
    { value: 'pending', label: t('admin.orders.pending') },
    { value: 'served', label: t('admin.orders.served') },
    { value: 'refunded', label: t('admin.orders.refunded') },
    { value: 'cancelled', label: t('admin.orders.cancelled') },
  ];

  const colCount = 6 + (tab === 'tickets' || tab === 'tables' ? 1 : 0) + (tab === 'tickets' || tab === 'tables' ? 1 : 0);

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
            <input placeholder={t('admin.orders.searchEmail')} value={search} onChange={(e) => setSearch(e.target.value)} style={inputStyle} />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={selectStyle}>
            {statusOptions.map(o => <option key={o.value} value={o.value} style={{ background: '#0a0a0c', color: T1 }}>{o.label}</option>)}
          </select>
          <button
            onClick={load}
            className="inline-flex items-center justify-center rounded-xl cursor-pointer transition-all duration-150"
            style={{ width: 38, height: 38, background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <span style={{ color: T3, fontSize: 13 }} className="tabular-nums">{count} {t('admin.orders.results')}</span>
        </div>

        {/* Table */}
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, overflow: 'hidden' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]" style={{ minWidth: 640 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${F_BORDER}` }}>
                  <th className="px-4 py-3 text-left font-medium" style={{ color: T3, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('admin.orders.email')}</th>
                  {(tab === 'tickets' || tab === 'tables') && <th className="px-4 py-3 text-left font-medium" style={{ color: T3, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('admin.orders.name')}</th>}
                  <th className="px-4 py-3 text-left font-medium" style={{ color: T3, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('admin.orders.venue')}</th>
                  {tab === 'tickets' && <th className="px-4 py-3 text-left font-medium" style={{ color: T3, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('admin.orders.event')}</th>}
                  {tab === 'tables' && <th className="px-4 py-3 text-left font-medium" style={{ color: T3, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('admin.orders.zone')}</th>}
                  <th className="px-4 py-3 text-right font-medium" style={{ color: T3, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('admin.orders.amount')}</th>
                  <th className="px-4 py-3 text-left font-medium" style={{ color: T3, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('admin.orders.status')}</th>
                  <th className="px-4 py-3 text-left font-medium" style={{ color: T3, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('admin.orders.date')}</th>
                  <th className="px-4 py-3 text-right font-medium" style={{ color: T3, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={colCount} className="text-center py-10">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 mx-auto mb-2" style={{ borderColor: `${BORDER} ${BORDER} ${BORDER} ${RED}` }} />
                    <span style={{ color: T3, fontSize: 12 }}>{t('admin.orders.loading')}</span>
                  </td></tr>
                ) : data.length === 0 ? (
                  <tr><td colSpan={colCount} className="text-center py-12">
                    <ShoppingCart className="h-9 w-9 mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.12)' }} />
                    <span style={{ color: T3, fontSize: 12 }}>{t('admin.orders.noResults')}</span>
                  </td></tr>
                ) : data.map((item, index) => (
                  <tr key={item.id} style={{ borderBottom: index < data.length - 1 ? `1px solid ${F_BORDER}` : 'none' }}>
                    <td className="px-4 py-3 max-w-[180px] truncate" style={{ color: T1 }}>{item.user_email || '—'}</td>
                    {(tab === 'tickets' || tab === 'tables') && <td className="px-4 py-3" style={{ color: T2 }}>{item.full_name || '—'}</td>}
                    <td className="px-4 py-3" style={{ color: T2 }}>{venues[item.venue_id] || '—'}</td>
                    {tab === 'tickets' && <td className="px-4 py-3" style={{ color: T2 }}>{item.eventTitle || '—'}</td>}
                    {tab === 'tables' && <td className="px-4 py-3" style={{ color: T2 }}>{item.zoneName || '—'}</td>}
                    <td className="px-4 py-3 text-right tabular-nums font-[620]" style={{ color: T1 }}>{fmtEur(item.total || item.total_price || 0)}</td>
                    <td className="px-4 py-3"><StatusPill status={item.status} /></td>
                    <td className="px-4 py-3 tabular-nums" style={{ color: T3 }}>{format(new Date(item.created_at), 'dd/MM/yy HH:mm')}</td>
                    <td className="px-4 py-3 text-right">
                      {['paid', 'confirmed', 'served'].includes(item.status) ? (
                        <button
                          onClick={() => openRefund(item)}
                          className="inline-flex items-center gap-1.5 rounded-lg cursor-pointer transition-all"
                          style={{ padding: '5px 10px', background: 'rgba(255,92,99,0.1)', border: '1px solid rgba(255,92,99,0.28)', color: NEG, fontSize: 12, fontWeight: 600 }}
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> Rembourser
                        </button>
                      ) : (
                        <span style={{ color: T3, fontSize: 12 }}>—</span>
                      )}
                    </td>
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
                <h2 style={{ color: T1, fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>Rembourser</h2>
                <p style={{ color: T3, fontSize: 12.5, marginTop: 2 }}>{refundRow.user_email || '—'} · {venues[refundRow.venue_id] || '—'}</p>
              </div>
              <button onClick={() => !refunding && setRefundRow(null)} className="p-1 rounded-lg cursor-pointer" style={{ color: T3 }}>
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="rounded-xl p-3 mb-4" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
              <p style={{ color: T3, fontSize: 11.5 }}>Montant payé</p>
              <p className="tabular-nums" style={{ color: T1, fontSize: 18, fontWeight: 640 }}>{fmtEur(refundRow.total ?? refundRow.total_price ?? 0)}</p>
            </div>

            <label style={{ color: T2, fontSize: 12.5, fontWeight: 560, display: 'block', marginBottom: 6 }}>Montant à rembourser (€)</label>
            <input
              type="number" step="0.01" min="0"
              value={refundAmount}
              onChange={(e) => setRefundAmount(e.target.value)}
              style={{ ...inputStyle, paddingLeft: 12, marginBottom: 14 }}
            />

            <label style={{ color: T2, fontSize: 12.5, fontWeight: 560, display: 'block', marginBottom: 6 }}>Raison (obligatoire)</label>
            <textarea
              value={refundReason}
              onChange={(e) => setRefundReason(e.target.value)}
              rows={3}
              placeholder="Ex : événement annulé, double paiement…"
              style={{ ...inputStyle, paddingLeft: 12, resize: 'vertical' }}
            />

            <p style={{ color: T3, fontSize: 11.5, marginTop: 10, lineHeight: 1.5 }}>
              Stripe rembourse au client et inverse le transfert au club. Le montant est plafonné côté serveur à (payé − frais de service Yuno).
            </p>

            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setRefundRow(null)}
                disabled={refunding}
                className="flex-1 rounded-xl cursor-pointer transition-all"
                style={{ padding: '10px', background: INNER_BG, border: `1px solid ${BORDER}`, color: T2, fontSize: 13, fontWeight: 560 }}
              >
                Annuler
              </button>
              <button
                onClick={submitRefund}
                disabled={refunding}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl cursor-pointer transition-all"
                style={{ padding: '10px', background: RED, border: '1px solid rgba(232,25,44,0.6)', color: '#fff', fontSize: 13, fontWeight: 600, opacity: refunding ? 0.6 : 1 }}
              >
                <RotateCcw className="h-4 w-4" /> {refunding ? 'Traitement…' : 'Confirmer le remboursement'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
