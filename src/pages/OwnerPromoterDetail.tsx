import { useState, useEffect } from 'react';
import { translate } from '@/i18n/orgTranslate';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { usePromoterScope } from '@/hooks/usePromoterScope';
import { getScopeFilter, scopeId, scopeEventsOr } from '@/lib/promoterScopeHelpers';
import { useDashboardMode } from '@/contexts/DashboardModeContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { OwnerPageSkeleton } from '@/components/DashboardSkeleton';
import { DateRangeFilter } from '@/components/promoter/DateRangeFilter';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { MessageCircle, Copy, TrendingUp, Euro, Ticket, Trash2, MousePointerClick, ArrowRight, Gift, Star, Layers, Calendar } from 'lucide-react';
import { Instagram } from '@/components/icons/Instagram';
import type { Promoter, PromoterConversion, CommissionTemplate, CommissionRuleTier, CommissionRules } from '@/types/promoter';
import {
  PromoHeader, PromoPage, PromoCard, StatTile, SectionLabel, PromoPill, PromoButton, PromoProgress,
  PromoAvatar, PromoEmpty, RED, POS, WARN, T1, T2, T3, BORDER, F_BORDER, TILE_BG, INNER_BG,
} from '@/components/promoter/promoter-ui';

type DateRange = '7d' | '30d' | '90d' | 'all';

// Forme réellement lue par getRewardLabel ; le JSON DB peut porter d'autres clés, ignorées ici.
interface RewardConfig {
  ticketValue?: number | string;
  value?: number | string;
  entryCount?: number;
  vipType?: string;
  drinkCount?: number;
  drinkCategory?: string;
}

interface RewardInfo {
  type: 'money' | 'tiers' | 'flat_advantage';
  tiers?: CommissionRuleTier[];
  currentTierIndex?: number;
  totalConversions: number;
  rewardType?: string;
  rewardConfig?: RewardConfig;
  rewardEarnedCounts?: Record<string, number>;
}

function getRewardLabel(t: (k: string) => string, rewardType: string, rewardConfig: RewardConfig = {}): string {
  if (rewardType === 'money') return t('owner.promoB.rewardPerSale').replace('{x}', String(rewardConfig?.ticketValue || rewardConfig?.value || 0));
  if (rewardType === 'free_entry') return t('owner.promoB.freeEntries').replace('{n}', String(rewardConfig?.entryCount || 1));
  if (rewardType === 'vip') return t('owner.promoB.vipAccess') + (rewardConfig?.vipType ? ` (${rewardConfig.vipType})` : '');
  if (rewardType === 'drinks') return t('owner.promoB.freeDrinks').replace('{n}', String(rewardConfig?.drinkCount || 1)) + (rewardConfig?.drinkCategory ? ` (${rewardConfig.drinkCategory})` : '');
  if (rewardType === 'none') return t('owner.promoB.rewardNone');
  return rewardType;
}

export default function OwnerPromoterDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const scope = usePromoterScope();
  const sid = scopeId(scope);
  const scopeFilter = getScopeFilter(scope);
  const { basePath } = useDashboardMode();
  const { t, language } = useLanguage();
  const tt = (fr: string, en: string, es?: string) => translate(language, fr, en, es);
  const [promoter, setPromoter] = useState<Promoter | null>(null);
  const [conversions, setConversions] = useState<PromoterConversion[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange>('30d');
  const [eventFilter, setEventFilter] = useState<string | null>(null);
  const [events, setEvents] = useState<Array<{ id: string; title: string; start_at: string; end_at: string }>>([]);
  const [templates, setTemplates] = useState<CommissionTemplate[]>([]);
  const [assignedEvents, setAssignedEvents] = useState<Array<{ eventId: string; title: string; tickets: number; revenue: number; commission: number }>>([]);

  const [stats, setStats] = useState({ totalClicks: 0, totalConversions: 0, totalRevenue: 0, totalCommission: 0, pendingCommission: 0, ticketsSold: 0, tablesReserved: 0 });
  const [rewardInfo, setRewardInfo] = useState<RewardInfo | null>(null);

  const [editForm, setEditForm] = useState({
    promoCode: '', instagramUrl: '', whatsappNumber: '',
    ticketCommissionType: 'percentage' as 'fixed' | 'percentage',
    ticketCommissionValue: 0,
    tableCommissionType: 'percentage' as 'fixed' | 'percentage',
    tableCommissionValue: 0,
    isActive: true,
    defaultCommissionTemplateId: null as string | null,
    guestListTemplateId: null as string | null,
    clientDiscountTemplateId: null as string | null,
    canScanEntries: false,
    autoAssignEvents: false,
  });

  const dateFrom = (() => {
    if (dateRange === 'all') return null;
    const d = new Date();
    if (dateRange === '7d') d.setDate(d.getDate() - 7);
    else if (dateRange === '30d') d.setDate(d.getDate() - 30);
    else if (dateRange === '90d') d.setDate(d.getDate() - 90);
    return d.toISOString();
  })();

  useEffect(() => {
    if (id && sid) { fetchPromoter(); fetchEvents(); fetchTemplates(); }
  }, [id, sid]);

  useEffect(() => {
    if (id && sid) { fetchStats(); fetchConversions(); fetchAssignedEvents(); }
  }, [id, dateRange, eventFilter, sid]);

  async function fetchPromoter() {
    if (!id) return;
    const { data, error } = await supabase.from('promoters').select('*').eq('id', id).single();
    if (error) { toast.error(t('promoterDetail.loadError')); setLoading(false); return; }
    const { data: profile } = await supabase.from('profiles').select('email, first_name, last_name').eq('id', data.user_id).maybeSingle();
    const mapped: Promoter = {
      id: data.id, userId: data.user_id, venueId: data.venue_id, promoCode: data.promo_code,
      instagramUrl: data.instagram_url, whatsappNumber: data.whatsapp_number, iban: data.iban, bic: data.bic,
      ticketCommissionType: data.ticket_commission_type as 'fixed' | 'percentage', ticketCommissionValue: data.ticket_commission_value,
      tableCommissionType: data.table_commission_type as 'fixed' | 'percentage', tableCommissionValue: data.table_commission_value,
      pendingAmount: data.pending_amount, totalPaid: data.total_paid, isActive: data.is_active,
      createdAt: data.created_at, updatedAt: data.updated_at,
      defaultCommissionTemplateId: data.default_commission_template_id,
      teamId: data.team_id, canScanEntries: data.can_scan_entries ?? false,
      profileImageUrl: data.profile_image_url,
      email: profile?.email, firstName: profile?.first_name, lastName: profile?.last_name,
    };
    setPromoter(mapped);
    setEditForm({
      promoCode: mapped.promoCode, instagramUrl: mapped.instagramUrl || '', whatsappNumber: mapped.whatsappNumber || '',
      ticketCommissionType: mapped.ticketCommissionType, ticketCommissionValue: mapped.ticketCommissionValue,
      tableCommissionType: mapped.tableCommissionType, tableCommissionValue: mapped.tableCommissionValue,
      isActive: mapped.isActive, defaultCommissionTemplateId: mapped.defaultCommissionTemplateId || null,
      guestListTemplateId: data.guest_list_template_id || null,
      clientDiscountTemplateId: data.client_discount_template_id || null,
      canScanEntries: mapped.canScanEntries,
      autoAssignEvents: data.auto_assign_events ?? false,
    });

    if (data.default_commission_template_id) {
      const { data: tplData } = await supabase.from('commission_templates')
        .select('rules').eq('id', data.default_commission_template_id).maybeSingle();
      // Json généré → forme métier connue des règles de commission (assertion structurelle).
      const rules = tplData?.rules as unknown as CommissionRules | null | undefined;
      if (rules) {
        const tiers = rules.tiers;
        if (tiers && tiers.length > 0) {
          const parsedTiers: CommissionRuleTier[] = tiers.map((t) => ({
            min: t.min, max: t.max ?? null, reward_type: t.reward_type || 'money',
            reward_config: t.reward_config || {},
            ticketValue: t.ticketValue ? Number(t.ticketValue) : undefined,
          }));

          const { data: perEventConvs } = await supabase.from('promoter_conversions')
            .select('event_id').eq('promoter_id', id);
          const eventCounts: Record<string, number> = {};
          (perEventConvs || []).forEach(c => { if (c.event_id) eventCounts[c.event_id] = (eventCounts[c.event_id] || 0) + 1; });

          const earnedCounts: Record<string, number> = {};
          const nonMoneyTiers = parsedTiers.filter(t => t.reward_type !== 'money' && t.reward_type !== 'none');
          nonMoneyTiers.forEach(tier => { earnedCounts[`${tier.reward_type}_${tier.min}`] = 0; });

          Object.values(eventCounts).forEach(eventSales => {
            nonMoneyTiers.forEach(tier => {
              const max = tier.max ?? Infinity;
              if (eventSales >= tier.min && eventSales <= max) earnedCounts[`${tier.reward_type}_${tier.min}`]++;
              else if (eventSales > max) earnedCounts[`${tier.reward_type}_${tier.min}`]++;
            });
          });

          const total = perEventConvs?.length || 0;
          setRewardInfo({ type: 'tiers', tiers: parsedTiers, totalConversions: total, rewardEarnedCounts: earnedCounts });
        } else {
          const { count: totalConvs } = await supabase.from('promoter_conversions')
            .select('id', { count: 'exact', head: true }).eq('promoter_id', id);
          const total = totalConvs || 0;
          const rewardType = rules.reward_type || 'money';
          if (rewardType !== 'money') setRewardInfo({ type: 'flat_advantage', totalConversions: total, rewardType, rewardConfig: rules.reward_config || {} });
          else setRewardInfo({ type: 'money', totalConversions: total });
        }
      }
    } else {
      setRewardInfo(null);
    }
    setLoading(false);
  }

  async function fetchEvents() {
    if (!sid) return;
    const now = new Date().toISOString();
    const orClause = scopeEventsOr(scope);
    let upQ = supabase.from('events').select('id, title, start_at, end_at').gte('end_at', now).order('start_at', { ascending: true }).limit(10);
    let pastQ = supabase.from('events').select('id, title, start_at, end_at').lt('end_at', now).order('start_at', { ascending: false }).limit(10);
    if (orClause) { upQ = upQ.or(orClause); pastQ = pastQ.or(orClause); }
    const { data: upcoming } = await upQ;
    const { data: past } = await pastQ;
    const upcomingIds = new Set((upcoming || []).map(e => e.id));
    const combined = [...(upcoming || []), ...(past || []).filter(e => !upcomingIds.has(e.id))].slice(0, 10);
    setEvents(combined);
  }

  async function fetchTemplates() {
    if (!sid) return;
    const { data } = await supabase.from('commission_templates').select('*').eq(scopeFilter.column, sid);
    setTemplates((data || []).map(d => ({
      // Json généré → CommissionRules (assertion structurelle, même contrainte que fetchPromoter).
      id: d.id, venueId: d.venue_id, name: d.name, rules: d.rules as unknown as CommissionRules,
      isDefault: d.is_default, createdAt: d.created_at, updatedAt: d.updated_at,
    })));
  }

  async function fetchStats() {
    if (!id) return;
    let clicksQ = supabase.from('promoter_clicks').select('id').eq('promoter_id', id);
    if (dateFrom) clicksQ = clicksQ.gte('clicked_at', dateFrom);
    if (eventFilter) clicksQ = clicksQ.eq('event_id', eventFilter);
    let convsQ = supabase.from('promoter_conversions').select('*').eq('promoter_id', id);
    if (dateFrom) convsQ = convsQ.gte('created_at', dateFrom);
    if (eventFilter) convsQ = convsQ.eq('event_id', eventFilter);
    const [clicksRes, convsRes] = await Promise.all([clicksQ, convsQ]);
    const convs = convsRes.data || [];
    setStats({
      totalClicks: clicksRes.data?.length || 0,
      totalConversions: convs.length,
      totalRevenue: convs.reduce((s, c) => s + Number(c.amount || 0), 0),
      totalCommission: convs.reduce((s, c) => s + Number(c.commission || 0), 0),
      pendingCommission: convs.filter(c => c.status === 'pending').reduce((s, c) => s + Number(c.commission || 0), 0),
      ticketsSold: convs.filter(c => c.conversion_type === 'ticket' && Number(c.amount || 0) > 0).length,
      tablesReserved: convs.filter(c => c.conversion_type === 'table' && Number(c.amount || 0) > 0).length,
    });
  }

  async function fetchConversions() {
    if (!id) return;
    let q = supabase.from('promoter_conversions').select('*').eq('promoter_id', id).order('created_at', { ascending: false }).limit(50);
    if (dateFrom) q = q.gte('created_at', dateFrom);
    if (eventFilter) q = q.eq('event_id', eventFilter);
    const { data } = await q;
    // Colonnes nullables DB (null) portées vers les champs optionnels (undefined) du type app : assertion structurelle.
    setConversions((data || []).map((c) => ({
      id: c.id, promoterId: c.promoter_id, orderId: c.order_id, ticketId: c.ticket_id,
      tableReservationId: c.table_reservation_id, conversionType: c.conversion_type,
      amount: c.amount, commission: c.commission, status: c.status, paidAt: c.paid_at, createdAt: c.created_at,
    })) as unknown as PromoterConversion[]);
  }

  async function fetchAssignedEvents() {
    if (!id || !sid) return;
    const { data: assignments } = await supabase.from('promoter_event_assignments')
      .select('event_id').eq('promoter_id', id).eq('status', 'active');
    const hasAssignments = (assignments || []).length > 0;
    let eventIds: string[];
    if (hasAssignments) {
      eventIds = assignments!.map(a => a.event_id);
    } else {
      const now = new Date().toISOString();
      const orClause = scopeEventsOr(scope);
      let q = supabase.from('events').select('id').eq('is_active', true).gte('end_at', now).order('start_at', { ascending: true }).limit(20);
      if (orClause) q = q.or(orClause);
      const { data: upcomingEvents } = await q;
      eventIds = (upcomingEvents || []).map(e => e.id);
    }
    if (eventIds.length === 0) { setAssignedEvents([]); return; }
    const { data: evts } = await supabase.from('events').select('id, title').in('id', eventIds);
    let convsQ = supabase.from('promoter_conversions').select('event_id, amount, commission, conversion_type').eq('promoter_id', id).in('event_id', eventIds);
    if (dateFrom) convsQ = convsQ.gte('created_at', dateFrom);
    const { data: convs } = await convsQ;
    const eventMap = new Map((evts || []).map(e => [e.id, e.title]));
    const statsMap: Record<string, { tickets: number; revenue: number; commission: number }> = {};
    (convs || []).forEach(c => {
      if (!c.event_id) return;
      if (!statsMap[c.event_id]) statsMap[c.event_id] = { tickets: 0, revenue: 0, commission: 0 };
      if (c.conversion_type === 'ticket' && Number(c.amount || 0) > 0) statsMap[c.event_id].tickets++;
      statsMap[c.event_id].revenue += Number(c.amount || 0);
      statsMap[c.event_id].commission += Number(c.commission || 0);
    });
    setAssignedEvents(eventIds.map(eid => ({
      eventId: eid, title: eventMap.get(eid) || 'Event',
      tickets: statsMap[eid]?.tickets || 0, revenue: statsMap[eid]?.revenue || 0, commission: statsMap[eid]?.commission || 0,
    })));
  }

  async function handleSave() {
    if (!id) return;
    setSaving(true);
    try {
      // One unified template drives all three slots: point guest-list / client-discount
      // at the same template only when it actually contains those sections.
      const selTpl = templates.find(tp => tp.id === editForm.defaultCommissionTemplateId);
      const selRules = (selTpl?.rules || {}) as CommissionRules;
      const tplId = editForm.defaultCommissionTemplateId;
      const { error } = await supabase.from('promoters').update({
        promo_code: editForm.promoCode.toUpperCase(),
        instagram_url: editForm.instagramUrl || null,
        whatsapp_number: editForm.whatsappNumber || null,
        ticket_commission_type: editForm.ticketCommissionType,
        ticket_commission_value: editForm.ticketCommissionValue,
        table_commission_type: editForm.tableCommissionType,
        table_commission_value: editForm.tableCommissionValue,
        is_active: editForm.isActive,
        default_commission_template_id: tplId,
        guest_list_template_id: null, // guest-list allocation lives on the Guest List page now
        client_discount_template_id: tplId && selRules.customer_discount ? tplId : null,
        can_scan_entries: editForm.canScanEntries,
        auto_assign_events: editForm.autoAssignEvents,
      }).eq('id', id);
      if (error) throw error;

      // Auto-assignation activée : on rattache immédiatement le promoteur à
      // toutes les soirées à venir du scope (le trigger DB couvre les futures).
      if (editForm.autoAssignEvents) {
        const now = new Date().toISOString();
        const orClause = scopeEventsOr(scope);
        let q = supabase.from('events').select('id').eq('is_active', true).gte('end_at', now).limit(100);
        if (orClause) q = q.or(orClause);
        const { data: upcoming } = await q;
        if (upcoming && upcoming.length > 0) {
          await supabase.from('promoter_event_assignments').upsert(
            upcoming.map(e => ({
              promoter_id: id,
              event_id: e.id,
              commission_template_id: tplId,
              status: 'active',
              can_access_guestlist: true,
              can_access_tables: true,
            })),
            { onConflict: 'promoter_id,event_id', ignoreDuplicates: true },
          );
        }
      }

      toast.success(t('promoterDetail.saved'));
      fetchPromoter();
    } catch (err) {
      if ((err as { code?: string }).code === '23505') toast.error(t('promoterDetail.codeTaken'));
      else toast.error(t('promoterDetail.saveError'));
    } finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!id || !promoter) return;
    await supabase.from('user_roles').delete().eq('user_id', promoter.userId).eq('role', 'promoter');
    await supabase.from('promoters').delete().eq('id', id);
    toast.success(t('promoterDetail.deleted'));
    navigate(`${basePath}/promoters`);
  }

  const promoterLink = `https://yunoapp.eu/promoteur/${editForm.promoCode}`;

  if (loading) return <OwnerPageSkeleton />;

  if (!promoter) {
    return (
      <>
        <PromoHeader title={t('promoterDetail.title')} backTo={`${basePath}/promoters`} />
        <PromoPage><PromoEmpty title={t('promoterDetail.notFound')} /></PromoPage>
      </>
    );
  }

  const conversionRate = stats.totalClicks > 0 ? ((stats.totalConversions / stats.totalClicks) * 100) : 0;
  const fullName = promoter.firstName ? `${promoter.firstName} ${promoter.lastName || ''}`.trim() : promoter.email;

  const labelClass = 'text-xs text-muted-foreground';

  return (
    <>
      <PromoHeader title={t('promoterDetail.title')} subtitle={`@${promoter.promoCode}`} backTo={`${basePath}/promoters`} />

      <PromoPage>
        {/* Profile header */}
        <div className="flex items-center gap-4">
          <PromoAvatar src={promoter.profileImageUrl} fallback={promoter.firstName?.[0] || promoter.promoCode[0]} size={60} />
          <div className="flex-1 min-w-0">
            <h2 className="truncate" style={{ color: T1, fontSize: 20, fontWeight: 720, letterSpacing: '-0.01em', margin: 0 }}>{fullName}</h2>
            <div className="flex items-center gap-2" style={{ marginTop: 5 }}>
              <span style={{ color: T3, fontSize: 12.5, fontFamily: 'monospace' }}>@{promoter.promoCode}</span>
              <PromoPill tone={promoter.isActive ? 'success' : 'muted'}>{promoter.isActive ? t('promoterProgram.active') : t('promoterProgram.inactive')}</PromoPill>
            </div>
          </div>
        </div>

        <DateRangeFilter value={dateRange} onChange={setDateRange} eventFilter={eventFilter} onEventChange={setEventFilter} events={events} />

        {/* Quick contact actions */}
        {(promoter.instagramUrl || promoter.whatsappNumber) && (
          <div className="flex gap-2">
            {promoter.instagramUrl && (
              <PromoButton variant="secondary" size="sm" onClick={() => window.open(promoter.instagramUrl!, '_blank')}>
                <Instagram className="h-4 w-4" />Instagram
              </PromoButton>
            )}
            {promoter.whatsappNumber && (
              <PromoButton variant="secondary" size="sm" onClick={() => window.open(`https://wa.me/${promoter.whatsappNumber!.replace(/\D/g, '')}`, '_blank')}>
                <MessageCircle className="h-4 w-4" />WhatsApp
              </PromoButton>
            )}
          </div>
        )}

        {/* Promo link */}
        <PromoCard style={{ padding: 14 }}>
          <p style={{ color: T3, fontSize: 11, margin: 0, marginBottom: 7 }}>{t('promoterDetail.promoLink')}</p>
          <div className="flex gap-2 items-center">
            <span className="flex-1 truncate" style={{ color: T2, fontSize: 12.5, fontFamily: 'monospace' }}>{promoterLink}</span>
            <button onClick={() => { navigator.clipboard.writeText(promoterLink); toast.success(t('promoterDetail.linkCopied')); }}
              style={{ width: 34, height: 34, borderRadius: 9, background: INNER_BG, border: `1px solid ${BORDER}`, color: T2, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none' }}>
              <Copy className="h-4 w-4" />
            </button>
          </div>
        </PromoCard>

        {/* KPIs */}
        <div className="grid grid-cols-3 gap-2.5">
          <StatTile icon={MousePointerClick} value={stats.totalClicks} label={t('promoterProgram.clicks')} />
          <StatTile icon={Ticket} value={stats.ticketsSold} label={tt('Ventes', 'Sales')} />
          <StatTile icon={Calendar} value={stats.tablesReserved} label="Tables" />
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <StatTile value={`${stats.totalRevenue.toFixed(0)}€`} label={t('promoterProgram.revenue')} />
          <StatTile value={`${stats.pendingCommission.toFixed(0)}€`} label={t('promoterProgram.pendingComm')} accent />
        </div>

        {/* Tabs */}
        <Tabs defaultValue="events" className="w-full">
          <TabsList className="grid w-full grid-cols-3 owner-tabs">
            <TabsTrigger value="events">{t('promoterDetail.events')}</TabsTrigger>
            <TabsTrigger value="conversions">{t('promoterDetail.conversions')}</TabsTrigger>
            <TabsTrigger value="settings">{t('promoterDetail.settings')}</TabsTrigger>
          </TabsList>

          {/* Assigned events */}
          <TabsContent value="events" className="space-y-2.5 mt-4">
            {assignedEvents.length === 0 ? (
              <PromoEmpty icon={Calendar} title={t('promoterDetail.noAssignedEvents')} />
            ) : (
              assignedEvents.map(ae => (
                <PromoCard key={ae.eventId} onClick={() => navigate(`/promoter/event/${ae.eventId}?promoter=${id}`)}>
                  <h4 style={{ color: T1, fontSize: 14, fontWeight: 620, margin: 0, marginBottom: 10 }}>{ae.title}</h4>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    {[{ v: ae.tickets, l: tt('Ventes', 'Sales') }, { v: `${ae.revenue.toFixed(0)}€`, l: t('promoterProgram.revenue') }].map((s, i) => (
                      <div key={i} style={{ background: TILE_BG, borderRadius: 9, padding: '9px 6px' }}>
                        <p style={{ color: T1, fontSize: 15, fontWeight: 700, margin: 0 }}>{s.v}</p>
                        <p style={{ color: T3, fontSize: 10, margin: 0 }}>{s.l}</p>
                      </div>
                    ))}
                    <div style={{ background: 'rgba(232,25,44,0.08)', borderRadius: 9, padding: '9px 6px' }}>
                      <p style={{ color: RED, fontSize: 15, fontWeight: 700, margin: 0 }}>{ae.commission.toFixed(0)}€</p>
                      <p style={{ color: T3, fontSize: 10, margin: 0 }}>Comm.</p>
                    </div>
                  </div>
                </PromoCard>
              ))
            )}
          </TabsContent>

          {/* Conversions */}
          <TabsContent value="conversions" className="space-y-3 mt-4">
            <Select value={eventFilter || 'all'} onValueChange={(v) => setEventFilter(v === 'all' ? null : v)}>
              <SelectTrigger className="w-full h-9 text-sm" style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}>
                <SelectValue placeholder={t('promoterProgram.allEvents')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('promoterProgram.allEvents')}</SelectItem>
                {events.map(e => {
                  const now = new Date();
                  const isLive = new Date(e.start_at) <= now && new Date(e.end_at) >= now;
                  const isUpcoming = new Date(e.start_at) > now;
                  return (
                    <SelectItem key={e.id} value={e.id}>
                      <span className="flex items-center gap-2">
                        {e.title}
                        {isLive && <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-primary text-primary-foreground animate-pulse">LIVE</span>}
                        {isUpcoming && <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-accent text-accent-foreground">{t('owner.promoB.upcoming')}</span>}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>

            {/* Conversion funnel */}
            <PromoCard>
              <h3 style={{ color: T1, fontSize: 13.5, fontWeight: 620, margin: 0, marginBottom: 14 }}>{tt('Funnel de conversion', 'Conversion funnel')}</h3>
              <div className="space-y-3">
                {[
                  { label: tt('Clics', 'Clicks'), value: stats.totalClicks, icon: MousePointerClick, pct: 100 },
                  { label: 'Conversions', value: stats.totalConversions, icon: Ticket, pct: stats.totalClicks > 0 ? (stats.totalConversions / stats.totalClicks) * 100 : 0 },
                  { label: tt('Revenus', 'Revenue'), value: `${stats.totalRevenue.toFixed(0)}€`, icon: Euro, pct: stats.totalClicks > 0 ? (stats.totalConversions / stats.totalClicks) * 100 : 0 },
                  { label: 'Commission', value: `${stats.totalCommission.toFixed(0)}€`, icon: TrendingUp, pct: stats.totalRevenue > 0 ? (stats.totalCommission / stats.totalRevenue) * 100 : 0 },
                ].map((step, i, arr) => (
                  <div key={step.label}>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center shrink-0" style={{ width: 32, height: 32, borderRadius: 999, background: 'rgba(232,25,44,0.10)' }}>
                        <step.icon className="h-4 w-4" style={{ color: RED }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between" style={{ marginBottom: 5 }}>
                          <span style={{ color: T2, fontSize: 13, fontWeight: 540 }}>{step.label}</span>
                          <span style={{ color: T1, fontSize: 13, fontWeight: 700 }}>{step.value}</span>
                        </div>
                        <PromoProgress value={step.pct} height={6} />
                        <p style={{ color: T3, fontSize: 10, margin: 0, marginTop: 3 }}>{step.pct.toFixed(1)}%</p>
                      </div>
                    </div>
                    {i < arr.length - 1 && <div className="flex justify-center" style={{ margin: '4px 0' }}><ArrowRight className="h-3 w-3 rotate-90" style={{ color: T3 }} /></div>}
                  </div>
                ))}
              </div>
            </PromoCard>

            {/* Rewards / compensation */}
            {rewardInfo && rewardInfo.type !== 'money' && (
              <PromoCard>
                <div className="flex items-center gap-2" style={{ marginBottom: 14 }}>
                  <Gift className="h-4 w-4" style={{ color: RED }} />
                  <span style={{ color: T1, fontSize: 13.5, fontWeight: 620 }}>{tt('Récompenses du promoteur', 'Promoter rewards')}</span>
                </div>

                {rewardInfo.type === 'flat_advantage' && rewardInfo.rewardType && (
                  <div className="flex items-center gap-3" style={{ padding: 12, borderRadius: 11, background: 'rgba(232,25,44,0.08)', border: '1px solid rgba(232,25,44,0.2)' }}>
                    <Star className="h-5 w-5 shrink-0" style={{ color: RED }} />
                    <div>
                      <p style={{ color: T1, fontSize: 13, fontWeight: 540, margin: 0 }}>{getRewardLabel(t, rewardInfo.rewardType, rewardInfo.rewardConfig)}</p>
                      <p style={{ color: T3, fontSize: 10, margin: 0, marginTop: 2 }}>{t('owner.promoB.perEventPerk')}</p>
                    </div>
                  </div>
                )}

                {rewardInfo.type === 'tiers' && rewardInfo.tiers && (() => {
                  const nonMoneyTiers = rewardInfo.tiers!.filter(t => t.reward_type !== 'money' && t.reward_type !== 'none');
                  if (nonMoneyTiers.length === 0) return <p style={{ color: T3, fontSize: 12, textAlign: 'center', padding: '8px 0' }}>{t('owner.promoB.noNonMonetaryReward')}</p>;

                  if (eventFilter) {
                    const eventConvs = stats.totalConversions;
                    let currentIdx = 0;
                    for (let i = 0; i < rewardInfo.tiers!.length; i++) {
                      const max = rewardInfo.tiers![i].max ?? Infinity;
                      if (eventConvs >= rewardInfo.tiers![i].min && eventConvs <= max) { currentIdx = i; break; }
                      if (eventConvs > max) currentIdx = i + 1;
                    }
                    currentIdx = Math.min(currentIdx, rewardInfo.tiers!.length - 1);
                    const currentTier = rewardInfo.tiers![currentIdx];
                    const nextTier = currentIdx < rewardInfo.tiers!.length - 1 ? rewardInfo.tiers![currentIdx + 1] : null;
                    return (
                      <div className="space-y-3">
                        <p style={{ color: T3, fontSize: 11.5, margin: 0 }}>{t('owner.promoB.progressForEvent')}</p>
                        <div style={{ padding: 12, borderRadius: 11, background: 'rgba(232,25,44,0.08)', border: '1px solid rgba(232,25,44,0.2)' }}>
                          <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
                            <span style={{ color: T3, fontSize: 11 }}>{t('owner.promoB.currentTier')}</span>
                            <PromoPill tone="muted">{t('owner.promoB.salesCount').replace('{n}', String(eventConvs))}</PromoPill>
                          </div>
                          <p style={{ color: T1, fontSize: 13, fontWeight: 540, margin: 0 }}>
                            {currentTier.reward_type === 'money' ? t('owner.promoB.perSaleAmount').replace('{x}', String(currentTier.ticketValue || 0))
                              : currentTier.reward_type === 'none' ? t('owner.promoB.rewardNoneLong')
                              : getRewardLabel(t, currentTier.reward_type, currentTier.reward_config)}
                          </p>
                        </div>
                        {nextTier && (
                          <div>
                            <div className="flex justify-between" style={{ fontSize: 11, marginBottom: 6 }}>
                              <span style={{ color: T3 }}>{t('owner.promoB.nextTierAt').replace('{n}', String(nextTier.min))}</span>
                              <span style={{ color: T2, fontWeight: 600 }}>{Math.min(100, nextTier.min > 0 ? (eventConvs / nextTier.min) * 100 : 0).toFixed(0)}%</span>
                            </div>
                            <PromoProgress value={Math.min(100, nextTier.min > 0 ? (eventConvs / nextTier.min) * 100 : 0)} height={6} />
                            <p style={{ color: T3, fontSize: 11, margin: 0, marginTop: 6 }}>
                              → {nextTier.reward_type === 'money' ? t('owner.promoB.perSaleAmount').replace('{x}', String(nextTier.ticketValue || 0)) : getRewardLabel(t, nextTier.reward_type, nextTier.reward_config)}
                            </p>
                          </div>
                        )}
                        <div style={{ borderTop: `1px solid ${F_BORDER}`, paddingTop: 12 }}>
                          <p className="flex items-center gap-1" style={{ color: T3, fontSize: 11, fontWeight: 600, marginBottom: 8 }}>
                            <Layers className="h-3 w-3" /> {t('owner.promoB.allTiers')}
                          </p>
                          {rewardInfo.tiers!.map((tier, i) => {
                            const isActive = i === currentIdx;
                            const isCompleted = eventConvs >= (tier.max ?? Infinity);
                            return (
                              <div key={i} className="flex items-center gap-2" style={{ fontSize: 11.5, padding: 8, borderRadius: 8, background: isActive ? 'rgba(232,25,44,0.08)' : 'transparent', color: isActive ? T1 : T3 }}>
                                <div style={{ width: 7, height: 7, borderRadius: 999, flex: 'none', background: isActive ? RED : isCompleted ? 'rgba(232,25,44,0.5)' : 'rgba(255,255,255,0.2)' }} />
                                <span className="flex-1">{tier.min}{tier.max ? `–${tier.max}` : '+'} {t('owner.promoB.salesWord')}</span>
                                <span style={{ fontWeight: 600, color: isActive ? RED : undefined }}>
                                  {tier.reward_type === 'money' ? `${tier.ticketValue || 0}€` : tier.reward_type === 'none' ? t('owner.promoB.rewardNone') : getRewardLabel(t, tier.reward_type, tier.reward_config)}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  }

                  const earnedCounts = rewardInfo.rewardEarnedCounts || {};
                  return (
                    <div className="space-y-2">
                      <p style={{ color: T3, fontSize: 11.5, margin: 0 }}>{t('owner.promoB.tiersResetPerEvent')}</p>
                      {nonMoneyTiers.map((tier, i) => {
                        const label = getRewardLabel(t, tier.reward_type, tier.reward_config);
                        const count = earnedCounts[`${tier.reward_type}_${tier.min}`] || 0;
                        return (
                          <div key={i} className="flex items-center justify-between" style={{ padding: 12, borderRadius: 10, background: TILE_BG }}>
                            <div className="flex items-center gap-2">
                              <div style={{ width: 7, height: 7, borderRadius: 999, flex: 'none', background: count > 0 ? RED : 'rgba(255,255,255,0.2)' }} />
                              <span style={{ color: T1, fontSize: 13 }}>{label}</span>
                              <span style={{ color: T3, fontSize: 10 }}>{t('owner.promoB.minSalesPerEvent').replace('{n}', String(tier.min))}</span>
                            </div>
                            <span style={{ color: count > 0 ? RED : T3, fontSize: 17, fontWeight: 720 }}>{count}×</span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </PromoCard>
            )}

            <div className="grid grid-cols-2 gap-2.5">
              <StatTile value={`${conversionRate.toFixed(1)}%`} label={tt('Taux de conversion', 'Conversion rate')} />
              <StatTile value={`${stats.totalConversions > 0 ? (stats.totalRevenue / stats.totalConversions).toFixed(0) : 0}€`} label={tt('Panier moyen', 'Avg basket')} />
            </div>

            {/* History */}
            <SectionLabel>{tt('Historique', 'History')}</SectionLabel>
            {conversions.length === 0 ? (
              <PromoEmpty title={t('promoterDetail.noConversions')} />
            ) : (
              <div className="space-y-2">
                {conversions.map(conv => (
                  <PromoCard key={conv.id} style={{ padding: 13 }}>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <PromoPill tone="muted">{conv.conversionType === 'ticket' ? 'Ticket' : conv.conversionType === 'table' ? 'Table' : (conv.conversionType as string) === 'guestlist' ? 'Guestlist' : t('promoterFinance.order')}</PromoPill>
                          <PromoPill tone={conv.status === 'paid' ? 'success' : 'warn'}>{conv.status === 'paid' ? t('promoterPayouts.paid') : t('promoterPayouts.pending')}</PromoPill>
                        </div>
                        <p style={{ color: T3, fontSize: 11.5, margin: 0, marginTop: 6 }}>{new Date(conv.createdAt).toLocaleDateString('fr-FR')}</p>
                      </div>
                      <div className="text-right">
                        <p style={{ color: T1, fontSize: 14, fontWeight: 700, margin: 0 }}>{Number(conv.amount).toFixed(2)}€</p>
                        <p style={{ color: RED, fontSize: 12.5, margin: 0 }}>+{Number(conv.commission).toFixed(2)}€</p>
                      </div>
                    </div>
                  </PromoCard>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Settings */}
          <TabsContent value="settings" className="space-y-3 mt-4">
            <PromoCard>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label>{t('promoterDetail.activeToggle')}</Label>
                  <Switch checked={editForm.isActive} onCheckedChange={v => setEditForm({ ...editForm, isActive: v })} />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>{t('promoterScan.title')}</Label>
                    <p className={labelClass}>{t('promoterScan.onlyYourTickets')}</p>
                  </div>
                  <Switch checked={editForm.canScanEntries} onCheckedChange={v => setEditForm({ ...editForm, canScanEntries: v })} />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Label>{t('promoterDetail.autoAssign')}</Label>
                    <p className={labelClass}>{t('promoterDetail.autoAssignHint')}</p>
                  </div>
                  <Switch checked={editForm.autoAssignEvents} onCheckedChange={v => setEditForm({ ...editForm, autoAssignEvents: v })} />
                </div>
                <div>
                  <Label>{t('promoterDetail.promoCode')}</Label>
                  <Input value={editForm.promoCode} onChange={e => setEditForm({ ...editForm, promoCode: e.target.value.toUpperCase() })} />
                </div>
                <div>
                  <Label>Instagram</Label>
                  <Input value={editForm.instagramUrl} onChange={e => setEditForm({ ...editForm, instagramUrl: e.target.value })} placeholder="https://instagram.com/..." />
                </div>
                <div>
                  <Label>WhatsApp</Label>
                  <Input value={editForm.whatsappNumber} onChange={e => setEditForm({ ...editForm, whatsappNumber: e.target.value })} placeholder="+33612345678" />
                </div>

                {templates.length > 0 && (
                  <div className="space-y-2" style={{ borderTop: `1px solid ${F_BORDER}`, paddingTop: 16 }}>
                    <Label>{t('promoterDetail.commissionTemplate')}</Label>
                    <p className={labelClass} style={{ marginBottom: 4 }}>{tt('Un seul modèle couvre ventes, guest list et avantages clients.', 'A single template covers sales, guest list and customer perks.')}</p>
                    <Select value={editForm.defaultCommissionTemplateId || 'none'} onValueChange={v => {
                      const tplId = v === 'none' ? null : v;
                      const sel = templates.find(tp => tp.id === tplId);
                      setEditForm(f => ({
                        ...f,
                        defaultCommissionTemplateId: tplId,
                        // Un modèle « Relier à tous les événements » pré-active l'auto-assignation
                        // (reste débrayable). Ne jamais la désactiver en changeant de modèle.
                        autoAssignEvents: sel?.rules.auto_assign_events ? true : f.autoAssignEvents,
                      }));
                    }}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t('promoterDetail.manualConfig')}</SelectItem>
                        {templates.map(tpl => <SelectItem key={tpl.id} value={tpl.id}>{tpl.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {(() => {
                      const sel = templates.find(tp => tp.id === editForm.defaultCommissionTemplateId);
                      if (!sel) return null;
                      const r = sel.rules;
                      const chips = [
                        (r.reward_type || r.ticket || (r.tiers && r.tiers.length)) ? tt('Ventes', 'Sales') : null,
                        r.customer_discount ? tt('Avantages clients', 'Customer perks') : null,
                      ].filter(Boolean);
                      return chips.length > 0 ? (
                        <div className="flex items-center gap-1.5 flex-wrap" style={{ marginTop: 6 }}>
                          {chips.map((c, i) => <PromoPill key={i} tone="red">{c as string}</PromoPill>)}
                        </div>
                      ) : null;
                    })()}
                  </div>
                )}

                {!editForm.defaultCommissionTemplateId && (
                  <>
                    <div style={{ borderTop: `1px solid ${F_BORDER}`, paddingTop: 16 }}>
                      <h4 style={{ color: T1, fontSize: 13.5, fontWeight: 600, marginBottom: 12 }}>{t('promoterDetail.ticketComm')}</h4>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label>Type</Label>
                          <Select value={editForm.ticketCommissionType} onValueChange={v => setEditForm({ ...editForm, ticketCommissionType: v as 'fixed' | 'percentage' })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent><SelectItem value="percentage">%</SelectItem><SelectItem value="fixed">€</SelectItem></SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>{t('promoterDetail.value')}</Label>
                          <Input type="number" value={editForm.ticketCommissionValue} onChange={e => setEditForm({ ...editForm, ticketCommissionValue: parseFloat(e.target.value) || 0 })} />
                        </div>
                      </div>
                    </div>
                    <div style={{ borderTop: `1px solid ${F_BORDER}`, paddingTop: 16 }}>
                      <h4 style={{ color: T1, fontSize: 13.5, fontWeight: 600, marginBottom: 12 }}>{t('promoterDetail.tableComm')}</h4>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label>Type</Label>
                          <Select value={editForm.tableCommissionType} onValueChange={v => setEditForm({ ...editForm, tableCommissionType: v as 'fixed' | 'percentage' })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent><SelectItem value="percentage">%</SelectItem><SelectItem value="fixed">€</SelectItem></SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>{t('promoterDetail.value')}</Label>
                          <Input type="number" value={editForm.tableCommissionValue} onChange={e => setEditForm({ ...editForm, tableCommissionValue: parseFloat(e.target.value) || 0 })} />
                        </div>
                      </div>
                    </div>
                  </>
                )}

                <PromoButton full onClick={handleSave} disabled={saving}>{saving ? '...' : t('promoterDetail.save')}</PromoButton>

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <PromoButton variant="danger" full><Trash2 className="h-4 w-4" />{t('promoterDetail.delete')}</PromoButton>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t('promoterDetail.deleteConfirm')}</AlertDialogTitle>
                      <AlertDialogDescription>{t('promoterDetail.deleteDesc')}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                      <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">{t('common.delete')}</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </PromoCard>

            {/* Bank info */}
            <PromoCard>
              <h3 style={{ color: T1, fontSize: 14, fontWeight: 620, margin: 0, marginBottom: 12 }}>{t('promoterDetail.bankInfo')}</h3>
              <div className="space-y-3">
                <div>
                  <p style={{ color: T3, fontSize: 11, margin: 0 }}>IBAN</p>
                  <p style={{ color: T1, fontSize: 13, fontFamily: 'monospace', margin: 0, marginTop: 2 }}>{promoter.iban || t('promoterDetail.notProvided')}</p>
                </div>
                <div>
                  <p style={{ color: T3, fontSize: 11, margin: 0 }}>BIC</p>
                  <p style={{ color: T1, fontSize: 13, fontFamily: 'monospace', margin: 0, marginTop: 2 }}>{promoter.bic || t('promoterDetail.notProvided')}</p>
                </div>
              </div>
            </PromoCard>
          </TabsContent>
        </Tabs>
      </PromoPage>
    </>
  );
}
