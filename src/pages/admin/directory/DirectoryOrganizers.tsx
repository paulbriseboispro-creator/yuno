import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Search, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED        = '#E8192C';
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

export default function DirectoryOrganizers() {
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
      .from('organizer_profiles')
      .select('user_id, display_name, slug, avatar_url, is_public, created_at', { count: 'exact' });

    if (search) {
      query = query.ilike('display_name', `%${search}%`);
    }

    const { data: orgs, count: total } = await query
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (orgs && orgs.length > 0) {
      const userIds = orgs.map(o => o.user_id);

      const [eventsRes, partnersRes] = await Promise.all([
        supabase.from('events').select('organizer_user_id').in('organizer_user_id', userIds),
        supabase.from('venue_organizer_partnerships').select('organizer_user_id, venue_id').in('organizer_user_id', userIds).eq('status', 'active'),
      ]);

      const eventCountMap: Record<string, number> = {};
      (eventsRes.data || []).forEach(e => {
        if (e.organizer_user_id) eventCountMap[e.organizer_user_id] = (eventCountMap[e.organizer_user_id] || 0) + 1;
      });

      const venueCountMap: Record<string, number> = {};
      const seen = new Set<string>();
      (partnersRes.data || []).forEach(p => {
        const key = `${p.organizer_user_id}-${p.venue_id}`;
        if (!seen.has(key)) {
          seen.add(key);
          venueCountMap[p.organizer_user_id] = (venueCountMap[p.organizer_user_id] || 0) + 1;
        }
      });

      setData(orgs.map(o => ({
        ...o,
        eventCount: eventCountMap[o.user_id] || 0,
        venueCount: venueCountMap[o.user_id] || 0,
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
            placeholder={t('admin.dir.searchOrganizers')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, color: T1, fontSize: 13, padding: '9px 12px 9px 36px', width: '100%', outline: 'none' }}
          />
        </div>
        <span className="tabular-nums" style={{ color: T3, fontSize: 12.5 }}>{count} {t('admin.dir.results')}</span>
      </div>

      <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '8px 4px', overflow: 'hidden' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]" style={{ minWidth: 640 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${F_BORDER}` }}>
                <th className="px-3 py-2.5 text-left" style={thStyle}>{t('admin.dir.name')}</th>
                <th className="px-3 py-2.5 text-right" style={thStyle}>Events</th>
                <th className="px-3 py-2.5 text-right" style={thStyle}>Venues</th>
                <th className="px-3 py-2.5 text-left" style={thStyle}>Status</th>
                <th className="px-3 py-2.5 text-right" style={thStyle}>{t('admin.dir.created')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="text-center py-8" style={{ color: T3, fontSize: 12.5 }}>{t('admin.dir.loading')}</td></tr>
              ) : data.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-8" style={{ color: T3, fontSize: 12.5 }}>{t('admin.dir.noResults')}</td></tr>
              ) : data.map((o, i) => (
                <tr key={o.user_id} style={{ borderBottom: i < data.length - 1 ? `1px solid ${F_BORDER}` : 'none' }}>
                  <td className="px-3 py-3 font-medium">
                    {o.slug ? (
                      <a href={`/o/${o.slug}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1" style={{ color: RED, textDecoration: 'none' }}>
                        {o.display_name}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <span style={{ color: T1 }}>{o.display_name}</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums" style={{ color: T2 }}>{o.eventCount}</td>
                  <td className="px-3 py-3 text-right tabular-nums" style={{ color: T2 }}>{o.venueCount}</td>
                  <td className="px-3 py-3">
                    <StatusPill active={o.is_public} on={t('admin.dir.active')} off={t('admin.dir.inactive')} />
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums" style={{ color: T3 }}>{format(new Date(o.created_at), 'dd/MM/yyyy')}</td>
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
