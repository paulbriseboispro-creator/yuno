import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Search, CheckCircle, AlertTriangle, XCircle, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED        = '#E8192C';
const POS        = '#34D399';
const NEG        = '#FF5C63';
const T1         = 'rgba(255,255,255,0.96)';
const T2         = 'rgba(255,255,255,0.58)';
const T3         = 'rgba(255,255,255,0.36)';
const C_MID      = 'rgba(255,255,255,0.40)';
const C_HI       = 'rgba(255,255,255,0.92)';
const BORDER     = 'rgba(255,255,255,0.085)';
const F_BORDER   = 'rgba(255,255,255,0.055)';
const INNER_BG   = 'rgba(255,255,255,0.032)';
const CARD_BG    = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

const thStyle: React.CSSProperties = { color: T3, fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' };

const PAGE_SIZE = 25;

export default function DirectoryVenues() {
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
      .from('venues')
      .select('id, name, city, owner_id, stripe_account_id, stripe_charges_enabled, stripe_onboarding_complete, created_at', { count: 'exact' });

    if (search) {
      query = query.or(`name.ilike.%${search}%,city.ilike.%${search}%`);
    }

    const { data: venues, count: total } = await query
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (venues && venues.length > 0) {
      // Fetch owner emails
      const ownerIds = [...new Set(venues.map(v => v.owner_id).filter(Boolean))];
      const { data: profiles } = ownerIds.length > 0
        ? await supabase.from('profiles').select('id, email').in('id', ownerIds)
        : { data: [] };

      // Fetch onboarding
      const venueIds = venues.map(v => v.id);
      const { data: onboarding } = await supabase
        .from('venue_onboarding')
        .select('venue_id, current_step, completed_at, steps')
        .in('venue_id', venueIds);

      const profileMap = Object.fromEntries((profiles || []).map(p => [p.id, p.email]));
      const onboardingMap = Object.fromEntries((onboarding || []).map(o => [o.venue_id, o]));

      setData(venues.map(v => ({
        ...v,
        ownerEmail: profileMap[v.owner_id] || '—',
        onboarding: onboardingMap[v.id] || null,
      })));
    } else {
      setData([]);
    }
    setCount(total ?? 0);
    setLoading(false);
  }, [page, search]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => { setPage(0); }, [search]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getStripeStatus = (v: any) => {
    if (v.stripe_charges_enabled) return { label: t('admin.dir.stripeConnected'), tone: 'pos' as const, icon: CheckCircle };
    if (v.stripe_account_id) return { label: t('admin.dir.stripePending'), tone: 'warn' as const, icon: AlertTriangle };
    return { label: t('admin.dir.stripeMissing'), tone: 'neg' as const, icon: XCircle };
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getOnboardingPct = (ob: any) => {
    if (!ob) return 0;
    if (ob.completed_at) return 100;
    const steps = ob.steps as Record<string, boolean> | null;
    if (!steps) return Math.round(((ob.current_step || 0) / 8) * 100);
    const total = Object.keys(steps).length;
    const done = Object.values(steps).filter(Boolean).length;
    return total > 0 ? Math.round((done / total) * 100) : 0;
  };

  const totalPages = Math.ceil(count / PAGE_SIZE);

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: T3 }} />
          <input
            placeholder={t('admin.dir.searchVenues')}
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
                <th className="px-3 py-2.5 text-left" style={thStyle}>{t('admin.dir.venueName')}</th>
                <th className="px-3 py-2.5 text-left" style={thStyle}>{t('admin.dir.city')}</th>
                <th className="px-3 py-2.5 text-left" style={thStyle}>Owner</th>
                <th className="px-3 py-2.5 text-left" style={thStyle}>Stripe</th>
                <th className="px-3 py-2.5 text-left" style={thStyle}>Onboarding</th>
                <th className="px-3 py-2.5 text-right" style={thStyle}>{t('admin.dir.created')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="text-center py-8" style={{ color: T3, fontSize: 12.5 }}>{t('admin.dir.loading')}</td></tr>
              ) : data.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8" style={{ color: T3, fontSize: 12.5 }}>{t('admin.dir.noResults')}</td></tr>
              ) : data.map((v, i) => {
                const stripe = getStripeStatus(v);
                const pct = getOnboardingPct(v.onboarding);
                const StripeIcon = stripe.icon;
                const stripeColor = stripe.tone === 'pos' ? POS : stripe.tone === 'warn' ? '#FCD34D' : NEG;
                return (
                  <tr key={v.id} style={{ borderBottom: i < data.length - 1 ? `1px solid ${F_BORDER}` : 'none' }}>
                    <td className="px-3 py-3 font-medium">
                      <Link to={`/admin/directory/venue/${v.id}`} className="inline-flex items-center gap-1" style={{ color: RED, textDecoration: 'none' }}>
                        {v.name}
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    </td>
                    <td className="px-3 py-3" style={{ color: T2 }}>{v.city}</td>
                    <td className="px-3 py-3 max-w-[200px] truncate" style={{ color: T3 }}>{v.ownerEmail}</td>
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center gap-1.5" style={{ color: stripeColor, fontSize: 12, fontWeight: 560 }}>
                        <StripeIcon className="h-3.5 w-3.5" />
                        {stripe.label}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct >= 100 ? `linear-gradient(90deg,${POS}99,${POS})` : `linear-gradient(90deg,${C_MID},${C_HI})` }} />
                        </div>
                        <span className="tabular-nums" style={{ color: T3, fontSize: 11 }}>{pct}%</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums" style={{ color: T3 }}>{format(new Date(v.created_at), 'dd/MM/yyyy')}</td>
                  </tr>
                );
              })}
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
