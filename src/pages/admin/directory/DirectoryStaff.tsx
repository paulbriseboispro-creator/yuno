import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Search, Shield, ShieldOff, ChevronLeft, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED        = '#E8192C';
const POS        = '#34D399';
const T1         = 'rgba(255,255,255,0.96)';
const T2         = 'rgba(255,255,255,0.58)';
const T3         = 'rgba(255,255,255,0.36)';
const C_FAINT    = 'rgba(255,255,255,0.06)';
const BORDER     = 'rgba(255,255,255,0.085)';
const F_BORDER   = 'rgba(255,255,255,0.055)';
const INNER_BG   = 'rgba(255,255,255,0.032)';
const CARD_BG    = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

const thStyle: React.CSSProperties = { color: T3, fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' };

const PAGE_SIZE = 25;

export default function DirectoryStaff() {
  const { t } = useLanguage();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [data, setData] = useState<any[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);

    // Get staff user_roles with count
    const { data: roles, count: total } = await supabase
      .from('user_roles')
      .select('user_id, role, created_at', { count: 'exact' })
      .in('role', ['barman', 'bouncer', 'vip_host', 'cloakroom', 'manager'] as const)
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (roles && roles.length > 0) {
      const userIds = [...new Set(roles.map(r => r.user_id))];

      // Fetch profiles (never expose employee_pin value, only check existence)
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, email, first_name, last_name, venue_id, employee_pin')
        .in('id', userIds);

      const profileMap = Object.fromEntries((profiles || []).map(p => [p.id, p]));

      // Fetch venue names
      const venueIds = [...new Set((profiles || []).map(p => p.venue_id).filter(Boolean))];
      const { data: venues } = venueIds.length > 0
        ? await supabase.from('venues').select('id, name').in('id', venueIds)
        : { data: [] };
      const venueMap = Object.fromEntries((venues || []).map(v => [v.id, v.name]));

      let filtered = roles.map(r => {
        const p = profileMap[r.user_id];
        return {
          id: `${r.user_id}-${r.role}`,
          userId: r.user_id,
          email: p?.email || '—',
          name: p ? `${p.first_name || ''} ${p.last_name || ''}`.trim() || p.email : '—',
          role: r.role,
          venueName: p?.venue_id ? (venueMap[p.venue_id] || '—') : '—',
          hasPin: !!p?.employee_pin,
          created_at: r.created_at,
        };
      });

      if (search) {
        const s = search.toLowerCase();
        filtered = filtered.filter(f => f.name.toLowerCase().includes(s) || f.email.toLowerCase().includes(s) || f.venueName.toLowerCase().includes(s));
      }

      setData(filtered);
    } else {
      setData([]);
    }
    setCount(total ?? 0);
    setLoading(false);
  }, [page, search]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(0); }, [search]);

  const totalPages = Math.ceil(count / PAGE_SIZE);

  const roleLabel = (role: string) => {
    const map: Record<string, string> = { barman: 'Barman', bouncer: 'Bouncer', vip_host: 'VIP Host', cloakroom: t('admin.dir.cloakroom'), manager: 'Manager' };
    return map[role] || role;
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: T3 }} />
          <input
            placeholder={t('admin.dir.searchStaff')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, color: T1, fontSize: 13, padding: '9px 12px 9px 36px', width: '100%', outline: 'none' }}
          />
        </div>
        <span className="tabular-nums" style={{ color: T3, fontSize: 12.5 }}>{count} {t('admin.dir.results')}</span>
      </div>

      <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '8px 4px', overflow: 'hidden' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]" style={{ minWidth: 760 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${F_BORDER}` }}>
                <th className="px-3 py-2.5 text-left" style={thStyle}>{t('admin.dir.name')}</th>
                <th className="px-3 py-2.5 text-left" style={thStyle}>Email</th>
                <th className="px-3 py-2.5 text-left" style={thStyle}>{t('admin.dir.role')}</th>
                <th className="px-3 py-2.5 text-left" style={thStyle}>Venue</th>
                <th className="px-3 py-2.5 text-left" style={thStyle}>PIN</th>
                <th className="px-3 py-2.5 text-right" style={thStyle}>{t('admin.dir.created')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="text-center py-8" style={{ color: T3, fontSize: 12.5 }}>{t('admin.dir.loading')}</td></tr>
              ) : data.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8" style={{ color: T3, fontSize: 12.5 }}>{t('admin.dir.noResults')}</td></tr>
              ) : data.map((s, i) => (
                <tr key={s.id} style={{ borderBottom: i < data.length - 1 ? `1px solid ${F_BORDER}` : 'none' }}>
                  <td className="px-3 py-3 font-medium">
                    <Link to={`/admin/directory/user/${s.userId}`} style={{ color: RED, textDecoration: 'none' }}>{s.name}</Link>
                  </td>
                  <td className="px-3 py-3 max-w-[180px] truncate" style={{ color: T3 }}>{s.email}</td>
                  <td className="px-3 py-3">
                    <span className="inline-flex items-center" style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 999, background: C_FAINT, border: `1px solid ${BORDER}`, color: T2, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      {roleLabel(s.role)}
                    </span>
                  </td>
                  <td className="px-3 py-3" style={{ color: T3 }}>{s.venueName}</td>
                  <td className="px-3 py-3">
                    {s.hasPin ? (
                      <span className="inline-flex items-center gap-1" style={{ color: POS, fontSize: 12, fontWeight: 560 }}><Shield className="h-3.5 w-3.5" /> PIN set</span>
                    ) : (
                      <span className="inline-flex items-center gap-1" style={{ color: T3, fontSize: 12 }}><ShieldOff className="h-3.5 w-3.5" /> No PIN</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums" style={{ color: T3 }}>{format(new Date(s.created_at), 'dd/MM/yyyy')}</td>
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
