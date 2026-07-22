import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { useVenueContext } from '@/hooks/useVenueContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDashboardMode } from '@/contexts/DashboardModeContext';
import { usePromoterScope } from '@/hooks/usePromoterScope';
import { scopeId, scopeReady, scopeEventsOr } from '@/lib/promoterScopeHelpers';
import { usePromoterOwnerData } from '@/hooks/usePromoterOwnerData';
import { useCollabReadOnly } from '@/hooks/useCollabReadOnly';
import { CollabReadOnlyBanner } from '@/components/CollabReadOnlyBanner';
import { OwnerPageSkeleton } from '@/components/DashboardSkeleton';
import { DateRangeFilter } from '@/components/promoter/DateRangeFilter';
import { toast } from 'sonner';
import {
  Plus, Search, Users, Ticket, FileText, CreditCard, Percent,
  X, ArrowRight, Megaphone, Wallet, ChevronRight, Trophy, UserPlus, Check,
} from 'lucide-react';
import {
  PromoHeader, PromoPage, PromoCard, StatTile, SectionLabel, PromoPill, PromoButton,
  PromoProgress, PromoAvatar, DarkInput, PromoEmpty,
  RED, POS, T1, T2, T3, BORDER, F_BORDER, C_FAINT, INNER_BG, TILE_BG, CARD_BG, CARD_SHADOW,
} from '@/components/promoter/promoter-ui';

interface UpcomingEvent {
  id: string; title: string; start_at: string;
  promoterCount: number; entriesPlaced: number; quota: number | null;
}

export default function OwnerPromoters() {
  const navigate = useNavigate();
  const scope = usePromoterScope();
  const { venue } = useVenueContext();
  const { t } = useLanguage();
  const { basePath } = useDashboardMode();
  const { promoters, kpis, loading, dateRange, setDateRange } = usePromoterOwnerData(scope);
  const { isReadOnly: collabReadOnly } = useCollabReadOnly();

  const sid = scopeId(scope);

  const [searchTerm, setSearchTerm] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [newPromoterEmail, setNewPromoterEmail] = useState('');
  const [creating, setCreating] = useState(false);
  const [upcomingEvents, setUpcomingEvents] = useState<UpcomingEvent[]>([]);
  const [templateCount, setTemplateCount] = useState<number | null>(null);
  const [activationCount, setActivationCount] = useState<number | null>(null);
  const [guideDismissed, setGuideDismissed] = useState(() => localStorage.getItem('promoterGuideDismissed') === '1');

  useEffect(() => {
    if (scopeReady(scope) && sid) { fetchUpcomingEvents(); fetchSetupState(); }
  }, [scope.kind, sid]);

  async function fetchSetupState() {
    if (!sid) return;
    const col = scope.kind === 'organizer' ? 'organizer_user_id' : 'venue_id';
    const { count: tpl } = await supabase.from('commission_templates')
      .select('id', { count: 'exact', head: true }).eq(col, sid);
    setTemplateCount(tpl ?? 0);
  }

  async function fetchUpcomingEvents() {
    if (!sid) return;
    const now = new Date().toISOString();
    const eventsOr = scopeEventsOr(scope);
    let q = supabase.from('events').select('id, title, start_at');
    q = eventsOr ? q.or(eventsOr) : q.eq('venue_id', sid);
    const { data: evts } = await q.eq('is_active', true).gte('end_at', now)
      .order('start_at', { ascending: true }).limit(6);
    if (!evts || evts.length === 0) { setUpcomingEvents([]); return; }

    const eventIds = evts.map(e => e.id);
    // Active promoter assignments per event
    const { data: assignments } = await supabase.from('promoter_event_assignments')
      .select('event_id').in('event_id', eventIds).eq('status', 'active');
    const countMap: Record<string, number> = {};
    (assignments || []).forEach(a => { countMap[a.event_id] = (countMap[a.event_id] || 0) + 1; });
    setActivationCount((assignments || []).length);

    // Guest list fill (entries placed / quota) per event
    const { data: lists } = await supabase.from('guest_lists')
      .select('id, event_id, quota').in('event_id', eventIds);
    const listByEvent = new Map((lists || []).map(l => [l.event_id, l]));
    const listIds = (lists || []).map(l => l.id);
    const placedMap: Record<string, number> = {};
    if (listIds.length > 0) {
      const { data: entries } = await supabase.from('guest_list_entries')
        .select('guest_list_id').in('guest_list_id', listIds);
      const listToEvent = new Map((lists || []).map(l => [l.id, l.event_id]));
      (entries || []).forEach(e => {
        const evId = listToEvent.get(e.guest_list_id);
        if (evId) placedMap[evId] = (placedMap[evId] || 0) + 1;
      });
    }

    setUpcomingEvents(evts.map(e => ({
      id: e.id, title: e.title, start_at: e.start_at,
      promoterCount: countMap[e.id] || 0,
      entriesPlaced: placedMap[e.id] || 0,
      quota: listByEvent.get(e.id)?.quota ?? null,
    })));
  }

  async function handleInvitePromoter() {
    if (!sid || !newPromoterEmail) return;
    setCreating(true);
    try {
      const inviteBody = scope.kind === 'organizer'
        ? { email: newPromoterEmail, organizer_user_id: sid }
        : { email: newPromoterEmail, venue_id: sid, venue_name: venue?.name || '' };
      const { data, error } = await supabase.functions.invoke('invite-promoter', { body: inviteBody });
      if (error) throw error;
      if (data?.error) {
        if (data.code === 'already_linked') toast.info(t('promoterProgram.alreadyLinked'));
        else if (data.code === 'invitation_pending') toast.info(t('promoterProgram.invitationPending'));
        else throw new Error(data.error);
        setInviteOpen(false);
        return;
      }
      toast.success(t('owner.invitationSent'));
      setInviteOpen(false);
      setNewPromoterEmail('');
    } catch (err) {
      toast.error((err as Error).message || t('owner.errorInviting'));
    } finally {
      setCreating(false);
    }
  }

  const filtered = promoters.filter(p =>
    p.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.firstName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.lastName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.promoCode.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const leaderboard = [...promoters].filter(p => p.revenue > 0 || p.conversions > 0)
    .sort((a, b) => b.revenue - a.revenue).slice(0, 5);

  const owedCount = promoters.filter(p => p.pendingAmount > 0).length;
  const nextEvent = upcomingEvents[0];
  const displayName = (n: string | null | undefined, code: string, email: string) =>
    n ? n : (email || `@${code}`);

  if (scope.loading || loading) return <OwnerPageSkeleton />;

  const inviteBtn = (
    <PromoButton
      size="sm"
      onClick={() => { if (!collabReadOnly) setInviteOpen(true); }}
      disabled={collabReadOnly}
    >
      <Plus className="h-4 w-4" />
      <span>{t('owner.promo.invite')}</span>
    </PromoButton>
  );

  // ── Guided setup workflow ────────────────────────────────────────────────
  const steps = [
    { n: 1, label: t('owner.promo.stepRulesLabel'), hint: t('owner.promo.stepRulesHint'), done: (templateCount ?? 0) > 0, go: () => navigate(`${basePath}/promoters/templates`) },
    { n: 2, label: t('owner.promo.stepInviteLabel'), hint: t('owner.promo.stepInviteHint'), done: promoters.length > 0, go: () => { if (!collabReadOnly) setInviteOpen(true); } },
    { n: 3, label: t('owner.promo.stepActivateLabel'), hint: t('owner.promo.stepActivateHint'), done: (activationCount ?? 0) > 0, go: () => navigate(nextEvent ? `${basePath}/promoters/event/${nextEvent.id}` : `${basePath}/promoters`) },
    { n: 4, label: t('owner.promo.stepTrackLabel'), hint: t('owner.promo.stepTrackHint'), done: kpis.ticketsSold > 0 || kpis.pendingCommission > 0, go: () => navigate(`${basePath}/promoters/finance`) },
  ];
  const coreDone = steps.slice(0, 3).every(s => s.done);
  const showGuide = templateCount !== null && !guideDismissed && !coreDone;
  const firstTodoIndex = steps.findIndex(s => !s.done);
  const dismissGuide = () => { localStorage.setItem('promoterGuideDismissed', '1'); setGuideDismissed(true); };

  return (
    <>
      <PromoHeader
        title={t('promoterProgram.title')}
        subtitle={venue?.name || undefined}
        backTo={basePath}
        right={inviteBtn}
      />

      <PromoPage>
        <CollabReadOnlyBanner action={t('collab.action.managePromoters')} />

        {/* ── Guided setup workflow ─────────────────────────────────────── */}
        {showGuide && (
          <PromoCard style={{ padding: 0, overflow: 'hidden' }}>
            <div className="flex items-center justify-between" style={{ padding: '12px 16px', borderBottom: `1px solid ${F_BORDER}` }}>
              <div>
                <p style={{ color: T1, fontSize: 13, fontWeight: 660, margin: 0 }}>{t('owner.promo.howItWorks')}</p>
                <p style={{ color: T3, fontSize: 11, margin: 0, marginTop: 1 }}>{t('owner.promo.howItWorksSub')}</p>
              </div>
              <button onClick={dismissGuide} aria-label={t('owner.promo.dismiss')} style={{ background: 'none', border: 'none', color: T3, cursor: 'pointer' }}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div>
              {steps.map((s, i) => {
                const isCurrent = i === firstTodoIndex;
                return (
                  <button key={s.n} onClick={s.go}
                    className="w-full flex items-center gap-3 transition-colors"
                    style={{ padding: '12px 16px', borderTop: i > 0 ? `1px solid ${F_BORDER}` : 'none', background: isCurrent ? 'rgba(232,25,44,0.05)' : 'transparent', cursor: 'pointer' }}>
                    <div className="flex items-center justify-center flex-none"
                      style={{ width: 26, height: 26, borderRadius: 999, background: s.done ? RED : 'transparent', border: `1.5px solid ${s.done ? RED : isCurrent ? RED : 'rgba(255,255,255,0.18)'}`, color: s.done ? '#fff' : isCurrent ? RED : T3, fontSize: 12, fontWeight: 700 }}>
                      {s.done ? <Check className="h-3.5 w-3.5" /> : s.n}
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                      <p style={{ color: s.done ? T2 : T1, fontSize: 13, fontWeight: 560, margin: 0, textDecoration: s.done ? 'line-through' : 'none' }}>{s.label}</p>
                      <p style={{ color: T3, fontSize: 11, margin: 0 }}>{s.hint}</p>
                    </div>
                    {isCurrent && <PromoPill tone="red">{t('owner.promo.toDo')}</PromoPill>}
                    <ChevronRight className="h-4 w-4 flex-none" style={{ color: T3 }} />
                  </button>
                );
              })}
            </div>
          </PromoCard>
        )}

        {/* ── Money strip: what you owe + pay CTA ───────────────────────── */}
        <PromoCard
          onClick={owedCount > 0 ? () => navigate(`${basePath}/promoters/finance`) : undefined}
          style={{ padding: 0, overflow: 'hidden' }}
        >
          <div className="flex items-center gap-4" style={{ padding: '16px 18px' }}>
            <div
              className="flex items-center justify-center flex-none"
              style={{ width: 44, height: 44, borderRadius: 12, background: owedCount > 0 ? 'rgba(232,25,44,0.12)' : 'rgba(52,211,153,0.10)', border: `1px solid ${owedCount > 0 ? 'rgba(232,25,44,0.25)' : 'rgba(52,211,153,0.22)'}` }}
            >
              <Wallet className="h-5 w-5" style={{ color: owedCount > 0 ? RED : POS }} />
            </div>
            <div className="min-w-0 flex-1">
              <p style={{ color: owedCount > 0 ? RED : POS, fontSize: 24, fontWeight: 760, letterSpacing: '-0.02em', margin: 0, lineHeight: 1 }}>
                {kpis.pendingCommission.toFixed(0)}€
              </p>
              <p style={{ color: T2, fontSize: 12.5, margin: 0, marginTop: 3 }}>
                {owedCount > 0
                  ? t(owedCount > 1 ? 'owner.promo.owedToPlural' : 'owner.promo.owedToSingular').replace('{count}', String(owedCount))
                  : t('owner.promo.allSettled')}
              </p>
            </div>
            {owedCount > 0 && (
              <div className="flex items-center gap-1 flex-none" style={{ color: T1, fontSize: 13, fontWeight: 620 }}>
                {t('owner.promo.pay')} <ArrowRight className="h-4 w-4" />
              </div>
            )}
          </div>
        </PromoCard>

        {/* ── Period stats ──────────────────────────────────────────────── */}
        <DateRangeFilter value={dateRange} onChange={setDateRange} />
        <div className="grid grid-cols-3 gap-3">
          <StatTile icon={Ticket} value={kpis.ticketsSold} label={t('promoterProgram.ticketsSold')} />
          <StatTile icon={CreditCard} value={`${kpis.revenue.toFixed(0)}€`} label={t('promoterProgram.revenue')} />
          <StatTile icon={Percent} value={`${kpis.conversionRate.toFixed(1)}%`} label={t('promoterProgram.convRate')} />
        </div>

        {/* ── Configuration : gérer les promoteurs (mis en avant, plus caché) ─ */}
        <SectionLabel>{t('owner.promo.setup')}</SectionLabel>
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: t('promoterProgram.templates'), Icon: FileText, path: `${basePath}/promoters/templates`, hint: t('owner.promo.setupTemplatesHint') },
            { label: t('promoterTeams.title'), Icon: Users, path: `${basePath}/promoters/teams`, hint: t('owner.promo.setupTeamsHint') },
            { label: t('owner.announcements'), Icon: Megaphone, path: `${basePath}/promoters/announcements`, hint: t('owner.promo.setupAnnouncementsHint') },
          ].map(({ label, Icon, path, hint }) => (
            <button key={path} onClick={() => navigate(path)}
              className="flex flex-col items-center gap-1.5 transition-colors"
              style={{ background: INNER_BG, border: `1px solid ${F_BORDER}`, borderRadius: 13, padding: '16px 10px', cursor: 'pointer' }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(232,25,44,0.35)')}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = F_BORDER)}
            >
              <Icon className="h-5 w-5" style={{ color: RED }} />
              <span style={{ color: T1, fontSize: 12, fontWeight: 600, textAlign: 'center', lineHeight: 1.2 }}>{label}</span>
              <span style={{ color: T3, fontSize: 10, textAlign: 'center', lineHeight: 1.15 }}>{hint}</span>
            </button>
          ))}
        </div>

        {/* ── Next nights: activate promoters ───────────────────────────── */}
        {upcomingEvents.length > 0 && (
          <>
            <SectionLabel>{t('owner.promo.upcomingNights')}</SectionLabel>
            <div className="space-y-2">
              {upcomingEvents.slice(0, 3).map((evt, idx) => {
                const fillPct = evt.quota && evt.quota > 0 ? (evt.entriesPlaced / evt.quota) * 100 : 0;
                const isNext = idx === 0;
                return (
                  <PromoCard key={evt.id} onClick={() => navigate(`${basePath}/promoters/event/${evt.id}`)} style={isNext ? { borderColor: 'rgba(232,25,44,0.22)' } : undefined}>
                    <div className="flex items-center gap-3 mb-2">
                      <div className="flex-none flex flex-col items-center justify-center" style={{ width: 42, height: 42, borderRadius: 11, background: TILE_BG, border: `1px solid ${F_BORDER}` }}>
                        <span style={{ color: RED, fontSize: 16, fontWeight: 760, lineHeight: 1 }}>{new Date(evt.start_at).getDate()}</span>
                        <span style={{ color: T3, fontSize: 9, textTransform: 'uppercase' }}>{new Date(evt.start_at).toLocaleDateString('fr-FR', { month: 'short' })}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate" style={{ color: T1, fontSize: 14, fontWeight: 620, margin: 0 }}>{evt.title}</p>
                          {isNext && <PromoPill tone="red">{t('owner.promo.next')}</PromoPill>}
                        </div>
                        <p style={{ color: T3, fontSize: 11.5, margin: 0, marginTop: 1 }}>
                          {t(evt.promoterCount !== 1 ? 'owner.promo.promotersActivatedPlural' : 'owner.promo.promotersActivatedSingular').replace('{count}', String(evt.promoterCount))}
                        </p>
                      </div>
                      <ChevronRight className="h-4 w-4 flex-none" style={{ color: T3 }} />
                    </div>
                    {evt.quota && evt.quota > 0 && (
                      <div>
                        <div className="flex items-center justify-between" style={{ marginBottom: 5 }}>
                          <span style={{ color: T3, fontSize: 11 }}>{t('owner.promo.entriesPlaced')}</span>
                          <span style={{ color: T2, fontSize: 11, fontWeight: 600 }}>{evt.entriesPlaced}/{evt.quota}</span>
                        </div>
                        <PromoProgress value={fillPct} tone={fillPct >= 100 ? 'pos' : 'red'} />
                      </div>
                    )}
                  </PromoCard>
                );
              })}
            </div>
          </>
        )}

        {/* ── Leaderboard ───────────────────────────────────────────────── */}
        {leaderboard.length > 0 && (
          <PromoCard style={{ padding: 16 }}>
            <div className="flex items-center gap-2" style={{ marginBottom: 12 }}>
              <Trophy className="h-4 w-4" style={{ color: RED }} />
              <h3 style={{ color: T1, fontSize: 14, fontWeight: 640, margin: 0, flex: 1 }}>{t('promoterProgram.topPromoters')}</h3>
            </div>
            <div className="space-y-0.5">
              {leaderboard.map((p, i) => (
                <button key={p.id} onClick={() => navigate(`${basePath}/promoters/${p.id}`)}
                  className="w-full flex items-center gap-3 transition-colors"
                  style={{ padding: '9px 10px', borderRadius: 10, background: 'transparent', cursor: 'pointer' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = C_FAINT)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ color: i === 0 ? RED : T3, fontSize: 14, fontWeight: 760, width: 18, textAlign: 'center', flexShrink: 0 }}>{i + 1}</span>
                  <PromoAvatar src={p.profileImageUrl} fallback={p.firstName?.[0] || p.promoCode[0]} size={34} />
                  <p className="flex-1 truncate text-left" style={{ color: T1, fontSize: 13, fontWeight: 540, margin: 0 }}>
                    {displayName(p.firstName ? `${p.firstName} ${p.lastName || ''}`.trim() : null, p.promoCode, p.email)}
                  </p>
                  <div className="text-right shrink-0">
                    <p style={{ color: T1, fontSize: 13, fontWeight: 720, margin: 0 }}>{p.revenue.toFixed(0)}€</p>
                    <p style={{ color: T3, fontSize: 10.5, margin: 0 }}>{p.conversions} {t('promoterProgram.sales')}</p>
                  </div>
                </button>
              ))}
            </div>
          </PromoCard>
        )}

        {/* ── Directory ─────────────────────────────────────────────────── */}
        <SectionLabel action={<span style={{ color: T3, fontSize: 11.5 }}>{promoters.length}</span>}>{t('owner.promo.directory')}</SectionLabel>
        <DarkInput value={searchTerm} onChange={setSearchTerm} placeholder={t('owner.searchPromoter')} icon={Search} />

        <div className="space-y-2.5">
          {filtered.length === 0 ? (
            promoters.length === 0 ? (
              <PromoEmpty
                icon={UserPlus}
                title={t('promoterProgram.noPromoters')}
                description={t('owner.promo.emptyDescription')}
                action={<PromoButton onClick={() => { if (!collabReadOnly) setInviteOpen(true); }} disabled={collabReadOnly}><Plus className="h-4 w-4" />{t('owner.promo.inviteAPromoter')}</PromoButton>}
              />
            ) : (
              <PromoEmpty icon={Search} title={t('promoterProgram.noResults')} />
            )
          ) : (
            filtered.map(p => (
              <PromoCard key={p.id} onClick={() => navigate(`${basePath}/promoters/${p.id}`)}>
                <div className="flex items-center gap-3 mb-3">
                  <PromoAvatar src={p.profileImageUrl} fallback={p.firstName?.[0] || p.promoCode[0]} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="truncate" style={{ color: T1, fontSize: 14, fontWeight: 620, margin: 0 }}>
                        {displayName(p.firstName ? `${p.firstName} ${p.lastName || ''}`.trim() : null, p.promoCode, p.email)}
                      </h3>
                      <PromoPill tone={p.isActive ? 'success' : 'muted'}>
                        {p.isActive ? t('promoterProgram.active') : t('promoterProgram.inactive')}
                      </PromoPill>
                    </div>
                    <p style={{ color: T3, fontSize: 11.5, fontFamily: 'monospace', margin: 0 }}>@{p.promoCode}</p>
                  </div>
                  {p.pendingAmount > 0 && <PromoPill tone="red">{p.pendingAmount.toFixed(0)}€ {t('owner.promo.owed')}</PromoPill>}
                </div>
                <div className="grid grid-cols-4 gap-2 text-center">
                  {[
                    { value: p.clicks, label: t('promoterProgram.clicks') },
                    { value: p.conversions, label: t('promoterProgram.sales') },
                    { value: `${p.revenue.toFixed(0)}€`, label: t('promoterProgram.revenue') },
                    { value: `${p.conversionRate.toFixed(0)}%`, label: t('promoterProgram.convRate') },
                  ].map((s, i) => (
                    <div key={i} style={{ background: TILE_BG, borderRadius: 9, padding: '8px 4px' }}>
                      <p style={{ color: T1, fontSize: 14, fontWeight: 700, margin: 0 }}>{s.value}</p>
                      <p style={{ color: T3, fontSize: 10, margin: 0 }}>{s.label}</p>
                    </div>
                  ))}
                </div>
              </PromoCard>
            ))
          )}
        </div>

      </PromoPage>

      {/* ── Invite modal ──────────────────────────────────────────────── */}
      <AnimatePresence>
        {inviteOpen && (
          <>
            <motion.div className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(4px)' }}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setInviteOpen(false)}
            />
            <motion.div
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md px-4"
              initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            >
              <div style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, borderRadius: 20, padding: 24 }}>
                <div className="flex items-center justify-between mb-2">
                  <h2 style={{ color: T1, fontSize: 17, fontWeight: 700, margin: 0 }}>{t('owner.addPromoter')}</h2>
                  <button onClick={() => setInviteOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T3 }}>
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <p style={{ color: T3, fontSize: 13, marginBottom: 16 }}>{t('owner.promoterInviteInfoSimplified')}</p>
                <p style={{ color: T2, fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>{t('owner.promoterEmail')} *</p>
                <input
                  type="email"
                  placeholder="promoteur@email.com"
                  value={newPromoterEmail}
                  onChange={e => setNewPromoterEmail(e.target.value)}
                  className="w-full outline-none mb-4"
                  style={{ background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: '10px 14px', color: T1, fontSize: 14, fontFamily: 'inherit' }}
                  onFocus={(e) => (e.target.style.borderColor = 'rgba(255,255,255,0.2)')}
                  onBlur={(e) => (e.target.style.borderColor = BORDER)}
                />
                <div className="flex gap-2">
                  <PromoButton variant="secondary" full onClick={() => setInviteOpen(false)}>{t('owner.cancel')}</PromoButton>
                  <PromoButton full onClick={handleInvitePromoter} disabled={creating || !newPromoterEmail}>
                    {creating ? '…' : t('owner.sendInvitation')}
                  </PromoButton>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
