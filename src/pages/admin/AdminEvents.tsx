import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Pagination, PaginationContent, PaginationItem, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { Search, RefreshCw, CalendarDays, EyeOff, Eye, Ban, Clock, ShieldAlert, Check, X, type LucideIcon } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED         = '#E8192C';
const POS         = '#34D399';
const NEG         = '#FF5C63';
const AMBER       = '#F5C451';
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

const inputStyle: React.CSSProperties = {
  background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10,
  color: T1, fontSize: 13, padding: '9px 12px 9px 34px', width: '100%', outline: 'none',
};
const selectStyle: React.CSSProperties = {
  background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10,
  color: T1, fontSize: 13, padding: '9px 12px', outline: 'none', cursor: 'pointer', minWidth: 150,
};

interface EventRow {
  id: string;
  title: string | null;
  start_at: string;
  venue_id: string | null;
  discovery_status: string | null;
  visibility: string | null;
  is_discoverable: boolean;
  is_active: boolean;
  status: string;
  venueName?: string;
}

// ─── Pills ──────────────────────────────────────────────────────────────────
function DiscoveryPill({ status }: { status: string | null }) {
  const tone = status === 'approved'
    ? { color: POS, background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)' }
    : status === 'rejected'
    ? { color: NEG, background: 'rgba(255,92,99,0.1)', border: '1px solid rgba(255,92,99,0.25)' }
    : { color: AMBER, background: 'rgba(245,196,81,0.1)', border: '1px solid rgba(245,196,81,0.25)' };
  return <span style={{ ...tone, fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 999, textTransform: 'capitalize', display: 'inline-block' }}>{status || 'pending'}</span>;
}

function VisibilityPill({ ev }: { ev: EventRow }) {
  const live = ev.is_discoverable && ev.is_active && ev.status === 'active';
  const cancelled = ev.status === 'cancelled';
  const tone = cancelled
    ? { color: NEG, background: 'rgba(255,92,99,0.1)', border: '1px solid rgba(255,92,99,0.25)', label: 'Annulé' }
    : live
    ? { color: POS, background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)', label: 'En ligne' }
    : { color: T3, background: C_FAINT, border: `1px solid ${BORDER}`, label: 'Dépublié' };
  return <span style={{ color: tone.color, background: tone.background, border: tone.border, fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 999, display: 'inline-block' }}>{tone.label}</span>;
}

export default function AdminEvents() {
  const [search, setSearch] = useState('');
  const [discoveryFilter, setDiscoveryFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [stateFilter, setStateFilter] = useState('all'); // all | live | depublished | cancelled
  const [data, setData] = useState<EventRow[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [venues, setVenues] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [kpis, setKpis] = useState({ total: 0, pending: 0, cancelled: 0 });

  useEffect(() => {
    supabase.from('venues').select('id, name').then(({ data }) => {
      if (data) setVenues(Object.fromEntries(data.map(v => [v.id, v.name])));
    });
  }, []);

  const loadKpis = useCallback(async () => {
    const [{ count: total }, { count: pending }, { count: cancelled }] = await Promise.all([
      supabase.from('events').select('id', { count: 'exact', head: true }),
      supabase.from('events').select('id', { count: 'exact', head: true }).eq('discovery_status', 'pending'),
      supabase.from('events').select('id', { count: 'exact', head: true }).eq('status', 'cancelled'),
    ]);
    setKpis({ total: total ?? 0, pending: pending ?? 0, cancelled: cancelled ?? 0 });
  }, []);

  useEffect(() => { loadKpis(); }, [loadKpis]);

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('events')
      .select('id, title, start_at, venue_id, discovery_status, visibility, is_discoverable, is_active, status', { count: 'exact' });

    if (search) query = query.ilike('title', `%${search}%`);
    if (discoveryFilter !== 'all') query = query.eq('discovery_status', discoveryFilter);
    if (stateFilter === 'cancelled') query = query.eq('status', 'cancelled');
    else if (stateFilter === 'live') query = query.eq('status', 'active').eq('is_discoverable', true).eq('is_active', true);
    else if (stateFilter === 'depublished') query = query.eq('is_discoverable', false);

    const { data, count } = await query
      .order('start_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    setData((data || []) as EventRow[]);
    setCount(count ?? 0);
    setLoading(false);
  }, [search, discoveryFilter, stateFilter, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(0); }, [search, discoveryFilter, stateFilter]);

  const refresh = () => { load(); loadKpis(); };

  const handleTogglePublish = async (ev: EventRow) => {
    const publish = !ev.is_discoverable;
    if (!publish && !window.confirm(`Dépublier « ${ev.title || 'cet événement'} » ? Il disparaîtra de la découverte publique.`)) return;
    setBusyId(ev.id);
    try {
      const { error } = await supabase.rpc('admin_set_event_published', { _event_id: ev.id, _published: publish });
      if (error) throw error;
      toast.success(publish ? 'Événement republié' : 'Événement dépublié');
      refresh();
    } catch (err: any) {
      toast.error(err.message || 'Erreur');
    } finally {
      setBusyId(null);
    }
  };

  // BDE publication requests: a BDE event set to "public" lands as discovery_status
  // 'pending'. Approving makes it discoverable; rejecting keeps it link-only.
  const handleSetDiscovery = async (ev: EventRow, status: 'approved' | 'rejected') => {
    setBusyId(ev.id);
    try {
      const { error } = await supabase.rpc('admin_set_event_discovery_status', { _event_id: ev.id, _status: status });
      if (error) throw error;
      toast.success(status === 'approved' ? 'Publication approuvée' : 'Demande rejetée');
      refresh();
    } catch (err: any) {
      toast.error(err.message || 'Erreur');
    } finally {
      setBusyId(null);
    }
  };

  const handleCancel = async (ev: EventRow) => {
    if (ev.status === 'cancelled') { toast.info('Événement déjà annulé'); return; }
    if (!window.confirm(`ANNULER « ${ev.title || 'cet événement'} » ?\n\nIl sera retiré du public et marqué annulé. Le remboursement des billets/tables se fait séparément (cf. AUDIT_SUPERADMIN.md).`)) return;
    const reason = window.prompt('Raison de l\'annulation (visible dans le journal d\'audit) :', '') ?? '';
    setBusyId(ev.id);
    try {
      const { error } = await supabase.rpc('admin_cancel_event', { _event_id: ev.id, _reason: reason || null });
      if (error) throw error;
      toast.success('Événement annulé');
      refresh();
    } catch (err: any) {
      toast.error(err.message || 'Erreur');
    } finally {
      setBusyId(null);
    }
  };

  const totalPages = Math.ceil(count / PAGE_SIZE);

  const kpiCards: { label: string; value: string; icon: LucideIcon; tone?: 'neg' | 'amber' }[] = useMemo(() => [
    { label: 'Événements', value: kpis.total.toLocaleString(), icon: CalendarDays },
    { label: 'En attente de modération', value: kpis.pending.toLocaleString(), icon: Clock, tone: kpis.pending > 0 ? 'amber' : undefined },
    { label: 'Annulés', value: kpis.cancelled.toLocaleString(), icon: Ban, tone: kpis.cancelled > 0 ? 'neg' : undefined },
  ], [kpis]);

  return (
    <div className="min-h-screen pb-16" style={{ background: '#000' }}>
      <div className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(232,25,44,.05),transparent 55%)' }} />

      <div className="relative z-10 mx-auto max-w-[1340px] px-4 sm:px-6 py-6 space-y-6">
        {/* Header */}
        <div>
          <h1 style={{ color: T1, fontSize: 'clamp(22px,3vw,28px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1 }}>
            Modération des événements
          </h1>
          <p style={{ color: T3, fontSize: 13, marginTop: 4 }}>Dépublier, annuler ou superviser tout événement de la plateforme.</p>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {kpiCards.map((kpi) => {
            const valueColor = kpi.tone === 'neg' ? NEG : kpi.tone === 'amber' ? AMBER : T1;
            const iconColor = kpi.tone === 'neg' ? NEG : kpi.tone === 'amber' ? AMBER : T2;
            return (
              <div key={kpi.label} style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 16, boxShadow: CARD_SHADOW, padding: '16px 18px' }} className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl flex-none" style={{ background: C_FAINT, border: `1px solid ${F_BORDER}` }}>
                  <kpi.icon className="h-5 w-5" style={{ color: iconColor }} />
                </div>
                <div>
                  <p style={{ color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{kpi.label}</p>
                  <p className="tabular-nums" style={{ color: valueColor, fontSize: 20, fontWeight: 640, letterSpacing: '-0.02em', marginTop: 3 }}>{kpi.value}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: T3 }} />
            <input placeholder="Rechercher par titre…" value={search} onChange={(e) => setSearch(e.target.value)} style={inputStyle} />
          </div>
          <select value={discoveryFilter} onChange={(e) => setDiscoveryFilter(e.target.value as 'all' | 'pending' | 'approved' | 'rejected')} style={selectStyle}>
            <option value="all" style={{ background: '#0a0a0c' }}>Toute modération</option>
            <option value="pending" style={{ background: '#0a0a0c' }}>En attente</option>
            <option value="approved" style={{ background: '#0a0a0c' }}>Approuvés</option>
            <option value="rejected" style={{ background: '#0a0a0c' }}>Rejetés</option>
          </select>
          <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} style={selectStyle}>
            <option value="all" style={{ background: '#0a0a0c' }}>Tous états</option>
            <option value="live" style={{ background: '#0a0a0c' }}>En ligne</option>
            <option value="depublished" style={{ background: '#0a0a0c' }}>Dépubliés</option>
            <option value="cancelled" style={{ background: '#0a0a0c' }}>Annulés</option>
          </select>
          <button onClick={refresh} className="inline-flex items-center justify-center rounded-xl cursor-pointer transition-all duration-150" style={{ width: 38, height: 38, background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}>
            <RefreshCw className="h-4 w-4" />
          </button>
          <span style={{ color: T3, fontSize: 13 }} className="tabular-nums">{count} résultats</span>
        </div>

        {/* Table */}
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, overflow: 'hidden' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]" style={{ minWidth: 820 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${F_BORDER}` }}>
                  {['Événement', 'Club', 'Date', 'Modération', 'État', 'Actions'].map((h, i) => (
                    <th key={i} className={`px-4 py-3 font-medium ${h === 'Actions' ? 'text-right' : 'text-left'}`} style={{ color: T3, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="text-center py-10">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 mx-auto mb-2" style={{ borderColor: `${BORDER} ${BORDER} ${BORDER} ${RED}` }} />
                    <span style={{ color: T3, fontSize: 12 }}>Chargement…</span>
                  </td></tr>
                ) : data.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-12">
                    <CalendarDays className="h-9 w-9 mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.12)' }} />
                    <span style={{ color: T3, fontSize: 12 }}>Aucun événement</span>
                  </td></tr>
                ) : data.map((ev, index) => {
                  const busy = busyId === ev.id;
                  return (
                    <tr key={ev.id} style={{ borderBottom: index < data.length - 1 ? `1px solid ${F_BORDER}` : 'none' }}>
                      <td className="px-4 py-3 max-w-[240px] truncate" style={{ color: T1, fontWeight: 560 }}>{ev.title || '—'}</td>
                      <td className="px-4 py-3" style={{ color: T2 }}>{ev.venue_id ? (venues[ev.venue_id] || '—') : '—'}</td>
                      <td className="px-4 py-3 tabular-nums" style={{ color: T2 }}>{ev.start_at ? format(new Date(ev.start_at), 'dd/MM/yy HH:mm') : '—'}</td>
                      <td className="px-4 py-3"><DiscoveryPill status={ev.discovery_status} /></td>
                      <td className="px-4 py-3"><VisibilityPill ev={ev} /></td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          {ev.discovery_status === 'pending' && ev.status !== 'cancelled' && (
                            <>
                              <button
                                onClick={() => handleSetDiscovery(ev, 'approved')}
                                disabled={busy}
                                title="Approuver la publication publique"
                                className="inline-flex items-center gap-1.5 rounded-lg cursor-pointer transition-all"
                                style={{ padding: '6px 10px', background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.28)', color: POS, fontSize: 12, fontWeight: 600, opacity: busy ? 0.5 : 1 }}
                              >
                                <Check className="h-3.5 w-3.5" />
                                Approuver
                              </button>
                              <button
                                onClick={() => handleSetDiscovery(ev, 'rejected')}
                                disabled={busy}
                                title="Rejeter la demande (l'événement reste accessible par lien)"
                                className="inline-flex items-center gap-1.5 rounded-lg cursor-pointer transition-all"
                                style={{ padding: '6px 10px', background: INNER_BG, border: `1px solid ${BORDER}`, color: T2, fontSize: 12, fontWeight: 560, opacity: busy ? 0.5 : 1 }}
                              >
                                <X className="h-3.5 w-3.5" />
                                Rejeter
                              </button>
                            </>
                          )}
                          {ev.status !== 'cancelled' && (
                            <button
                              onClick={() => handleTogglePublish(ev)}
                              disabled={busy}
                              title={ev.is_discoverable ? 'Dépublier' : 'Republier'}
                              className="inline-flex items-center gap-1.5 rounded-lg cursor-pointer transition-all"
                              style={{ padding: '6px 10px', background: INNER_BG, border: `1px solid ${BORDER}`, color: T2, fontSize: 12, fontWeight: 560, opacity: busy ? 0.5 : 1 }}
                            >
                              {ev.is_discoverable ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                              {ev.is_discoverable ? 'Dépublier' : 'Republier'}
                            </button>
                          )}
                          <button
                            onClick={() => handleCancel(ev)}
                            disabled={busy || ev.status === 'cancelled'}
                            title="Annuler l'événement"
                            className="inline-flex items-center gap-1.5 rounded-lg cursor-pointer transition-all"
                            style={{ padding: '6px 10px', background: 'rgba(255,92,99,0.1)', border: '1px solid rgba(255,92,99,0.28)', color: NEG, fontSize: 12, fontWeight: 600, opacity: (busy || ev.status === 'cancelled') ? 0.4 : 1 }}
                          >
                            <ShieldAlert className="h-3.5 w-3.5" />
                            Annuler
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
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
    </div>
  );
}
