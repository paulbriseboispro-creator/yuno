import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const POS        = '#34D399';
const T1         = 'rgba(255,255,255,0.96)';
const T2         = 'rgba(255,255,255,0.58)';
const T3         = 'rgba(255,255,255,0.36)';
const BORDER     = 'rgba(255,255,255,0.085)';
const F_BORDER   = 'rgba(255,255,255,0.055)';
const INNER_BG   = 'rgba(255,255,255,0.032)';
const CARD_BG    = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

const thStyle: React.CSSProperties = { color: T3, fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' };

function StatusPill({ active, on, off }: { active: boolean; on: string; off: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5"
      style={{
        fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: '0.04em',
        background: active ? 'rgba(52,211,153,0.1)' : 'rgba(255,255,255,0.045)',
        border: `1px solid ${active ? 'rgba(52,211,153,0.25)' : BORDER}`,
        color: active ? POS : T3,
      }}
    >
      {active ? on : off}
    </span>
  );
}

const PAGE_SIZE = 25;

export default function DirectoryPromoters() {
  const { t } = useLanguage();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [data, setData] = useState<any[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('promoters')
      .select('id, first_name, last_name, promo_code, venue_id, pending_amount, total_paid, is_active, created_at', { count: 'exact' });

    if (search) {
      query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,promo_code.ilike.%${search}%`);
    }

    const { data: proms, count: total } = await query
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (proms && proms.length > 0) {
      const venueIds = [...new Set(proms.map(p => p.venue_id).filter(Boolean))];
      const promIds = proms.map(p => p.id);

      const [venues, clicks, conversions] = await Promise.all([
        venueIds.length > 0 ? supabase.from('venues').select('id, name').in('id', venueIds) : { data: [] },
        supabase.from('promoter_clicks').select('promoter_id').in('promoter_id', promIds),
        supabase.from('promoter_conversions').select('promoter_id').in('promoter_id', promIds),
      ]);

      const venueMap = Object.fromEntries((venues.data || []).map(v => [v.id, v.name]));
      const clickMap: Record<string, number> = {};
      (clicks.data || []).forEach(c => { clickMap[c.promoter_id] = (clickMap[c.promoter_id] || 0) + 1; });
      const convMap: Record<string, number> = {};
      (conversions.data || []).forEach(c => { convMap[c.promoter_id] = (convMap[c.promoter_id] || 0) + 1; });

      setData(proms.map(p => ({
        ...p,
        venueName: venueMap[p.venue_id] || '—',
        clicks: clickMap[p.id] || 0,
        conversions: convMap[p.id] || 0,
      })));
    } else {
      setData([]);
    }
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
            placeholder={t('admin.dir.searchPromoters')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, color: T1, fontSize: 13, padding: '9px 12px 9px 36px', width: '100%', outline: 'none' }}
          />
        </div>
        <span className="tabular-nums" style={{ color: T3, fontSize: 12.5 }}>{count} {t('admin.dir.results')}</span>
      </div>

      <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '8px 4px', overflow: 'hidden' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]" style={{ minWidth: 820 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${F_BORDER}` }}>
                <th className="px-3 py-2.5 text-left" style={thStyle}>{t('admin.dir.name')}</th>
                <th className="px-3 py-2.5 text-left" style={thStyle}>Code</th>
                <th className="px-3 py-2.5 text-left" style={thStyle}>Venue</th>
                <th className="px-3 py-2.5 text-right" style={thStyle}>Clicks</th>
                <th className="px-3 py-2.5 text-right" style={thStyle}>Conversions</th>
                <th className="px-3 py-2.5 text-right" style={thStyle}>{t('admin.dir.commission')}</th>
                <th className="px-3 py-2.5 text-left" style={thStyle}>Status</th>
                <th className="px-3 py-2.5 text-right" style={thStyle}>{t('admin.dir.created')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="text-center py-8" style={{ color: T3, fontSize: 12.5 }}>{t('admin.dir.loading')}</td></tr>
              ) : data.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-8" style={{ color: T3, fontSize: 12.5 }}>{t('admin.dir.noResults')}</td></tr>
              ) : data.map((p, i) => (
                <tr key={p.id} style={{ borderBottom: i < data.length - 1 ? `1px solid ${F_BORDER}` : 'none' }}>
                  <td className="px-3 py-3 font-medium" style={{ color: T1 }}>{p.first_name} {p.last_name}</td>
                  <td className="px-3 py-3">
                    <code style={{ fontSize: 11.5, background: INNER_BG, border: `1px solid ${F_BORDER}`, color: T2, padding: '2px 7px', borderRadius: 6 }}>{p.promo_code}</code>
                  </td>
                  <td className="px-3 py-3" style={{ color: T3 }}>{p.venueName}</td>
                  <td className="px-3 py-3 text-right tabular-nums" style={{ color: T2 }}>{p.clicks}</td>
                  <td className="px-3 py-3 text-right tabular-nums" style={{ color: T2 }}>{p.conversions}</td>
                  <td className="px-3 py-3 text-right tabular-nums" style={{ color: T1 }}>{p.pending_amount.toFixed(2)} €</td>
                  <td className="px-3 py-3">
                    <StatusPill active={p.is_active} on={t('admin.dir.active')} off={t('admin.dir.inactive')} />
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums" style={{ color: T3 }}>{format(new Date(p.created_at), 'dd/MM/yyyy')}</td>
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
