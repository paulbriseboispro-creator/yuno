import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Pagination, PaginationContent, PaginationItem, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { CreditCard, CheckCircle, Clock, XCircle, Search, Gem, Lock, X, type LucideIcon } from 'lucide-react';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { PLANS, PlanCode, PAID_PLANS, EARLY_ADOPTER_FREE_DAYS, EARLY_ADOPTER_LIMIT } from '@/lib/planFeatures';

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

const inputStyle: React.CSSProperties = {
  background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10,
  color: T1, fontSize: 13, padding: '9px 12px 9px 34px', width: '100%', outline: 'none',
};

const selectStyle: React.CSSProperties = {
  background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10,
  color: T1, fontSize: 13, padding: '9px 12px', outline: 'none', cursor: 'pointer', minWidth: 160,
};

const planLabel = (code: string) => {
  const p = PLANS[code as PlanCode];
  return p ? p.name : code;
};

// elite = accent RED, pro = bright white, essential = muted
const planPillStyle = (code: string): React.CSSProperties => {
  if (code === 'elite') return { background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.3)', color: RED };
  if (code === 'pro') return { background: 'rgba(255,255,255,0.08)', border: `1px solid ${BORDER}`, color: T1 };
  return { background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 };
};

// ─── Status pill ──────────────────────────────────────────────────────────────
function StatusPill({ status }: { status: string }) {
  const pos = status === 'active';
  const neg = status === 'past_due';
  const trial = status === 'trialing';
  const tone = pos
    ? { color: POS, background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)' }
    : neg
    ? { color: NEG, background: 'rgba(255,92,99,0.1)', border: '1px solid rgba(255,92,99,0.25)' }
    : trial
    ? { color: T1, background: 'rgba(255,255,255,0.06)', border: `1px solid ${BORDER}` }
    : { color: T3, background: C_FAINT, border: `1px solid ${BORDER}` };
  return (
    <span style={{ ...tone, fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 999, textTransform: 'capitalize', display: 'inline-block' }}>
      {status}
    </span>
  );
}

interface SubRow {
  id: string;
  venue_id: string;
  status: string;
  subscription_plan: string;
  stripe_subscription_id: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  trial_end: string | null;
  created_at: string;
  is_early_adopter: boolean | null;
  price_locked: boolean | null;
  venueName: string;
}

export default function AdminSubscriptions() {
  const { t } = useLanguage();
  const [data, setData] = useState<SubRow[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [planFilter, setPlanFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [kpis, setKpis] = useState({ active: 0, trialing: 0, expired: 0, earlyAdopters: 0 });
  const [grantTarget, setGrantTarget] = useState<{ venueId: string; venueName: string } | null>(null);
  const [grantPlan, setGrantPlan] = useState<PlanCode>('pro');
  const [granting, setGranting] = useState(false);

  // Load KPIs
  const loadKpis = useCallback(async () => {
    const [{ count: active }, { count: trialing }, { count: expired }, { count: earlyAdopters }] = await Promise.all([
      supabase.from('venue_subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('venue_subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'trialing'),
      supabase.from('venue_subscriptions').select('id', { count: 'exact', head: true }).in('status', ['canceled', 'past_due', 'incomplete']),
      supabase.from('venue_subscriptions').select('id', { count: 'exact', head: true }).eq('is_early_adopter', true),
    ]);
    setKpis({ active: active ?? 0, trialing: trialing ?? 0, expired: expired ?? 0, earlyAdopters: earlyAdopters ?? 0 });
  }, []);
  useEffect(() => { loadKpis(); }, [loadKpis]);

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('venue_subscriptions')
      .select('id, venue_id, status, subscription_plan, stripe_subscription_id, current_period_start, current_period_end, trial_end, created_at, is_early_adopter, price_locked', { count: 'exact' });

    if (statusFilter !== 'all') query = query.eq('status', statusFilter);
    if (planFilter !== 'all') query = query.eq('subscription_plan', planFilter);

    const { data: subs, count: total } = await query
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (subs && subs.length > 0) {
      const venueIds = [...new Set(subs.map(s => s.venue_id))];
      const { data: venues } = await supabase.from('venues').select('id, name').in('id', venueIds);
      const venueMap = Object.fromEntries((venues || []).map(v => [v.id, v.name]));
      const enriched = subs.map(s => ({ ...s, venueName: venueMap[s.venue_id] || s.venue_id }));
      if (search) {
        setData(enriched.filter(s => s.venueName.toLowerCase().includes(search.toLowerCase())));
      } else {
        setData(enriched);
      }
    } else {
      setData([]);
    }
    setCount(total ?? 0);
    setLoading(false);
  }, [page, statusFilter, planFilter, search]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(0); }, [statusFilter, planFilter, search]);

  // Grant the 3-month free early-adopter access (no card). Super-admin RLS allows
  // a direct upsert on venue_subscriptions.
  const grantEarlyAdopter = async () => {
    if (!grantTarget) return;
    setGranting(true);
    const trialEnd = new Date(Date.now() + EARLY_ADOPTER_FREE_DAYS * 86400000).toISOString();
    const { error } = await supabase
      .from('venue_subscriptions')
      .upsert({
        venue_id: grantTarget.venueId,
        subscription_plan: grantPlan,
        status: 'trialing',
        trial_end: trialEnd,
        is_early_adopter: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'venue_id' });
    setGranting(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t('admin.subs.eaGranted'));
    setGrantTarget(null);
    load(); loadKpis();
  };

  const revokeEarlyAdopter = async (venueId: string) => {
    const { error } = await supabase
      .from('venue_subscriptions')
      .update({ is_early_adopter: false, price_locked: false, updated_at: new Date().toISOString() })
      .eq('venue_id', venueId);
    if (error) { toast.error(error.message); return; }
    toast.success(t('admin.subs.eaRevoked'));
    load(); loadKpis();
  };

  const totalPages = Math.ceil(count / PAGE_SIZE);

  const kpiCards = useMemo(() => [
    { label: t('admin.subs.active'), value: kpis.active, icon: CheckCircle, tone: 'pos' as const },
    { label: t('admin.subs.trialing'), value: kpis.trialing, icon: Clock, tone: undefined },
    { label: t('admin.subs.expired'), value: kpis.expired, icon: XCircle, tone: kpis.expired > 0 ? 'neg' as const : undefined },
    { label: t('admin.subs.earlyAdopters'), value: `${kpis.earlyAdopters} / ${EARLY_ADOPTER_LIMIT}`, icon: Gem, tone: undefined },
  ], [kpis, t]);

  const statusOptions = [
    { value: 'all', label: t('admin.subs.allStatuses') },
    { value: 'active', label: t('admin.subs.active') },
    { value: 'trialing', label: t('admin.subs.trialing') },
    { value: 'canceled', label: t('admin.orders.cancelled') },
    { value: 'past_due', label: t('admin.orders.pending') },
  ];

  const planOptions = [
    { value: 'all', label: t('admin.subs.allPlans') },
    { value: 'essential', label: 'Essential' },
    { value: 'pro', label: 'Pro' },
    { value: 'elite', label: 'Elite' },
  ];

  return (
    <div className="min-h-screen pb-16" style={{ background: '#000' }}>
      <div className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(232,25,44,.05),transparent 55%)' }} />

      <div className="relative z-10 mx-auto max-w-[1340px] px-4 sm:px-6 py-6 space-y-6">
        {/* Header */}
        <div>
          <h1 style={{ color: T1, fontSize: 'clamp(22px,3vw,28px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1 }}>
            {t('admin.subs.title')}
          </h1>
          <p style={{ color: T3, fontSize: 13, marginTop: 4 }}>{t('admin.subs.subtitle')}</p>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {kpiCards.map((kpi) => {
            const Icon: LucideIcon = kpi.icon;
            const valueColor = kpi.tone === 'neg' ? NEG : kpi.tone === 'pos' ? POS : T1;
            const iconColor = kpi.tone === 'neg' ? NEG : kpi.tone === 'pos' ? POS : T2;
            return (
              <div
                key={kpi.label}
                style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 16, boxShadow: CARD_SHADOW, padding: '16px 18px' }}
                className="flex items-center gap-3"
              >
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-xl flex-none"
                  style={{ background: C_FAINT, border: `1px solid ${F_BORDER}` }}
                >
                  <Icon className="h-5 w-5" style={{ color: iconColor }} />
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
            <input placeholder={t('admin.subs.searchVenue')} value={search} onChange={(e) => setSearch(e.target.value)} style={inputStyle} />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={selectStyle}>
            {statusOptions.map(o => <option key={o.value} value={o.value} style={{ background: '#0a0a0c', color: T1 }}>{o.label}</option>)}
          </select>
          <select value={planFilter} onChange={(e) => setPlanFilter(e.target.value)} style={selectStyle}>
            {planOptions.map(o => <option key={o.value} value={o.value} style={{ background: '#0a0a0c', color: T1 }}>{o.label}</option>)}
          </select>
        </div>

        {/* Table */}
        <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, overflow: 'hidden' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]" style={{ minWidth: 680 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${F_BORDER}` }}>
                  {[t('admin.subs.venue'), t('admin.subs.plan'), t('admin.subs.status'), t('admin.subs.periodEnd'), t('admin.subs.trialEnd'), t('admin.subs.earlyAdopter')].map((h, i) => (
                    <th key={i} className="px-4 py-3 text-left font-medium" style={{ color: T3, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="text-center py-10">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 mx-auto mb-2" style={{ borderColor: `${BORDER} ${BORDER} ${BORDER} ${RED}` }} />
                    <span style={{ color: T3, fontSize: 12 }}>{t('admin.subs.loading')}</span>
                  </td></tr>
                ) : data.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-12">
                    <CreditCard className="h-9 w-9 mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.12)' }} />
                    <span style={{ color: T3, fontSize: 12 }}>{t('admin.subs.noResults')}</span>
                  </td></tr>
                ) : data.map((s, index) => (
                  <tr key={s.id} style={{ borderBottom: index < data.length - 1 ? `1px solid ${F_BORDER}` : 'none' }}>
                    <td className="px-4 py-3">
                      <Link to={`/admin/directory/venue/${s.venue_id}`} className="font-[560] hover:opacity-80 transition-opacity" style={{ color: RED }}>{s.venueName}</Link>
                    </td>
                    <td className="px-4 py-3">
                      <span style={{ ...planPillStyle(s.subscription_plan), fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 999, display: 'inline-block' }}>
                        {planLabel(s.subscription_plan)}
                      </span>
                    </td>
                    <td className="px-4 py-3"><StatusPill status={s.status} /></td>
                    <td className="px-4 py-3 tabular-nums" style={{ color: T2 }}>{s.current_period_end ? format(new Date(s.current_period_end), 'dd/MM/yyyy') : '—'}</td>
                    <td className="px-4 py-3 tabular-nums" style={{ color: T2 }}>{s.trial_end ? format(new Date(s.trial_end), 'dd/MM/yyyy') : '—'}</td>
                    <td className="px-4 py-3">
                      {s.is_early_adopter ? (
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-bold uppercase tracking-wider"
                            style={{ background: 'rgba(167,139,250,0.12)', border: '1px solid rgba(167,139,250,0.3)', color: '#A78BFA' }}>
                            <Gem className="w-3 h-3" />{t('admin.subs.ea')}
                          </span>
                          {s.price_locked && <Lock className="w-3.5 h-3.5" style={{ color: POS }} aria-label={t('plan.priceLockedBadge')} />}
                          <button onClick={() => revokeEarlyAdopter(s.venue_id)} className="text-[11px] cursor-pointer hover:opacity-80" style={{ color: T3 }}>
                            {t('admin.subs.revoke')}
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => { setGrantTarget({ venueId: s.venue_id, venueName: s.venueName }); setGrantPlan('pro'); }}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer transition-all duration-150"
                          style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}>
                          <Gem className="w-3 h-3" />{t('admin.subs.makeEa')}
                        </button>
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

      {/* Grant early-adopter modal */}
      {grantTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={() => !granting && setGrantTarget(null)}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 24, width: '100%', maxWidth: 420 }}>
            <div className="flex items-start justify-between gap-3 mb-1">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: 'rgba(167,139,250,0.12)' }}>
                  <Gem className="w-4 h-4" style={{ color: '#A78BFA' }} />
                </div>
                <h2 style={{ color: T1, fontSize: 16, fontWeight: 700 }}>{t('admin.subs.grantEaTitle')}</h2>
              </div>
              <button onClick={() => !granting && setGrantTarget(null)} className="cursor-pointer"><X className="w-4 h-4" style={{ color: T3 }} /></button>
            </div>
            <p style={{ color: T2, fontSize: 13, marginBottom: 4 }}>{grantTarget.venueName}</p>
            <p style={{ color: T3, fontSize: 12, marginBottom: 16 }}>
              {t('admin.subs.grantEaDesc').replace('{days}', String(EARLY_ADOPTER_FREE_DAYS))}
            </p>

            <label style={{ color: T3, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('admin.subs.plan')}</label>
            <select value={grantPlan} onChange={(e) => setGrantPlan(e.target.value as PlanCode)} style={{ ...selectStyle, width: '100%', marginTop: 6, marginBottom: 20 }}>
              {PAID_PLANS.map((code) => (
                <option key={code} value={code} style={{ background: '#0a0a0c', color: T1 }}>{PLANS[code].name} — {PLANS[code].price}€/mo</option>
              ))}
            </select>

            <div className="flex gap-2 justify-end">
              <button onClick={() => setGrantTarget(null)} disabled={granting}
                className="px-4 py-2 rounded-xl text-[12.5px] font-medium cursor-pointer disabled:opacity-50"
                style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}>
                {t('admin.subs.cancel')}
              </button>
              <button onClick={grantEarlyAdopter} disabled={granting}
                className="px-4 py-2 rounded-xl text-[12.5px] font-semibold cursor-pointer disabled:opacity-50"
                style={{ background: '#A78BFA', color: '#0a0a0c' }}>
                {granting ? '…' : t('admin.subs.grantEaConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
