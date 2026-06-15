import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED        = '#E8192C';
const T1         = 'rgba(255,255,255,0.96)';
const T2         = 'rgba(255,255,255,0.58)';
const T3         = 'rgba(255,255,255,0.36)';
const BORDER     = 'rgba(255,255,255,0.085)';
const F_BORDER   = 'rgba(255,255,255,0.055)';
const INNER_BG   = 'rgba(255,255,255,0.032)';
const CARD_BG    = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

const thStyle: React.CSSProperties = { color: T3, fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' };

const PAGE_SIZE = 25;

export default function DirectoryCustomers() {
  const { t } = useLanguage();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [data, setData] = useState<any[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);

    // Query venue_customers which aggregates per-venue customer stats
    // We'll aggregate across all venues per user
    let query = supabase
      .from('venue_customers')
      .select('user_id, email, first_name, last_name, order_count, ticket_count, total_spent, last_visit_at', { count: 'exact' });

    if (search) {
      query = query.or(`email.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%`);
    }

    const { data: customers, count: total } = await query
      .order('last_visit_at', { ascending: false, nullsFirst: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    setData(customers || []);
    setCount(total ?? 0);
    setLoading(false);
  }, [page, search]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(0); }, [search]);

  const totalPages = Math.ceil(count / PAGE_SIZE);

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: T3 }} />
          <input
            placeholder={t('admin.dir.searchCustomers')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, color: T1, fontSize: 13, padding: '9px 12px 9px 36px', width: '100%', outline: 'none' }}
          />
        </div>
        <span className="tabular-nums" style={{ color: T3, fontSize: 12.5 }}>{count} {t('admin.dir.results')}</span>
      </div>

      <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '8px 4px', overflow: 'hidden' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]" style={{ minWidth: 700 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${F_BORDER}` }}>
                <th className="px-3 py-2.5 text-left" style={thStyle}>Email</th>
                <th className="px-3 py-2.5 text-left" style={thStyle}>{t('admin.dir.name')}</th>
                <th className="px-3 py-2.5 text-right" style={thStyle}>{t('admin.dir.orders')}</th>
                <th className="px-3 py-2.5 text-right" style={thStyle}>{t('admin.dir.tickets')}</th>
                <th className="px-3 py-2.5 text-right" style={thStyle}>{t('admin.dir.totalSpent')}</th>
                <th className="px-3 py-2.5 text-right" style={thStyle}>{t('admin.dir.lastActivity')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="text-center py-8" style={{ color: T3, fontSize: 12.5 }}>{t('admin.dir.loading')}</td></tr>
              ) : data.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8" style={{ color: T3, fontSize: 12.5 }}>{t('admin.dir.noResults')}</td></tr>
              ) : data.map((c, i) => (
                <tr key={`${c.user_id}-${i}`} style={{ borderBottom: i < data.length - 1 ? `1px solid ${F_BORDER}` : 'none' }}>
                  <td className="px-3 py-3 max-w-[200px] truncate">
                    {c.user_id ? (
                      <Link to={`/admin/directory/user/${c.user_id}`} style={{ color: RED, textDecoration: 'none' }}>{c.email}</Link>
                    ) : <span style={{ color: T2 }}>{c.email}</span>}
                  </td>
                  <td className="px-3 py-3 font-medium" style={{ color: T1 }}>{`${c.first_name || ''} ${c.last_name || ''}`.trim() || '—'}</td>
                  <td className="px-3 py-3 text-right tabular-nums" style={{ color: T2 }}>{c.order_count ?? 0}</td>
                  <td className="px-3 py-3 text-right tabular-nums" style={{ color: T2 }}>{c.ticket_count ?? 0}</td>
                  <td className="px-3 py-3 text-right tabular-nums" style={{ color: T1 }}>{(c.total_spent ?? 0).toFixed(2)} €</td>
                  <td className="px-3 py-3 text-right tabular-nums" style={{ color: T3 }}>
                    {c.last_visit_at ? format(new Date(c.last_visit_at), 'dd/MM/yyyy') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="inline-flex items-center justify-center h-8 w-8 rounded-lg cursor-pointer transition-all duration-150 disabled:cursor-not-allowed"
            style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2, opacity: page === 0 ? 0.4 : 1 }}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="tabular-nums px-2" style={{ color: T3, fontSize: 12.5 }}>{page + 1} / {totalPages}</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="inline-flex items-center justify-center h-8 w-8 rounded-lg cursor-pointer transition-all duration-150 disabled:cursor-not-allowed"
            style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2, opacity: page >= totalPages - 1 ? 0.4 : 1 }}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
