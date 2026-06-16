import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Pagination, PaginationContent, PaginationItem, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { Search, RefreshCw, ScrollText } from 'lucide-react';
import { format } from 'date-fns';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED         = '#E8192C';
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

const PAGE_SIZE = 40;

const inputStyle: React.CSSProperties = {
  background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10,
  color: T1, fontSize: 13, padding: '9px 12px 9px 34px', width: '100%', outline: 'none',
};

interface AuditRow {
  id: string;
  admin_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, any> | null;
  created_at: string;
}

// Actions destructrices surlignées
const DESTRUCTIVE = new Set(['user_suspended', 'event_cancelled', 'venue_deleted', 'user_mfa_reset']);
const WARN = new Set(['event_depublished', 'role_admin_granted']);

function ActionPill({ action }: { action: string }) {
  const tone = DESTRUCTIVE.has(action)
    ? { color: NEG, background: 'rgba(255,92,99,0.1)', border: '1px solid rgba(255,92,99,0.25)' }
    : WARN.has(action)
    ? { color: AMBER, background: 'rgba(245,196,81,0.1)', border: '1px solid rgba(245,196,81,0.25)' }
    : { color: T2, background: C_FAINT, border: `1px solid ${BORDER}` };
  return <span style={{ ...tone, fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 999, display: 'inline-block', fontFamily: 'ui-monospace, monospace' }}>{action}</span>;
}

export default function AdminAuditLog() {
  const [search, setSearch] = useState('');
  const [data, setData] = useState<AuditRow[]>([]);
  const [admins, setAdmins] = useState<Record<string, string>>({});
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('admin_audit_log')
      .select('id, admin_id, action, entity_type, entity_id, metadata, created_at', { count: 'exact' });
    if (search) query = query.ilike('action', `%${search}%`);
    const { data, count } = await query
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    const rows = (data || []) as AuditRow[];
    setData(rows);
    setCount(count ?? 0);

    const adminIds = [...new Set(rows.map(r => r.admin_id).filter(Boolean))] as string[];
    if (adminIds.length > 0) {
      const { data: profs } = await supabase.from('profiles').select('id, email').in('id', adminIds);
      setAdmins(Object.fromEntries((profs || []).map(p => [p.id, p.email || p.id])));
    }
    setLoading(false);
  }, [search, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(0); }, [search]);

  const totalPages = Math.ceil(count / PAGE_SIZE);

  return (
    <div className="min-h-screen pb-16" style={{ background: '#000' }}>
      <div className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(232,25,44,.05),transparent 55%)' }} />

      <div className="relative z-10 mx-auto max-w-[1340px] px-4 sm:px-6 py-6 space-y-6">
        <div>
          <h1 style={{ color: T1, fontSize: 'clamp(22px,3vw,28px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1 }}>
            Journal d'audit
          </h1>
          <p style={{ color: T3, fontSize: 13, marginTop: 4 }}>Trace de toutes les actions admin sensibles (suspension, reset MFA, annulation, dépublication).</p>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: T3 }} />
            <input placeholder="Filtrer par action…" value={search} onChange={(e) => setSearch(e.target.value)} style={inputStyle} />
          </div>
          <button onClick={load} className="inline-flex items-center justify-center rounded-xl cursor-pointer transition-all duration-150" style={{ width: 38, height: 38, background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}>
            <RefreshCw className="h-4 w-4" />
          </button>
          <span style={{ color: T3, fontSize: 13 }} className="tabular-nums">{count} entrées</span>
        </div>

        {/* Table */}
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, overflow: 'hidden' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]" style={{ minWidth: 760 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${F_BORDER}` }}>
                  {['Date', 'Admin', 'Action', 'Cible', 'Détails'].map((h, i) => (
                    <th key={i} className="px-4 py-3 text-left font-medium" style={{ color: T3, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} className="text-center py-10">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 mx-auto mb-2" style={{ borderColor: `${BORDER} ${BORDER} ${BORDER} ${RED}` }} />
                    <span style={{ color: T3, fontSize: 12 }}>Chargement…</span>
                  </td></tr>
                ) : data.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-12">
                    <ScrollText className="h-9 w-9 mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.12)' }} />
                    <span style={{ color: T3, fontSize: 12 }}>Aucune action enregistrée</span>
                  </td></tr>
                ) : data.map((row, index) => {
                  const reason = row.metadata?.reason;
                  return (
                    <tr key={row.id} style={{ borderBottom: index < data.length - 1 ? `1px solid ${F_BORDER}` : 'none' }}>
                      <td className="px-4 py-3 tabular-nums whitespace-nowrap" style={{ color: T3 }}>{format(new Date(row.created_at), 'dd/MM/yy HH:mm')}</td>
                      <td className="px-4 py-3 max-w-[180px] truncate" style={{ color: T2 }}>{row.admin_id ? (admins[row.admin_id] || row.admin_id.slice(0, 8)) : '—'}</td>
                      <td className="px-4 py-3"><ActionPill action={row.action} /></td>
                      <td className="px-4 py-3" style={{ color: T2 }}>
                        {row.entity_type ? <span style={{ color: T3 }}>{row.entity_type}:</span> : null} {row.entity_id ? row.entity_id.slice(0, 8) : '—'}
                      </td>
                      <td className="px-4 py-3 max-w-[260px] truncate" style={{ color: T3 }}>{reason ? String(reason) : '—'}</td>
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
