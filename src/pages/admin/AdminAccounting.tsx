import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { orderRevenue as orderClub, ticketRevenue as ticketClub, tableRevenue as tableClub } from '@/utils/fees';
import { useLanguage } from '@/contexts/LanguageContext';
import { Download, Calculator } from 'lucide-react';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { toast } from 'sonner';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED         = '#E8192C';
const POS         = '#34D399';
const T1          = 'rgba(255,255,255,0.96)';
const T2          = 'rgba(255,255,255,0.58)';
const T3          = 'rgba(255,255,255,0.36)';
const C_FAINT     = 'rgba(255,255,255,0.06)';
const BORDER      = 'rgba(255,255,255,0.085)';
const F_BORDER    = 'rgba(255,255,255,0.055)';
const INNER_BG    = 'rgba(255,255,255,0.032)';
const CARD_BG     = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

const selectStyle: React.CSSProperties = {
  background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10,
  color: T1, fontSize: 13, padding: '9px 12px', outline: 'none', cursor: 'pointer',
};

const cardStyle: React.CSSProperties = {
  background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 22, overflow: 'hidden',
};

interface Venue { id: string; name: string; }
interface Commission { id: string; venue_id: string; venue_name?: string; period_start: string; period_end: string; total_revenue: number; commission_rate: number; commission_amount: number; status: string; paid_at: string | null; }
interface VenueRevenue { venue_id: string; venue_name: string; drinkRevenue: number; ticketRevenue: number; tableRevenue: number; totalRevenue: number; yunoFees: number; drinkOrders: number; ticketCount: number; tableCount: number; }

const fmtEur = (n: number) => `${(n || 0).toFixed(2)}€`;

export default function AdminAccounting() {
  const { t, language } = useLanguage();
  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const [venues, setVenues] = useState<Venue[]>([]);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [venueRevenues, setVenueRevenues] = useState<VenueRevenue[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState<string>(format(new Date(), 'yyyy-MM'));

  useEffect(() => { fetchData(); }, [selectedMonth]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data: venuesData } = await supabase.from('venues').select('id, name').order('name');
      setVenues(venuesData || []);

      const { data: commissionsData } = await supabase.from('venue_commissions').select('*').order('period_start', { ascending: false });
      setCommissions((commissionsData || []).map(c => ({ ...c, venue_name: venuesData?.find(v => v.id === c.venue_id)?.name || c.venue_id })));

      const [year, month] = selectedMonth.split('-').map(Number);
      const monthStart = startOfMonth(new Date(year, month - 1)).toISOString();
      const monthEnd = endOfMonth(new Date(year, month - 1)).toISOString();

      // Fetch all 3 revenue sources
      const [ordersRes, ticketsRes, tablesRes, eventsRes, subsRes] = await Promise.all([
        supabase.from('orders').select('venue_id, total, service_fee').in('status', ['paid', 'served']).gte('created_at', monthStart).lte('created_at', monthEnd),
        supabase.from('tickets').select('event_id, total_price, service_fee, insurance_fee').eq('status', 'paid').gte('created_at', monthStart).lte('created_at', monthEnd),
        supabase.from('table_reservations').select('event_id, total_price, service_fee, management_fee').in('status', ['confirmed', 'paid']).gte('created_at', monthStart).lte('created_at', monthEnd),
        supabase.from('events').select('id, venue_id'),
        supabase.from('venue_subscriptions').select('id, venue_id, status').in('status', ['active', 'trialing']),
      ]);

      const eventVenueMap = new Map<string, string>();
      (eventsRes.data || []).forEach(e => eventVenueMap.set(e.id, e.venue_id));

      const venueMap = new Map<string, VenueRevenue>();
      (venuesData || []).forEach(v => venueMap.set(v.id, { venue_id: v.id, venue_name: v.name, drinkRevenue: 0, ticketRevenue: 0, tableRevenue: 0, totalRevenue: 0, yunoFees: 0, drinkOrders: 0, ticketCount: 0, tableCount: 0 }));

      // Club revenue excludes Yuno fees (orderClub/ticketClub/tableClub .gross);
      // yunoFees tracks Yuno's own take separately. Yuno is never in club revenue.
      (ordersRes.data || []).forEach(o => {
        const v = venueMap.get(o.venue_id);
        if (v) { v.drinkRevenue += orderClub(o).gross; v.yunoFees += Number(o.service_fee || 0); v.drinkOrders += 1; }
      });
      (ticketsRes.data || []).forEach(t => {
        const vid = eventVenueMap.get(t.event_id);
        if (vid) { const v = venueMap.get(vid); if (v) { v.ticketRevenue += ticketClub(t).gross; v.yunoFees += Number(t.service_fee || 0) + Number(t.insurance_fee || 0); v.ticketCount += 1; } }
      });
      (tablesRes.data || []).forEach(t => {
        const vid = eventVenueMap.get(t.event_id);
        if (vid) { const v = venueMap.get(vid); if (v) { v.tableRevenue += tableClub(t).gross; v.yunoFees += Number(t.service_fee || 0) + Number(t.management_fee || 0); v.tableCount += 1; } }
      });

      const list = Array.from(venueMap.values()).map(v => ({ ...v, totalRevenue: v.drinkRevenue + v.ticketRevenue + v.tableRevenue })).filter(v => v.totalRevenue > 0).sort((a, b) => b.totalRevenue - a.totalRevenue);
      setVenueRevenues(list);
    } catch (error) { console.error('Error fetching data:', error); }
    finally { setLoading(false); }
  };

  const generateCommissions = async () => {
    try {
      const [year, month] = selectedMonth.split('-').map(Number);
      const periodStart = format(startOfMonth(new Date(year, month - 1)), 'yyyy-MM-dd');
      const periodEnd = format(endOfMonth(new Date(year, month - 1)), 'yyyy-MM-dd');
      const { error } = await supabase.from('venue_commissions').upsert(venueRevenues.map(v => ({
        venue_id: v.venue_id,
        period_start: periodStart,
        period_end: periodEnd,
        total_revenue: v.totalRevenue,
        commission_rate: v.totalRevenue > 0 ? (v.yunoFees / v.totalRevenue) * 100 : 0,
        commission_amount: v.yunoFees,
        status: 'pending',
      })), { onConflict: 'venue_id,period_start', ignoreDuplicates: false });
      if (error) throw error;
      toast.success(t('adminAccounting.generated'));
      fetchData();
    } catch (error: any) { toast.error(error.message || t('adminAccounting.generateError')); }
  };

  const updateCommissionStatus = async (id: string, status: string) => {
    try {
      const updates: any = { status };
      if (status === 'paid') updates.paid_at = new Date().toISOString();
      const { error } = await supabase.from('venue_commissions').update(updates).eq('id', id);
      if (error) throw error;
      toast.success(t('adminAccounting.statusUpdated'));
      fetchData();
    } catch (error: any) { toast.error(error.message || 'Error'); }
  };

  const exportCSV = () => {
    const headers = [t('adminAccounting.club'), t('adminAccounting.period'), t('adminAccounting.drinkRevenue'), t('adminAccounting.ticketRevenue'), t('adminAccounting.tableRevenue'), 'Total', t('adminAccounting.yunoFees'), t('adminAccounting.statusLabel')];
    const rows = venueRevenues.map(v => [v.venue_name, format(new Date(selectedMonth + '-01'), 'MMM yyyy', { locale: dateLocale }), `${v.drinkRevenue.toFixed(2)}€`, `${v.ticketRevenue.toFixed(2)}€`, `${v.tableRevenue.toFixed(2)}€`, `${v.totalRevenue.toFixed(2)}€`, `${v.yunoFees.toFixed(2)}€`, '']);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `commissions-${selectedMonth}.csv`; a.click();
  };

  const totalRevenue = venueRevenues.reduce((s, v) => s + v.totalRevenue, 0);
  const totalYunoFees = venueRevenues.reduce((s, v) => s + v.yunoFees, 0);
  const totalDrinks = venueRevenues.reduce((s, v) => s + v.drinkRevenue, 0);
  const totalTickets = venueRevenues.reduce((s, v) => s + v.ticketRevenue, 0);
  const totalTables = venueRevenues.reduce((s, v) => s + v.tableRevenue, 0);
  const pendingCommissions = commissions.filter(c => c.status === 'pending').reduce((s, c) => s + c.commission_amount, 0);

  const getStatusBadge = (status: string) => {
    const base: React.CSSProperties = { fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 999, display: 'inline-block', textTransform: 'capitalize' };
    switch (status) {
      case 'pending': return <span style={{ ...base, color: T3, background: C_FAINT, border: `1px solid ${BORDER}` }}>{t('adminAccounting.statusPending')}</span>;
      case 'invoiced': return <span style={{ ...base, color: T1, background: 'rgba(255,255,255,0.06)', border: `1px solid ${BORDER}` }}>{t('adminAccounting.statusInvoiced')}</span>;
      case 'paid': return <span style={{ ...base, color: POS, background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)' }}>{t('adminAccounting.statusPaid')}</span>;
      default: return <span style={{ ...base, color: T3, background: C_FAINT, border: `1px solid ${BORDER}` }}>{status}</span>;
    }
  };

  const monthOptions = Array.from({ length: 12 }, (_, i) => {
    const date = subMonths(new Date(), i);
    return { value: format(date, 'yyyy-MM'), label: format(date, 'MMMM yyyy', { locale: dateLocale }) };
  });

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: '#000' }}>
        <div className="h-12 w-12 animate-spin rounded-full border-2" style={{ borderColor: `${BORDER} ${BORDER} ${BORDER} ${RED}` }} />
      </div>
    );
  }

  // KPI tiles — Yuno fees highlighted in RED (the take)
  const kpis: { label: string; value: string; highlight?: boolean; pos?: boolean }[] = [
    { label: t('adminAccounting.monthRevenue'), value: fmtEur(totalRevenue) },
    { label: t('adminAccounting.yunoFees'), value: fmtEur(totalYunoFees), highlight: true },
    { label: t('adminAccounting.drinkRevenue'), value: fmtEur(totalDrinks) },
    { label: t('adminAccounting.ticketRevenue'), value: fmtEur(totalTickets) },
    { label: t('adminAccounting.tableRevenue'), value: fmtEur(totalTables) },
    { label: t('adminAccounting.pending'), value: fmtEur(pendingCommissions), pos: pendingCommissions > 0 },
  ];

  const thStyle: React.CSSProperties = { color: T3, fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' };

  return (
    <div className="min-h-screen pb-16" style={{ background: '#000' }}>
      <div className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(232,25,44,.05),transparent 55%)' }} />

      <div className="relative z-10 mx-auto max-w-[1340px] px-4 sm:px-6 py-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 style={{ color: T1, fontSize: 'clamp(22px,3vw,28px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1 }}>
              {t('adminAccounting.title')}
            </h1>
            <p style={{ color: T3, fontSize: 13, marginTop: 4 }}>{t('adminAccounting.subtitle')}</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            <select value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} style={{ ...selectStyle, width: '100%' }} className="sm:w-[180px]">
              {monthOptions.map(o => <option key={o.value} value={o.value} style={{ background: '#0a0a0c', color: T1 }}>{o.label}</option>)}
            </select>
            <button
              onClick={exportCSV}
              className="inline-flex items-center justify-center gap-2 cursor-pointer transition-all duration-150 w-full sm:w-auto"
              style={{ padding: '9px 14px', borderRadius: 10, background: INNER_BG, border: `1px solid ${BORDER}`, color: T2, fontSize: 12.5, fontWeight: 560 }}
            >
              <Download className="h-4 w-4" />{t('adminAccounting.exportCSV')}
            </button>
          </div>
        </div>

        {/* KPI cards */}
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {kpis.map((kpi) => {
            const valueColor = kpi.highlight ? RED : kpi.pos ? POS : T1;
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
                  padding: '14px 16px',
                }}
              >
                <p style={{ color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{kpi.label}</p>
                <p className="tabular-nums" style={{ color: valueColor, fontSize: 22, fontWeight: 640, letterSpacing: '-0.02em', marginTop: 6 }}>{kpi.value}</p>
              </div>
            );
          })}
        </div>

        {/* Per-venue breakdown */}
        <div style={cardStyle}>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
            <h2 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em' }}>
              {t('adminAccounting.monthRevenueTitle')} — {format(new Date(selectedMonth + '-01'), 'MMMM yyyy', { locale: dateLocale })}
            </h2>
            <button
              onClick={generateCommissions}
              disabled={venueRevenues.length === 0}
              className="inline-flex items-center justify-center gap-2 cursor-pointer transition-all duration-150 w-full sm:w-auto"
              style={{ padding: '9px 14px', borderRadius: 10, background: RED, border: '1px solid rgba(232,25,44,0.6)', color: '#fff', fontSize: 12.5, fontWeight: 600, opacity: venueRevenues.length === 0 ? 0.5 : 1 }}
            >
              <Calculator className="h-4 w-4" />{t('adminAccounting.generateCommissions')}
            </button>
          </div>
          {venueRevenues.length === 0 ? (
            <div className="text-center py-12">
              <Calculator className="h-9 w-9 mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.12)' }} />
              <p style={{ color: T3, fontSize: 12 }}>{t('adminAccounting.noDataMonth')}</p>
            </div>
          ) : (
            <div className="overflow-x-auto -mx-4 sm:-mx-2">
              <div className="px-4 sm:px-2" style={{ minWidth: 700 }}>
                <table className="w-full text-[13px]">
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${F_BORDER}` }}>
                      <th className="px-3 py-2.5 text-left font-medium" style={thStyle}>{t('adminAccounting.club')}</th>
                      <th className="px-3 py-2.5 text-right font-medium" style={thStyle}>{t('adminAccounting.drinkRevenue')}</th>
                      <th className="px-3 py-2.5 text-right font-medium" style={thStyle}>{t('adminAccounting.ticketRevenue')}</th>
                      <th className="px-3 py-2.5 text-right font-medium" style={thStyle}>{t('adminAccounting.tableRevenue')}</th>
                      <th className="px-3 py-2.5 text-right font-medium" style={thStyle}>Total</th>
                      <th className="px-3 py-2.5 text-right font-medium" style={thStyle}>{t('adminAccounting.yunoFees')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {venueRevenues.map(v => (
                      <tr key={v.venue_id} style={{ borderBottom: `1px solid ${F_BORDER}` }}>
                        <td className="px-3 py-3 font-[560]" style={{ color: T1 }}>{v.venue_name}</td>
                        <td className="px-3 py-3 text-right tabular-nums" style={{ color: T2 }}>{fmtEur(v.drinkRevenue)}</td>
                        <td className="px-3 py-3 text-right tabular-nums" style={{ color: T2 }}>{fmtEur(v.ticketRevenue)}</td>
                        <td className="px-3 py-3 text-right tabular-nums" style={{ color: T2 }}>{fmtEur(v.tableRevenue)}</td>
                        <td className="px-3 py-3 text-right tabular-nums font-[620]" style={{ color: T1 }}>{fmtEur(v.totalRevenue)}</td>
                        <td className="px-3 py-3 text-right tabular-nums font-[620]" style={{ color: RED }}>{fmtEur(v.yunoFees)}</td>
                      </tr>
                    ))}
                    <tr style={{ borderTop: `1px solid ${BORDER}`, background: 'rgba(255,255,255,0.018)' }}>
                      <td className="px-3 py-3 font-[620]" style={{ color: T1 }}>{t('adminAccounting.total')}</td>
                      <td className="px-3 py-3 text-right tabular-nums font-[620]" style={{ color: T1 }}>{fmtEur(totalDrinks)}</td>
                      <td className="px-3 py-3 text-right tabular-nums font-[620]" style={{ color: T1 }}>{fmtEur(totalTickets)}</td>
                      <td className="px-3 py-3 text-right tabular-nums font-[620]" style={{ color: T1 }}>{fmtEur(totalTables)}</td>
                      <td className="px-3 py-3 text-right tabular-nums font-[620]" style={{ color: T1 }}>{fmtEur(totalRevenue)}</td>
                      <td className="px-3 py-3 text-right tabular-nums font-[620]" style={{ color: RED }}>{fmtEur(totalYunoFees)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Commission history */}
        <div style={cardStyle}>
          <h2 className="mb-4" style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em' }}>{t('adminAccounting.commissionHistory')}</h2>
          {commissions.length === 0 ? (
            <div className="text-center py-12">
              <Calculator className="h-9 w-9 mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.12)' }} />
              <p style={{ color: T3, fontSize: 12 }}>{t('adminAccounting.noCommissions')}</p>
            </div>
          ) : (
            <div className="overflow-x-auto -mx-4 sm:-mx-2">
              <div className="px-4 sm:px-2" style={{ minWidth: 700 }}>
                <table className="w-full text-[13px]">
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${F_BORDER}` }}>
                      <th className="px-3 py-2.5 text-left font-medium" style={thStyle}>{t('adminAccounting.club')}</th>
                      <th className="px-3 py-2.5 text-left font-medium" style={thStyle}>{t('adminAccounting.period')}</th>
                      <th className="px-3 py-2.5 text-right font-medium" style={thStyle}>{t('adminAccounting.revenue')}</th>
                      <th className="px-3 py-2.5 text-right font-medium" style={thStyle}>{t('adminAccounting.yunoFees')}</th>
                      <th className="px-3 py-2.5 text-left font-medium" style={thStyle}>{t('adminAccounting.statusLabel')}</th>
                      <th className="px-3 py-2.5 text-left font-medium" style={thStyle}>{t('adminAccounting.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {commissions.map((c, index) => (
                      <tr key={c.id} style={{ borderBottom: index < commissions.length - 1 ? `1px solid ${F_BORDER}` : 'none' }}>
                        <td className="px-3 py-3 font-[560]" style={{ color: T1 }}>{c.venue_name}</td>
                        <td className="px-3 py-3 tabular-nums" style={{ color: T2 }}>{format(new Date(c.period_start), 'MMM yyyy', { locale: dateLocale })}</td>
                        <td className="px-3 py-3 text-right tabular-nums" style={{ color: T1 }}>{fmtEur(c.total_revenue)}</td>
                        <td className="px-3 py-3 text-right tabular-nums font-[620]" style={{ color: RED }}>{fmtEur(c.commission_amount)}</td>
                        <td className="px-3 py-3">{getStatusBadge(c.status)}</td>
                        <td className="px-3 py-3">
                          <select value={c.status} onChange={(e) => updateCommissionStatus(c.id, e.target.value)} style={{ ...selectStyle, padding: '6px 10px', minWidth: 120 }}>
                            <option value="pending" style={{ background: '#0a0a0c', color: T1 }}>{t('adminAccounting.statusPending')}</option>
                            <option value="invoiced" style={{ background: '#0a0a0c', color: T1 }}>{t('adminAccounting.statusInvoiced')}</option>
                            <option value="paid" style={{ background: '#0a0a0c', color: T1 }}>{t('adminAccounting.statusPaid')}</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
