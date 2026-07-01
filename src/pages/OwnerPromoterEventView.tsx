import { useState, useEffect, useMemo } from 'react';
import { translate } from '@/i18n/orgTranslate';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { usePromoterScope } from '@/hooks/usePromoterScope';
import { getScopeFilter, scopeReady, scopeId } from '@/lib/promoterScopeHelpers';
import { useDashboardMode } from '@/contexts/DashboardModeContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { OwnerPageSkeleton } from '@/components/DashboardSkeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Plus, Ticket, Target, Trash2, Settings2, Check, Trophy, BarChart3, MousePointerClick } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import {
  PromoHeader, PromoPage, PromoCard, StatTile, SectionLabel, PromoButton, PromoProgress,
  PromoAvatar, PromoEmpty, RED, POS, WARN, T1, T2, T3, BORDER, F_BORDER, TILE_BG, INNER_BG,
} from '@/components/promoter/promoter-ui';

interface PromoterEventPerf {
  promoterId: string;
  name: string;
  promoCode: string;
  profileImage: string | null;
  tickets: number;
  tables: number;
  revenue: number;
  clicks: number;
  commission: number;
  pendingCommission: number;
  paidCommission: number;
  conversionRate: number;
  goalTarget: number | null;
  maxTickets: number | null;
  canAccessGuestlist: boolean;
  canAccessTables: boolean;
  assignmentId: string | null;
}

const CHART_COLORS = ['#E8192C', '#FF5C63', '#34D399', '#FBBF24', '#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#84cc16'];

export default function OwnerPromoterEventView() {
  const { eventId } = useParams<{ eventId: string }>();
  const [searchParams] = useSearchParams();
  const filterPromoterId = searchParams.get('promoter');
  const navigate = useNavigate();
  const scope = usePromoterScope();
  const sid = scopeId(scope);
  const scopeFilter = getScopeFilter(scope);
  const { basePath } = useDashboardMode();
  const { t, language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [eventTitle, setEventTitle] = useState('');
  const [performers, setPerformers] = useState<PromoterEventPerf[]>([]);
  const [loading, setLoading] = useState(true);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [availablePromoters, setAvailablePromoters] = useState<Array<{ id: string; name: string; promoCode: string }>>([]);
  const [selectedPromoterId, setSelectedPromoterId] = useState<string>('');
  const [sortBy, setSortBy] = useState<'tickets' | 'revenue' | 'conversionRate'>('tickets');

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingPerf, setEditingPerf] = useState<PromoterEventPerf | null>(null);
  const [editMaxTickets, setEditMaxTickets] = useState('');
  const [editGoalTarget, setEditGoalTarget] = useState('');
  const [editCanAccessGuestlist, setEditCanAccessGuestlist] = useState(false);
  const [editCanAccessTables, setEditCanAccessTables] = useState(true);

  useEffect(() => { if (eventId && scopeReady(scope)) fetchData(); }, [eventId, sid]);

  async function fetchData() {
    if (!eventId || !sid) return;
    setLoading(true);
    try {
      const { data: evt } = await supabase.from('events').select('title').eq('id', eventId).maybeSingle();
      setEventTitle(evt?.title || '');

      const { data: assignments } = await supabase.from('promoter_event_assignments')
        .select('id, promoter_id, goal_target, max_tickets, can_access_guestlist, can_access_tables').eq('event_id', eventId);

      const hasAssignments = (assignments || []).length > 0;
      let promoterIds: string[];
      const assignmentMap = new Map<string, typeof assignments extends (infer T)[] | null ? T : never>();

      if (hasAssignments) {
        promoterIds = assignments!.map(a => a.promoter_id);
        assignments!.forEach(a => assignmentMap.set(a.promoter_id, a));
      } else {
        const { data: allPromoters } = await supabase.from('promoters')
          .select('id').eq(scopeFilter.column, sid).eq('is_active', true).is('agency_id', null);
        promoterIds = (allPromoters || []).map(p => p.id);
      }

      if (promoterIds.length === 0) { setPerformers([]); setLoading(false); return; }

      const { data: promoters } = await supabase.from('promoters').select('id, user_id, promo_code, profile_image_url').in('id', promoterIds);
      const userIds = (promoters || []).map(p => p.user_id);
      const { data: profiles } = await supabase.from('profiles').select('id, first_name, last_name, email').in('id', userIds);
      const profileMap = new Map((profiles || []).map(p => [p.id, p]));

      const [clicksRes, convsRes] = await Promise.all([
        supabase.from('promoter_clicks').select('promoter_id').eq('event_id', eventId).in('promoter_id', promoterIds),
        supabase.from('promoter_conversions').select('promoter_id, amount, commission, conversion_type, status').eq('event_id', eventId).in('promoter_id', promoterIds),
      ]);

      const clickMap: Record<string, number> = {};
      (clicksRes.data || []).forEach(c => { clickMap[c.promoter_id] = (clickMap[c.promoter_id] || 0) + 1; });

      const convMap: Record<string, { tickets: number; tables: number; revenue: number; commission: number; pending: number; paid: number }> = {};
      (convsRes.data || []).forEach(c => {
        if (!convMap[c.promoter_id]) convMap[c.promoter_id] = { tickets: 0, tables: 0, revenue: 0, commission: 0, pending: 0, paid: 0 };
        if (c.conversion_type === 'ticket' && Number(c.amount || 0) > 0) convMap[c.promoter_id].tickets++;
        if (c.conversion_type === 'table' && Number(c.amount || 0) > 0) convMap[c.promoter_id].tables++;
        convMap[c.promoter_id].revenue += Number(c.amount || 0);
        convMap[c.promoter_id].commission += Number(c.commission || 0);
        if (c.status === 'pending') convMap[c.promoter_id].pending += Number(c.commission || 0);
        if (c.status === 'paid') convMap[c.promoter_id].paid += Number(c.commission || 0);
      });

      const mapped: PromoterEventPerf[] = promoterIds.map(pid => {
        const promo = (promoters || []).find(p => p.id === pid);
        const profile = promo ? profileMap.get(promo.user_id) : null;
        const clk = clickMap[pid] || 0;
        const cv = convMap[pid] || { tickets: 0, tables: 0, revenue: 0, commission: 0, pending: 0, paid: 0 };
        const assignment = assignmentMap.get(pid);
        return {
          promoterId: pid,
          assignmentId: assignment?.id || null,
          name: profile ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || profile.email : 'N/A',
          promoCode: promo?.promo_code || '',
          profileImage: promo?.profile_image_url || null,
          tickets: cv.tickets, tables: cv.tables, revenue: cv.revenue, clicks: clk,
          commission: cv.commission, pendingCommission: cv.pending, paidCommission: cv.paid,
          conversionRate: clk > 0 ? (cv.tickets / clk) * 100 : 0,
          goalTarget: assignment?.goal_target || null,
          maxTickets: assignment?.max_tickets || null,
          canAccessGuestlist: assignment?.can_access_guestlist ?? false,
          canAccessTables: assignment?.can_access_tables ?? true,
        };
      });

      const finalPerformers = filterPromoterId ? mapped.filter(p => p.promoterId === filterPromoterId) : mapped;
      setPerformers(finalPerformers);
    } catch (err) {
      console.error(err);
    } finally { setLoading(false); }
  }

  const sortedPerformers = useMemo(() => {
    return [...performers].sort((a, b) => {
      if (sortBy === 'tickets') return b.tickets - a.tickets;
      if (sortBy === 'revenue') return b.revenue - a.revenue;
      return b.conversionRate - a.conversionRate;
    });
  }, [performers, sortBy]);

  const top3 = sortedPerformers.slice(0, 3);

  async function openAddDialog() {
    if (!sid || !eventId) return;
    const { data: allPromoters } = await supabase.from('promoters').select('id, user_id, promo_code').eq(scopeFilter.column, sid).eq('is_active', true).is('agency_id', null);
    const assignedIds = performers.map(p => p.promoterId);
    const unassigned = (allPromoters || []).filter(p => !assignedIds.includes(p.id));
    const userIds = unassigned.map(p => p.user_id);
    if (userIds.length === 0) { setAvailablePromoters([]); setSelectedPromoterId(''); setAddDialogOpen(true); return; }
    const { data: profiles } = await supabase.from('profiles').select('id, first_name, last_name, email').in('id', userIds);
    const profileMap = new Map((profiles || []).map(p => [p.id, p]));
    setAvailablePromoters(unassigned.map(p => {
      const prof = profileMap.get(p.user_id);
      return { id: p.id, name: prof ? `${prof.first_name || ''} ${prof.last_name || ''}`.trim() || prof.email : p.promo_code, promoCode: p.promo_code };
    }));
    setSelectedPromoterId('');
    setAddDialogOpen(true);
  }

  async function addPromoterToEvent() {
    if (!selectedPromoterId || !eventId) return;
    const { error } = await supabase.from('promoter_event_assignments').insert({
      promoter_id: selectedPromoterId, event_id: eventId, status: 'active',
    });
    if (error) { toast.error(t('promoterEvent.addError')); return; }
    toast.success(t('promoterEvent.added'));
    setAddDialogOpen(false);
    fetchData();
  }

  async function removeFromEvent(assignmentId: string) {
    await supabase.from('promoter_event_assignments').delete().eq('id', assignmentId);
    toast.success(t('promoterEvent.removed'));
    fetchData();
  }

  function openEditDialog(p: PromoterEventPerf) {
    setEditingPerf(p);
    setEditMaxTickets(p.maxTickets?.toString() || '');
    setEditGoalTarget(p.goalTarget?.toString() || '');
    setEditCanAccessGuestlist(p.canAccessGuestlist);
    setEditCanAccessTables(p.canAccessTables);
    setEditDialogOpen(true);
  }

  async function saveAssignment() {
    if (!editingPerf) return;
    if (!editingPerf.assignmentId) {
      const { error } = await supabase.from('promoter_event_assignments').insert({
        promoter_id: editingPerf.promoterId, event_id: eventId, status: 'active',
        max_tickets: editMaxTickets ? parseInt(editMaxTickets) : null,
        goal_target: editGoalTarget ? parseInt(editGoalTarget) : null,
        can_access_guestlist: editCanAccessGuestlist,
        can_access_tables: editCanAccessTables,
      });
      if (error) { toast.error(t('common.error')); return; }
    } else {
      const { error } = await supabase.from('promoter_event_assignments').update({
        max_tickets: editMaxTickets ? parseInt(editMaxTickets) : null,
        goal_target: editGoalTarget ? parseInt(editGoalTarget) : null,
        can_access_guestlist: editCanAccessGuestlist,
        can_access_tables: editCanAccessTables,
      }).eq('id', editingPerf.assignmentId);
      if (error) { toast.error(t('common.error')); return; }
    }
    toast.success(t('promoterDetail.saved'));
    setEditDialogOpen(false);
    fetchData();
  }

  const totalTickets = performers.reduce((s, p) => s + p.tickets, 0);
  const totalRevenue = performers.reduce((s, p) => s + p.revenue, 0);
  const totalCommission = performers.reduce((s, p) => s + p.commission, 0);
  const totalPending = performers.reduce((s, p) => s + p.pendingCommission, 0);
  const totalPaid = performers.reduce((s, p) => s + p.paidCommission, 0);
  const totalClicks = performers.reduce((s, p) => s + p.clicks, 0);

  const revenueChartData = sortedPerformers.filter(p => p.revenue > 0).map(p => ({
    name: p.name.split(' ')[0] || p.promoCode, revenue: Math.round(p.revenue),
  }));
  const clicksConvData = sortedPerformers.filter(p => p.clicks > 0).map(p => ({
    name: p.name.split(' ')[0] || p.promoCode, clicks: p.clicks, conversions: p.tickets + p.tables,
  }));

  const chartTooltip = { background: '#0a0a0c', border: `1px solid ${BORDER}`, borderRadius: 10, color: T1, fontSize: 12 };

  if (loading) return <OwnerPageSkeleton />;

  return (
    <>
      <PromoHeader
        title={filterPromoterId && performers.length === 1 ? performers[0].name : (eventTitle || t('promoterEvent.title'))}
        subtitle={filterPromoterId && performers.length === 1 ? eventTitle : tt('Activation & performance promoteurs', 'Promoter activation & performance')}
        backTo={filterPromoterId ? `${basePath}/promoters/${filterPromoterId}` : `${basePath}/promoters`}
        right={<PromoButton size="sm" onClick={openAddDialog}><Plus className="h-4 w-4" />{t('promoterEvent.addPromoter')}</PromoButton>}
      />

      <PromoPage>
        {/* Top KPIs */}
        <div className="grid grid-cols-4 gap-2.5">
          <StatTile icon={MousePointerClick} value={totalClicks} label={tt('Clics', 'Clicks')} />
          <StatTile icon={Ticket} value={totalTickets} label={tt('Ventes', 'Sales')} />
          <StatTile value={`${totalRevenue.toFixed(0)}€`} label={tt('CA', 'Revenue')} />
          <StatTile value={`${totalCommission.toFixed(0)}€`} label="Commission" accent />
        </div>

        {/* Commission split */}
        <PromoCard style={{ padding: 14 }}>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div><p style={{ color: T1, fontSize: 15, fontWeight: 720, margin: 0 }}>{totalCommission.toFixed(0)}€</p><p style={{ color: T3, fontSize: 10.5, margin: 0 }}>{tt('Générée', 'Generated')}</p></div>
            <div><p style={{ color: WARN, fontSize: 15, fontWeight: 720, margin: 0 }}>{totalPending.toFixed(0)}€</p><p style={{ color: T3, fontSize: 10.5, margin: 0 }}>{tt('En attente', 'Pending')}</p></div>
            <div><p style={{ color: POS, fontSize: 15, fontWeight: 720, margin: 0 }}>{totalPaid.toFixed(0)}€</p><p style={{ color: T3, fontSize: 10.5, margin: 0 }}>{tt('Payée', 'Paid')}</p></div>
          </div>
        </PromoCard>

        {/* Leaderboard */}
        {top3.length > 0 && (
          <PromoCard>
            <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
              <Trophy className="h-4 w-4" style={{ color: RED }} />
              <h3 style={{ color: T1, fontSize: 14, fontWeight: 640, margin: 0 }}>{tt('Top promoteurs', 'Top promoters')}</h3>
            </div>
            <div className="space-y-1">
              {top3.map((p, i) => (
                <div key={p.promoterId} className="flex items-center gap-3" style={{ padding: '6px 0' }}>
                  <span style={{ color: i === 0 ? RED : T3, fontSize: 15, fontWeight: 760, width: 18 }}>{i + 1}</span>
                  <PromoAvatar src={p.profileImage} fallback={p.name[0] || p.promoCode[0]} size={30} />
                  <span className="flex-1 truncate" style={{ color: T1, fontSize: 13, fontWeight: 540 }}>{p.name}</span>
                  <span style={{ color: T1, fontSize: 13, fontWeight: 700 }}>{p.tickets}</span>
                  <span style={{ color: T3, fontSize: 11.5 }}>{p.revenue.toFixed(0)}€</span>
                </div>
              ))}
            </div>
          </PromoCard>
        )}

        {/* Revenue chart */}
        {revenueChartData.length > 0 && (
          <PromoCard>
            <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
              <BarChart3 className="h-4 w-4" style={{ color: T3 }} />
              <h3 style={{ color: T1, fontSize: 13.5, fontWeight: 620, margin: 0 }}>{tt('CA par promoteur', 'Revenue per promoter')}</h3>
            </div>
            <ResponsiveContainer width="100%" height={190}>
              <BarChart data={revenueChartData}>
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: T3 }} axisLine={{ stroke: F_BORDER }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: T3 }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v: number) => `${v}€`} contentStyle={chartTooltip} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                <Bar dataKey="revenue" name={tt('CA', 'Revenue')} radius={[5, 5, 0, 0]}>
                  {revenueChartData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </PromoCard>
        )}

        {/* Clicks vs conversions */}
        {clicksConvData.length > 0 && (
          <PromoCard>
            <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
              <MousePointerClick className="h-4 w-4" style={{ color: T3 }} />
              <h3 style={{ color: T1, fontSize: 13.5, fontWeight: 620, margin: 0 }}>{tt('Clics vs conversions', 'Clicks vs conversions')}</h3>
            </div>
            <ResponsiveContainer width="100%" height={190}>
              <BarChart data={clicksConvData}>
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: T3 }} axisLine={{ stroke: F_BORDER }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: T3 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={chartTooltip} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                <Bar dataKey="clicks" name={tt('Clics', 'Clicks')} fill="rgba(255,255,255,0.22)" radius={[5, 5, 0, 0]} />
                <Bar dataKey="conversions" name="Conversions" fill={RED} radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </PromoCard>
        )}

        {/* Sort */}
        <div className="flex items-center justify-between">
          <SectionLabel>{tt('Promoteurs', 'Promoters')} ({performers.length})</SectionLabel>
          <Select value={sortBy} onValueChange={v => setSortBy(v as any)}>
            <SelectTrigger className="w-36 h-8 text-xs" style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="tickets">{tt('Trier par ventes', 'Sort by sales')}</SelectItem>
              <SelectItem value="revenue">{tt('Trier par CA', 'Sort by revenue')}</SelectItem>
              <SelectItem value="conversionRate">{tt('Trier par conversion', 'Sort by conversion')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Per-promoter cards */}
        {sortedPerformers.length === 0 ? (
          <PromoEmpty icon={Ticket} title={t('promoterEvent.noPromoters')} />
        ) : (
          <div className="space-y-2.5">
            {sortedPerformers.map(p => (
              <PromoCard key={p.promoterId} onClick={() => navigate(`${basePath}/promoters/${p.promoterId}`)}>
                <div className="flex items-center gap-3 mb-3">
                  <PromoAvatar src={p.profileImage} fallback={p.name[0] || p.promoCode[0]} size={36} />
                  <div className="flex-1 min-w-0">
                    <p className="truncate" style={{ color: T1, fontSize: 14, fontWeight: 620, margin: 0 }}>{p.name}</p>
                    <p style={{ color: T3, fontSize: 11.5, fontFamily: 'monospace', margin: 0 }}>@{p.promoCode}</p>
                  </div>
                  <button onClick={e => { e.stopPropagation(); openEditDialog(p); }} aria-label={tt('Configurer', 'Configure')}
                    style={{ width: 32, height: 32, borderRadius: 9, background: INNER_BG, border: `1px solid ${BORDER}`, color: T2, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                    <Settings2 className="h-4 w-4" />
                  </button>
                  {p.assignmentId && (
                    <button onClick={e => { e.stopPropagation(); removeFromEvent(p.assignmentId!); }} aria-label={tt('Retirer', 'Remove')}
                      style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(255,92,99,0.08)', border: '1px solid rgba(255,92,99,0.2)', color: '#FF5C63', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-5 gap-1.5 text-center">
                  {[
                    { v: p.clicks, l: tt('Clics', 'Clicks') }, { v: p.tickets, l: tt('Ventes', 'Sales') }, { v: p.tables, l: 'Tables' },
                    { v: `${p.revenue.toFixed(0)}€`, l: tt('CA', 'Rev.') },
                  ].map((s, i) => (
                    <div key={i} style={{ background: TILE_BG, borderRadius: 8, padding: '7px 3px' }}>
                      <p style={{ color: T1, fontSize: 13, fontWeight: 700, margin: 0 }}>{s.v}</p>
                      <p style={{ color: T3, fontSize: 9, margin: 0 }}>{s.l}</p>
                    </div>
                  ))}
                  <div style={{ background: 'rgba(232,25,44,0.08)', borderRadius: 8, padding: '7px 3px' }}>
                    <p style={{ color: RED, fontSize: 13, fontWeight: 700, margin: 0 }}>{p.commission.toFixed(0)}€</p>
                    <p style={{ color: T3, fontSize: 9, margin: 0 }}>Comm.</p>
                  </div>
                </div>

                <div className="flex items-center justify-between" style={{ marginTop: 8, color: T3, fontSize: 11 }}>
                  <span>{tt('Conv.', 'Conv.')} {p.conversionRate.toFixed(1)}%</span>
                  <span>{tt(`En attente ${p.pendingCommission.toFixed(0)}€ · Payée ${p.paidCommission.toFixed(0)}€`, `Pending ${p.pendingCommission.toFixed(0)}€ · Paid ${p.paidCommission.toFixed(0)}€`, `Pendiente ${p.pendingCommission.toFixed(0)}€ · Pagada ${p.paidCommission.toFixed(0)}€`)}</span>
                </div>

                {p.maxTickets && p.maxTickets > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div className="flex items-center justify-between" style={{ fontSize: 11, marginBottom: 5 }}>
                      <span className="flex items-center gap-1" style={{ color: T2 }}><Ticket className="h-3 w-3" />{t('promoterQuotas.maxTickets')}</span>
                      <span style={{ color: p.tickets >= p.maxTickets ? '#FF5C63' : T2, fontWeight: 600 }}>{p.tickets}/{p.maxTickets}</span>
                    </div>
                    <PromoProgress value={(p.tickets / p.maxTickets) * 100} tone={p.tickets >= p.maxTickets ? 'pos' : 'red'} height={6} />
                  </div>
                )}
                {p.goalTarget && p.goalTarget > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div className="flex items-center justify-between" style={{ fontSize: 11, marginBottom: 5 }}>
                      <span className="flex items-center gap-1" style={{ color: T2 }}><Target className="h-3 w-3" />{t('promoterEvent.goal')}</span>
                      <span style={{ color: T2, fontWeight: 600 }}>{p.tickets}/{p.goalTarget}</span>
                    </div>
                    <PromoProgress value={(p.tickets / p.goalTarget) * 100} tone="warn" height={6} />
                  </div>
                )}
              </PromoCard>
            ))}
          </div>
        )}
      </PromoPage>

      {/* Add promoter dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('promoterEvent.addPromoter')}</DialogTitle></DialogHeader>
          {availablePromoters.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">{t('promoterEvent.allAssigned')}</p>
          ) : (
            <div className="space-y-4">
              <div>
                <Label>{t('promoterEvent.selectPromoter')}</Label>
                <Select value={selectedPromoterId} onValueChange={setSelectedPromoterId}>
                  <SelectTrigger><SelectValue placeholder={t('promoterEvent.choose')} /></SelectTrigger>
                  <SelectContent>
                    {availablePromoters.map(p => <SelectItem key={p.id} value={p.id}>{p.name} (@{p.promoCode})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <PromoButton variant="secondary" onClick={() => setAddDialogOpen(false)}>{t('common.cancel')}</PromoButton>
            <PromoButton onClick={addPromoterToEvent} disabled={!selectedPromoterId}>{t('promoterEvent.add')}</PromoButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit assignment dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingPerf?.name} — {t('promoterDetail.settings')}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t('promoterQuotas.maxTickets')}</Label>
              <Input type="number" value={editMaxTickets} onChange={e => setEditMaxTickets(e.target.value)} placeholder={t('promoterQuotas.noLimit')} />
            </div>
            <div>
              <Label>{t('promoterEvent.goal')}</Label>
              <Input type="number" value={editGoalTarget} onChange={e => setEditGoalTarget(e.target.value)} placeholder={t('promoterQuotas.noLimit')} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>{t('promoterQuotas.guestlistAccess')}</Label>
                <p className="text-xs text-muted-foreground">{t('promoterQuotas.guestlistAccessDesc')}</p>
              </div>
              <Switch checked={editCanAccessGuestlist} onCheckedChange={setEditCanAccessGuestlist} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>{t('promoterQuotas.tablesAccess')}</Label>
                <p className="text-xs text-muted-foreground">{t('promoterQuotas.tablesAccessDesc')}</p>
              </div>
              <Switch checked={editCanAccessTables} onCheckedChange={setEditCanAccessTables} />
            </div>
          </div>
          <DialogFooter>
            <PromoButton variant="secondary" onClick={() => setEditDialogOpen(false)}>{t('common.cancel')}</PromoButton>
            <PromoButton onClick={saveAssignment}><Check className="h-4 w-4" />{t('promoterDetail.save')}</PromoButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
