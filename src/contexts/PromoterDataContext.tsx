import {
  createContext, useContext, useState, useEffect, useCallback,
  type ReactNode, type Dispatch, type SetStateAction,
} from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import type { PromoterStats } from '@/types/promoter';

/**
 * Couche de données unique de l'espace promoteur (/promoter/*), montée une fois
 * dans PromoterLayout — le pendant de DJDataContext pour l'app DJ. Les pages
 * lisent tout via usePromoterData() : profils (un par club/organisateur),
 * portée sélectionnée, stats, assignations, équipe, annonces.
 */

export interface PromoterProfile {
  id: string;
  user_id: string;
  venue_id: string | null;
  organizer_user_id?: string | null;
  agency_id?: string | null;
  promo_code: string;
  is_active: boolean;
  iban: string | null;
  bic: string | null;
  instagram_url: string | null;
  profile_image_url: string | null;
  ticket_commission_type: string;
  ticket_commission_value: number;
  table_commission_type: string;
  table_commission_value: number;
  can_scan_entries?: boolean;
  default_commission_template_id?: string | null;
  team_id?: string | null;
  venue?: { id: string; name: string; logo_url?: string; custom_domain?: string };
  /** Nom d'organisateur résolu pour les profils sans venue. */
  organizerName?: string;
}

export interface PromoterAnnouncement {
  id: string;
  title: string;
  content: string;
  created_at: string;
}

export interface PromoterUpcomingEvent {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
}

export interface PromoterEventAssignment {
  eventId: string;
  eventTitle: string;
  eventStartAt: string;
  eventEndAt: string;
  canAccessGuestlist: boolean;
  canAccessTables: boolean;
  /** Épinglée sur le linktree : dès qu'une soirée est épinglée, la vitrine ne montre qu'elles. */
  featuredOnLinktree: boolean;
}

export interface PromoterTemplateRules {
  ticket?: { type: string; value: number };
  table?: { type: string; value: number };
  reward_type?: string;
  reward_config?: Record<string, unknown>;
  tiers?: Array<{ min: number; max: number | null; reward_type: string; ticketValue?: number; reward_config?: Record<string, unknown> }>;
  customer_discount?: { type: string; value: number; label?: string };
}

export interface PromoterTeamInfo {
  name: string;
  leaderName: string | null;
  memberCount: number;
  isLeader: boolean;
  teamId: string | null;
}

export interface PromoterTeamMember {
  id: string;
  label: string;
  clicks: number;
  conversions: number;
  revenue: number;
  commission: number;
}

/** Clé stable d'une portée — venue_id pour un club, `org:<id>` pour un organisateur. */
export const scopeKey = (p: Pick<PromoterProfile, 'venue_id' | 'organizer_user_id'>) =>
  p.venue_id ?? (p.organizer_user_id ? `org:${p.organizer_user_id}` : 'unknown');

const STORAGE_KEY = 'promoter_selected_venue';

export const defaultPromoterStats: PromoterStats = {
  totalClicks: 0, clicksToday: 0, clicksThisWeek: 0, clicksThisMonth: 0,
  totalConversions: 0, conversionsThisMonth: 0, conversionRate: 0,
  totalRevenue: 0, revenueThisMonth: 0, totalCommission: 0, pendingCommission: 0,
  approvedCommission: 0, paidCommission: 0,
  ticketsSold: 0, tablesReserved: 0,
};

interface PromoterDataValue {
  loading: boolean;
  profileError: 'no_profile' | 'inactive' | null;
  profiles: PromoterProfile[];
  /** Profil de la portée sélectionnée. */
  promoter: PromoterProfile | null;
  selectedKey: string;
  setSelectedKey: (key: string) => void;
  isOrg: boolean;
  scopeName: string;
  stats: PromoterStats;
  announcements: PromoterAnnouncement[];
  /** Soirées à venir de la portée (hôte OU partenaire de co-event). */
  events: PromoterUpcomingEvent[];
  eventsLoading: boolean;
  templateRules: PromoterTemplateRules | null;
  assignments: PromoterEventAssignment[];
  setAssignments: Dispatch<SetStateAction<PromoterEventAssignment[]>>;
  canScan: boolean;
  hasGuestListAccess: boolean;
  teamInfo: PromoterTeamInfo | null;
  teamMembers: PromoterTeamMember[];
  refetchProfiles: () => Promise<void>;
  refetchStats: () => void;
}

const PromoterDataContext = createContext<PromoterDataValue | null>(null);

export function usePromoterData() {
  const ctx = useContext(PromoterDataContext);
  if (!ctx) throw new Error('usePromoterData must be used within PromoterDataProvider');
  return ctx;
}

export function PromoterDataProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const { t } = useLanguage();

  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState<'no_profile' | 'inactive' | null>(null);
  const [profiles, setProfiles] = useState<PromoterProfile[]>([]);
  const [selectedKey, setSelectedKeyState] = useState<string>('');
  const [statsMap, setStatsMap] = useState<Record<string, PromoterStats>>({});
  const [announcementsMap, setAnnouncementsMap] = useState<Record<string, PromoterAnnouncement[]>>({});

  // Données de la portée sélectionnée
  const [events, setEvents] = useState<PromoterUpcomingEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [templateRules, setTemplateRules] = useState<PromoterTemplateRules | null>(null);
  const [assignments, setAssignments] = useState<PromoterEventAssignment[]>([]);
  const [teamInfo, setTeamInfo] = useState<PromoterTeamInfo | null>(null);
  const [teamMembers, setTeamMembers] = useState<PromoterTeamMember[]>([]);

  const promoter = profiles.find(p => scopeKey(p) === selectedKey) || null;
  const isOrg = !!promoter && !promoter.venue_id && !!promoter.organizer_user_id;
  const scopeName = promoter?.venue?.name || promoter?.organizerName || 'Organisateur';

  const setSelectedKey = useCallback((key: string) => {
    setSelectedKeyState(key);
    localStorage.setItem(STORAGE_KEY, key);
  }, []);

  const fetchStats = useCallback(async (promoterId: string) => {
    try {
      const { count: totalClicks } = await supabase.from('promoter_clicks')
        .select('*', { count: 'exact', head: true }).eq('promoter_id', promoterId);
      const { data: conversions } = await supabase.from('promoter_conversions')
        .select('*').eq('promoter_id', promoterId);
      const totalConversions = conversions?.length || 0;
      const ticketsSold = conversions?.filter(c => c.conversion_type === 'ticket' && (c.amount || 0) > 0).length || 0;
      const tablesReserved = conversions?.filter(c => c.conversion_type === 'table' && (c.amount || 0) > 0).length || 0;
      const totalRevenue = conversions?.reduce((sum, c) => sum + (c.amount || 0), 0) || 0;
      const totalCommission = conversions?.reduce((sum, c) => sum + (c.commission || 0), 0) || 0;
      const pendingCommission = conversions?.filter(c => c.status === 'pending').reduce((sum, c) => sum + (c.commission || 0), 0) || 0;

      const { data: payouts } = await supabase.from('promoter_payouts')
        .select('amount, status').eq('promoter_id', promoterId);
      const approvedCommission = payouts?.filter(p => p.status === 'approved').reduce((s, p) => s + (p.amount || 0), 0) || 0;
      const paidCommission = payouts?.filter(p => p.status === 'paid').reduce((s, p) => s + (p.amount || 0), 0) || 0;

      setStatsMap(prev => ({
        ...prev,
        [promoterId]: {
          totalClicks: totalClicks || 0, clicksToday: 0, clicksThisWeek: 0, clicksThisMonth: 0,
          totalConversions, conversionsThisMonth: 0,
          conversionRate: totalClicks ? (totalConversions / totalClicks) * 100 : 0,
          totalRevenue, revenueThisMonth: 0, totalCommission, pendingCommission,
          approvedCommission, paidCommission,
          ticketsSold, tablesReserved,
        },
      }));
    } catch (error) { console.error('Error fetching promoter stats:', error); }
  }, []);

  // Annonces de TOUTES les portées du promoteur : son club (venue), son
  // organisateur, ET son agence (feed natif agence). Clé = id du promoteur.
  const fetchAnnouncements = useCallback(async (p: PromoterProfile) => {
    try {
      const ors: string[] = [];
      if (p.venue_id) ors.push(`venue_id.eq.${p.venue_id}`);
      if (p.organizer_user_id) ors.push(`organizer_user_id.eq.${p.organizer_user_id}`);
      if (p.agency_id) ors.push(`agency_id.eq.${p.agency_id}`);
      if (ors.length === 0) return;
      const { data } = await supabase.from('promoter_announcements').select('*')
        .or(ors.join(',')).order('created_at', { ascending: false }).limit(5);
      setAnnouncementsMap(prev => ({ ...prev, [p.id]: data || [] }));
    } catch (error) { console.error('Error fetching announcements:', error); }
  }, []);

  const refetchProfiles = useCallback(async () => {
    if (!user) return;
    try {
      // Tous les profils (actifs ET inactifs) pour un message d'erreur précis.
      const { data, error } = await supabase
        .from('promoters')
        .select('*, venue:venues(id, name, logo_url, custom_domain)')
        .eq('user_id', user.id);
      if (error) throw error;

      if (!data || data.length === 0) { setProfileError('no_profile'); return; }
      const activeProfiles = data.filter(p => p.is_active);
      if (activeProfiles.length === 0) { setProfileError('inactive'); return; }

      // Résoudre le nom d'organisateur des profils sans venue pour que la portée
      // se lise comme l'organisateur, pas un « Club » générique.
      const orgIds = [...new Set(activeProfiles
        .filter(p => !p.venue_id && p.organizer_user_id)
        .map(p => p.organizer_user_id as string))];
      const orgNames: Record<string, string> = {};
      if (orgIds.length) {
        const { data: orgs } = await supabase.from('organizer_profiles')
          .select('user_id, display_name').in('user_id', orgIds);
        (orgs || []).forEach(o => { if (o.display_name) orgNames[o.user_id] = o.display_name; });
      }
      const enriched: PromoterProfile[] = activeProfiles.map(p => ({
        ...(p as unknown as PromoterProfile),
        organizerName: !p.venue_id && p.organizer_user_id ? orgNames[p.organizer_user_id] : undefined,
      }));

      setProfileError(null);
      setProfiles(enriched);
      await Promise.all(enriched.map(async (p) => {
        await fetchStats(p.id);
        await fetchAnnouncements(p);
      }));
    } catch (error) {
      console.error('Error fetching promoter data:', error);
      toast.error(t('promoter.loadingError'));
    } finally {
      setLoading(false);
    }
  }, [user, fetchStats, fetchAnnouncements, t]);

  useEffect(() => {
    if (!authLoading && user) refetchProfiles();
  }, [user, authLoading, refetchProfiles]);

  // Sélection initiale : la portée mémorisée si toujours valide, sinon la première.
  useEffect(() => {
    if (profiles.length > 0 && !selectedKey) {
      const saved = localStorage.getItem(STORAGE_KEY);
      const valid = profiles.find(p => scopeKey(p) === saved);
      setSelectedKeyState(valid ? saved! : scopeKey(profiles[0]));
    }
  }, [profiles, selectedKey]);

  // Realtime : toast + refresh des stats sur chaque nouvelle conversion.
  useEffect(() => {
    if (profiles.length === 0) return;
    const promoterIds = profiles.map(p => p.id);
    const channel = supabase
      .channel(`promoter-conversions-${user?.id}-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'promoter_conversions' },
        (payload) => {
          const newConversion = payload.new as { promoter_id: string; conversion_type: string };
          if (promoterIds.includes(newConversion.promoter_id)) {
            fetchStats(newConversion.promoter_id);
            toast.success(
              t('promoter.newConversion') || (newConversion.conversion_type === 'ticket' ? '🎟️ Nouvelle vente !' : '🍾 Nouvelle réservation !'),
              { duration: 4000 },
            );
          }
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profiles, user?.id, fetchStats, t]);

  // Soirées à venir de la portée — hôte (venue_id / organizer) OU partenaire de co-event.
  useEffect(() => {
    if (!promoter) return;
    if (!promoter.venue?.id && !promoter.organizer_user_id) { setEvents([]); setEventsLoading(false); return; }
    setEventsLoading(true);
    (async () => {
      const now = new Date().toISOString();
      const base = supabase.from('events')
        .select('id, title, start_at, end_at')
        .gte('end_at', now)
        .order('start_at', { ascending: true })
        .limit(50);
      const { data } = isOrg
        ? await base.or(`organizer_user_id.eq.${promoter.organizer_user_id},partner_organizer_id.eq.${promoter.organizer_user_id}`)
        : await base.or(`venue_id.eq.${promoter.venue!.id},partner_venue_id.eq.${promoter.venue!.id}`);
      setEvents(data || []);
      setEventsLoading(false);
    })();
  }, [promoter?.id, promoter?.venue?.id, promoter?.organizer_user_id, isOrg]); // eslint-disable-line react-hooks/exhaustive-deps

  // Modèle de commission de la portée.
  useEffect(() => {
    setTemplateRules(null);
    if (!promoter?.default_commission_template_id) return;
    (async () => {
      const { data } = await supabase.from('commission_templates')
        .select('rules')
        .eq('id', promoter.default_commission_template_id!)
        .single();
      if (data?.rules) setTemplateRules(data.rules as unknown as PromoterTemplateRules);
    })();
  }, [promoter?.default_commission_template_id]);

  // Assignations actives (avec permissions guest list / tables / linktree).
  useEffect(() => {
    setAssignments([]);
    if (!promoter?.id) return;
    (async () => {
      // featured_on_linktree n'est pas encore dans les types générés → cast.
      const { data } = await (supabase as any).from('promoter_event_assignments')
        .select('event_id, can_access_guestlist, can_access_tables, featured_on_linktree')
        .eq('promoter_id', promoter.id)
        .eq('status', 'active') as { data: Array<{ event_id: string; can_access_guestlist: boolean | null; can_access_tables: boolean | null; featured_on_linktree: boolean | null }> | null };
      if (!data || data.length === 0) { setAssignments([]); return; }
      const eventIds = data.map(a => a.event_id);
      const { data: evts } = await supabase.from('events')
        .select('id, title, start_at, end_at').in('id', eventIds);
      const evtMap = new Map((evts || []).map(e => [e.id, e]));
      setAssignments(data.map(a => {
        const evt = evtMap.get(a.event_id);
        return {
          eventId: a.event_id,
          eventTitle: evt?.title || '',
          eventStartAt: evt?.start_at || '',
          eventEndAt: evt?.end_at || '',
          canAccessGuestlist: a.can_access_guestlist ?? false,
          canAccessTables: a.can_access_tables ?? true,
          featuredOnLinktree: a.featured_on_linktree ?? false,
        };
      }));
    })();
  }, [promoter?.id]);

  // Équipe : infos pour tous les membres, leaderboard pour le chef.
  useEffect(() => {
    setTeamInfo(null);
    setTeamMembers([]);
    if (!promoter?.id) return;
    (async () => {
      const { data: promo } = await supabase.from('promoters')
        .select('team_id').eq('id', promoter.id).single();
      if (!promo?.team_id) return;

      const { data: team } = await supabase.from('promoter_teams')
        .select('id, name, leader_promoter_id').eq('id', promo.team_id).single();
      if (!team) return;

      const isLeader = team.leader_promoter_id === promoter.id;

      const { count } = await supabase.from('promoters')
        .select('*', { count: 'exact', head: true })
        .eq('team_id', promo.team_id);

      let leaderName: string | null = null;
      if (team.leader_promoter_id) {
        const { data: leader } = await supabase.from('promoters')
          .select('promo_code, profiles!promoters_user_id_fkey(first_name, last_name)')
          .eq('id', team.leader_promoter_id).single();
        if (leader) {
          const prof = (leader as any).profiles;
          leaderName = prof?.first_name ? `${prof.first_name} ${prof.last_name || ''}`.trim() : leader.promo_code;
        }
      }

      setTeamInfo({ name: team.name, leaderName, memberCount: count || 0, isLeader, teamId: promo.team_id });

      if (isLeader) {
        const { data: members } = await supabase.from('promoters')
          .select('id, promo_code, first_name, last_name, user_id')
          .eq('team_id', promo.team_id).eq('is_active', true);
        if (!members) return;
        const memberIds = members.map(m => m.id);
        const { data: convs } = await supabase.from('promoter_conversions')
          .select('promoter_id, amount, commission').in('promoter_id', memberIds);
        const { data: clicks } = await supabase.from('promoter_clicks')
          .select('promoter_id').in('promoter_id', memberIds);
        const convMap: Record<string, { c: number; r: number; co: number }> = {};
        (convs || []).forEach(c => {
          if (!convMap[c.promoter_id]) convMap[c.promoter_id] = { c: 0, r: 0, co: 0 };
          convMap[c.promoter_id].c++;
          convMap[c.promoter_id].r += Number(c.amount || 0);
          convMap[c.promoter_id].co += Number(c.commission || 0);
        });
        const clickMap: Record<string, number> = {};
        (clicks || []).forEach(c => { clickMap[c.promoter_id] = (clickMap[c.promoter_id] || 0) + 1; });

        const userIds = members.map(m => m.user_id).filter(Boolean);
        const profMap: Record<string, { first_name: string | null; last_name: string | null }> = {};
        if (userIds.length) {
          const { data: profilesData } = await supabase.from('profiles').select('id, first_name, last_name').in('id', userIds);
          (profilesData || []).forEach(p => { profMap[p.id] = p; });
        }

        setTeamMembers(members.map(m => {
          const prof = profMap[m.user_id];
          const label = prof?.first_name ? `${prof.first_name} ${prof.last_name || ''}`.trim()
            : m.first_name ? `${m.first_name} ${m.last_name || ''}`.trim() : m.promo_code;
          const cs = convMap[m.id] || { c: 0, r: 0, co: 0 };
          return { id: m.id, label, clicks: clickMap[m.id] || 0, conversions: cs.c, revenue: cs.r, commission: cs.co };
        }).sort((a, b) => b.revenue - a.revenue));
      }
    })();
  }, [promoter?.id]);

  // L'interrupteur « Scanner les entrées » de la fiche owner fait foi (la policy
  // RLS s'appuie sur le même drapeau : masquer la page et refuser l'écriture
  // disent la même chose).
  const canScan = promoter?.can_scan_entries ?? false;

  // Linkage authoritative : guest list & scan ne portent QUE sur les soirées
  // rattachées (assignations actives).
  const hasGuestListAccess = assignments.some(a => a.canAccessGuestlist);

  const refetchStats = useCallback(() => {
    if (promoter) fetchStats(promoter.id);
  }, [promoter, fetchStats]);

  const value: PromoterDataValue = {
    loading: loading || authLoading,
    profileError,
    profiles,
    promoter,
    selectedKey,
    setSelectedKey,
    isOrg,
    scopeName,
    stats: (promoter && statsMap[promoter.id]) || defaultPromoterStats,
    announcements: (promoter && announcementsMap[promoter.id]) || [],
    events,
    eventsLoading,
    templateRules,
    assignments,
    setAssignments,
    canScan,
    hasGuestListAccess,
    teamInfo,
    teamMembers,
    refetchProfiles,
    refetchStats,
  };

  return (
    <PromoterDataContext.Provider value={value}>
      {children}
    </PromoterDataContext.Provider>
  );
}
