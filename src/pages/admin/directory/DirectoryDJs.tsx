import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { makeDjT } from '@/i18n/djTranslate';
import { Search, ExternalLink, ChevronLeft, ChevronRight, BadgeCheck } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

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

export default function DirectoryDJs() {
  const { t, language } = useLanguage();
  const tt = makeDjT(language);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [data, setData] = useState<any[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  // Verification is per PERSON (user_id), so admin_set_dj_verified flips every row
  // of the person — update all local rows sharing the user_id to match.
  const verifyDj = async (userId: string, next: boolean) => {
    setVerifyingId(userId);
    try {
      const { error } = await supabase.rpc('admin_set_dj_verified', { p_dj_user_id: userId, p_verified: next });
      if (error) throw error;
      setData(prev => prev.map(d => (d.user_id === userId ? { ...d, is_verified: next } : d)));
      toast.success(next
        ? tt('DJ vérifié', 'DJ verified', 'DJ verificado')
        : tt('Vérification retirée', 'Verification removed', 'Verificación retirada'));
    } catch (e) {
      toast.error(tt('Action échouée', 'Action failed', 'Acción fallida'));
      console.error('verify dj failed', e);
    } finally {
      setVerifyingId(null);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('djs')
      .select('id, user_id, stage_name, first_name, last_name, city, venue_id, is_active, is_verified, created_at, slug', { count: 'exact' });

    if (search) {
      query = query.or(`stage_name.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%,city.ilike.%${search}%`);
    }

    const { data: djs, count: total } = await query
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (djs && djs.length > 0) {
      const djIds = djs.map(d => d.id);
      const venueIds = [...new Set(djs.map(d => d.venue_id).filter(Boolean))];

      const [eventDjs, venues] = await Promise.all([
        supabase.from('event_djs').select('dj_id').in('dj_id', djIds),
        venueIds.length > 0 ? supabase.from('venues').select('id, name').in('id', venueIds) : { data: [] },
      ]);

      const eventCountMap: Record<string, number> = {};
      (eventDjs.data || []).forEach(ed => { eventCountMap[ed.dj_id] = (eventCountMap[ed.dj_id] || 0) + 1; });
      const venueMap = Object.fromEntries((venues.data || []).map(v => [v.id, v.name]));

      setData(djs.map(d => ({
        ...d,
        eventCount: eventCountMap[d.id] || 0,
        venueName: venueMap[d.venue_id] || '—',
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
            placeholder={t('admin.dir.searchDJs')}
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
                <th className="px-3 py-2.5 text-left" style={thStyle}>DJ</th>
                <th className="px-3 py-2.5 text-left" style={thStyle}>{t('admin.dir.city')}</th>
                <th className="px-3 py-2.5 text-left" style={thStyle}>Venue</th>
                <th className="px-3 py-2.5 text-right" style={thStyle}>Events</th>
                <th className="px-3 py-2.5 text-left" style={thStyle}>Status</th>
                <th className="px-3 py-2.5 text-center" style={thStyle}>{tt('Vérifié', 'Verified', 'Verificado')}</th>
                <th className="px-3 py-2.5 text-right" style={thStyle}>{t('admin.dir.created')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-8" style={{ color: T3, fontSize: 12.5 }}>{t('admin.dir.loading')}</td></tr>
              ) : data.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8" style={{ color: T3, fontSize: 12.5 }}>{t('admin.dir.noResults')}</td></tr>
              ) : data.map((d, i) => (
                <tr key={d.id} style={{ borderBottom: i < data.length - 1 ? `1px solid ${F_BORDER}` : 'none' }}>
                  <td className="px-3 py-3 font-medium">
                    {d.slug ? (
                      <a href={`/dj/${d.slug}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1" style={{ color: RED, textDecoration: 'none' }}>
                        {d.stage_name || `${d.first_name} ${d.last_name}`}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <span style={{ color: T1 }}>{d.stage_name || `${d.first_name} ${d.last_name}`}</span>
                    )}
                  </td>
                  <td className="px-3 py-3" style={{ color: T2 }}>{d.city || '—'}</td>
                  <td className="px-3 py-3" style={{ color: T3 }}>{d.venueName}</td>
                  <td className="px-3 py-3 text-right tabular-nums" style={{ color: T2 }}>{d.eventCount}</td>
                  <td className="px-3 py-3">
                    <StatusPill active={d.is_active} on={t('admin.dir.active')} off={t('admin.dir.inactive')} />
                  </td>
                  <td className="px-3 py-3 text-center">
                    <button
                      onClick={() => verifyDj(d.user_id, !d.is_verified)}
                      disabled={verifyingId === d.user_id}
                      title={d.is_verified ? tt('Retirer la vérification', 'Remove verification', 'Quitar verificación') : tt('Vérifier ce DJ', 'Verify this DJ', 'Verificar este DJ')}
                      className="inline-flex items-center gap-1.5 cursor-pointer transition-all disabled:opacity-40"
                      style={{
                        fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 999,
                        background: d.is_verified ? 'rgba(232,25,44,0.1)' : 'rgba(255,255,255,0.045)',
                        border: `1px solid ${d.is_verified ? 'rgba(232,25,44,0.3)' : BORDER}`,
                        color: d.is_verified ? RED : T3,
                      }}
                    >
                      <BadgeCheck className="h-3.5 w-3.5" />
                      {d.is_verified ? tt('Vérifié', 'Verified', 'Verificado') : tt('Vérifier', 'Verify', 'Verificar')}
                    </button>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums" style={{ color: T3 }}>{format(new Date(d.created_at), 'dd/MM/yyyy')}</td>
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
