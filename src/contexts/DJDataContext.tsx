import { createContext, useContext, useState, useEffect, useMemo, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { fr, enUS, es } from 'date-fns/locale';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/**
 * Shared data layer for the DJ dashboard app. Mounted once in DJLayout so every
 * routed DJ page (overview / planning / audience / payments / profile) reads the
 * same profile, venue selection, sets and payments without refetching. Mirrors the
 * single-fetch + Outlet pattern used by the affiliate app.
 */

export interface DJ {
  id: string;
  user_id: string;
  venue_id: string;
  first_name: string;
  last_name: string;
  stage_name?: string;
  whatsapp_number?: string;
  instagram_url?: string;
  tiktok_url?: string;
  music_genres: string[];
  bio?: string;
  profile_image_url?: string;
  cover_image_url?: string;
  soundcloud_url?: string;
  spotify_url?: string;
  youtube_url?: string;
  city?: string;
  country?: string;
  description?: string;
  slug?: string;
  featured_track_url?: string | null;
  featured_track_title?: string | null;
  is_active: boolean;
  pending_amount: number;
  total_paid: number;
  venue?: { id: string; name: string; logo_url?: string };
}

export interface DJSet {
  id: string;
  dj_id: string;
  event_id?: string;
  venue_id: string;
  title?: string;
  start_time: string;
  end_time: string;
  music_genre?: string;
  notes?: string;
  fee: number;
  fee_paid: boolean;
  show_on_profile: boolean;
  event?: { title: string };
  venue?: { name: string; address?: string };
}

export interface DJPayment {
  id: string;
  amount: number;
  description?: string;
  paid_at: string;
}

export interface DJVenue {
  id: string;
  name: string;
  logo_url?: string;
}

export interface DJBookingRequest {
  id: string;
  venue_id: string | null;
  organizer_user_id: string | null;
  dj_user_id: string;
  requested_date: string;
  start_time: string | null;
  end_time: string | null;
  agreed_fee: number | null;
  currency: string;
  message: string | null;
  requested_genres: string[] | null;
  event_id: string | null;
  status: 'pending' | 'accepted' | 'declined' | 'expired' | 'cancelled';
  dj_response_note: string | null;
  responded_at: string | null;
  expires_at: string;
  created_at: string;
  venue?: { name: string } | null;
}

export interface DJSecuredContract {
  id: string;
  dj_set_id: string;
  dj_id: string;
  dj_user_id: string;
  venue_id: string | null;
  organizer_user_id: string | null;
  status: 'draft' | 'pending_dj_setup' | 'pending_signatures' | 'pending_payment'
        | 'funds_held' | 'released' | 'cancelled' | 'refunded';
  cachet_cents: number;
  acompte_cents: number;
  stripe_fee_cents: number;
  cancellation_policy: 'acompte_to_dj' | 'full_refund';
  contract_pdf_url: string | null;
  club_signed_at: string | null;
  dj_signed_at: string | null;
  acompte_released_at: string | null;
  released_at: string | null;
  created_at: string;
  dj_set?: { start_time: string; end_time: string; event?: { title: string } | null; venue?: { name: string } | null } | null;
}

interface DJDataValue {
  loading: boolean;
  dj: DJ | null;
  allDJProfiles: DJ[];
  /** Clean canonical public handle for this person (one DJ = one /dj/<handle>). */
  handle: string | null;
  venues: DJVenue[];
  selectedVenueId: string;
  setSelectedVenueId: (id: string) => void;
  sets: DJSet[];
  /** B1 — every gig across ALL of this DJ's venue + organizer profiles, one timeline. */
  allSets: DJSet[];
  payments: DJPayment[];
  /** Booking requests addressed to this person (any of their djs rows), newest first. */
  bookingRequests: DJBookingRequest[];
  /** Secured-payment contracts where this person is the DJ payee, newest first. */
  securedContracts: DJSecuredContract[];
  isProfileIncomplete: boolean;
  upcomingSets: DJSet[];
  pendingAmount: number;
  totalPaid: number;
  chartData: { month: string; amount: number }[];
  refetchProfiles: () => Promise<void>;
  refetchSets: () => Promise<void>;
  refetchAllSets: () => Promise<void>;
  refetchPayments: () => Promise<void>;
  refetchBookingRequests: () => Promise<void>;
  refetchSecuredContracts: () => Promise<void>;
}

const DJDataContext = createContext<DJDataValue | null>(null);

export function useDJData(): DJDataValue {
  const ctx = useContext(DJDataContext);
  if (!ctx) throw new Error('useDJData must be used within a DJDataProvider');
  return ctx;
}

const STORAGE_KEY = 'dj_selected_venue';

export function DJDataProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const { language, t } = useLanguage();
  const navigate = useNavigate();
  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  const [allDJProfiles, setAllDJProfiles] = useState<DJ[]>([]);
  const [selectedVenueId, setSelectedVenueId] = useState<string>('');
  const [sets, setSets] = useState<DJSet[]>([]);
  const [allSets, setAllSets] = useState<DJSet[]>([]);
  const [payments, setPayments] = useState<DJPayment[]>([]);
  const [bookingRequests, setBookingRequests] = useState<DJBookingRequest[]>([]);
  const [securedContracts, setSecuredContracts] = useState<DJSecuredContract[]>([]);
  const [handle, setHandle] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const dj = useMemo(
    () => allDJProfiles.find(p => p.venue_id === selectedVenueId) || null,
    [allDJProfiles, selectedVenueId],
  );

  const venues = useMemo<DJVenue[]>(
    () => allDJProfiles
      .filter(p => p.venue)
      .map(p => ({ id: p.venue_id, name: p.venue!.name, logo_url: p.venue!.logo_url })),
    [allDJProfiles],
  );

  const isProfileIncomplete = !!dj && (!dj.first_name || !dj.last_name);

  const fetchAllDJProfiles = async () => {
    if (!user) return;
    try {
      // A user sees their own DJ profiles plus any roster they manage as an
      // accepted team member. The RPC returns the DJ owner ids the current user
      // can access; if it's absent (migration not yet applied) we fall back to
      // own profiles only — identical to the previous behaviour.
      let ownerIds: string[] = [];
      try {
        const { data: owners } = await (supabase.rpc.bind(supabase) as unknown as (
          fn: 'dj_team_owner_ids',
        ) => Promise<{ data: string[] | null; error: unknown }>)('dj_team_owner_ids');
        if (Array.isArray(owners)) ownerIds = owners.filter(Boolean);
      } catch { /* no team access path available */ }

      const accessibleUserIds = Array.from(new Set([user.id, ...ownerIds]));

      const { data, error } = await supabase
        .from('djs')
        .select('*, venue:venues(id, name, logo_url)')
        .in('user_id', accessibleUserIds);

      if (error) throw error;

      if (!data || data.length === 0) {
        toast.error(t('dj.profileNotFound'));
        navigate('/');
        return;
      }

      setAllDJProfiles(data);

      const savedVenueId = localStorage.getItem(STORAGE_KEY);
      const validSavedVenue = data.find(p => p.venue_id === savedVenueId);
      setSelectedVenueId(prev => prev || (validSavedVenue ? savedVenueId! : data[0].venue_id));
    } catch (error) {
      console.error('Error fetching DJ profiles:', error);
      toast.error(t('dj.loadingError'));
    } finally {
      setLoading(false);
    }
  };

  const fetchSets = async (djId: string) => {
    try {
      const { data, error } = await supabase
        .from('dj_sets')
        .select('*, event:events(title), venue:venues(name, address)')
        .eq('dj_id', djId)
        .order('start_time', { ascending: true });
      if (error) throw error;
      setSets(data || []);
    } catch (error) {
      console.error('Error fetching sets:', error);
    }
  };

  const fetchPayments = async (djId: string) => {
    try {
      const { data, error } = await supabase
        .from('dj_payments')
        .select('*')
        .eq('dj_id', djId)
        .order('paid_at', { ascending: false });
      if (error) throw error;
      setPayments(data || []);
    } catch (error) {
      console.error('Error fetching payments:', error);
    }
  };

  // Booking requests target the PERSON (dj_user_id = current user), so they're fetched
  // once per user, independent of the selected venue profile.
  const fetchBookingRequests = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('dj_booking_requests')
        .select('*, venue:venues(name)')
        .eq('dj_user_id', userId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setBookingRequests((data as unknown as DJBookingRequest[]) || []);
    } catch (error) {
      console.error('Error fetching booking requests:', error);
    }
  };

  // Secured-payment contracts target the PERSON (dj_user_id). The table isn't in the
  // generated Supabase types until the migration is pushed, so we use the bound-this
  // cast the rest of this context already relies on for new RPCs/tables.
  const fetchSecuredContracts = async (userId: string) => {
    try {
      const fromAny = supabase.from.bind(supabase) as unknown as (table: string) => {
        select: (cols: string) => {
          eq: (col: string, val: string) => {
            order: (col: string, opts: { ascending: boolean }) => Promise<{ data: unknown; error: unknown }>;
          };
        };
      };
      const { data, error } = await fromAny('dj_booking_contracts')
        .select('*, dj_set:dj_sets(start_time, end_time, event:events(title), venue:venues(name))')
        .eq('dj_user_id', userId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setSecuredContracts((data as DJSecuredContract[]) || []);
    } catch (error) {
      console.error('Error fetching secured contracts:', error);
    }
  };

  // B1 — every gig the DJ has, across all their venue + organizer profiles, in one
  // timeline. This is what makes Yuno the single place a multi-club DJ's schedule lives.
  const fetchAllSets = async (profileIds: string[]) => {
    if (!profileIds.length) {
      setAllSets([]);
      return;
    }
    try {
      const { data, error } = await supabase
        .from('dj_sets')
        .select('*, event:events(title), venue:venues(name, address)')
        .in('dj_id', profileIds)
        .order('start_time', { ascending: true });
      if (error) throw error;
      setAllSets(data || []);
    } catch (error) {
      console.error('Error fetching all sets:', error);
    }
  };

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
      return;
    }
    if (user) {
      fetchAllDJProfiles();
      fetchBookingRequests(user.id);
      fetchSecuredContracts(user.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading]);

  // Refetch sets + payments whenever the active venue (and therefore the DJ
  // profile row) changes, and persist the selection.
  useEffect(() => {
    if (!dj) return;
    fetchSets(dj.id);
    fetchPayments(dj.id);
    localStorage.setItem(STORAGE_KEY, dj.venue_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dj?.id]);

  // Unified agenda: refetch whenever the full set of DJ profiles changes.
  useEffect(() => {
    fetchAllSets(allDJProfiles.map(p => p.id));
  }, [allDJProfiles]);

  // Resolve the person's clean public handle (reuses the public profile RPC) so the
  // dashboard always shares /dj/<handle>, never a per-venue slug with a -id4 suffix.
  useEffect(() => {
    const first = allDJProfiles.find(p => p.slug);
    if (!first?.slug) { setHandle(null); return; }
    let active = true;
    (async () => {
      const rpc = supabase.rpc.bind(supabase) as unknown as (
        fn: 'get_dj_public_profile', args: { p_slug: string },
      ) => Promise<{ data: { handle?: string } | null; error: unknown }>;
      const { data } = await rpc('get_dj_public_profile', { p_slug: first.slug! });
      if (active) setHandle(data?.handle || first.slug || null);
    })();
    return () => { active = false; };
  }, [allDJProfiles]);

  const upcomingSets = useMemo(
    () => sets.filter(s => new Date(s.start_time) >= new Date()),
    [sets],
  );

  const pendingAmount = useMemo(
    () => sets.filter(s => !s.fee_paid && s.fee > 0).reduce((sum, s) => sum + s.fee, 0),
    [sets],
  );

  const totalPaid = useMemo(
    () => payments.reduce((sum, p) => sum + p.amount, 0),
    [payments],
  );

  const chartData = useMemo(() => {
    const grouped: Record<string, number> = {};
    payments.forEach(p => {
      const month = format(new Date(p.paid_at), 'MMM yyyy', { locale: dateLocale });
      grouped[month] = (grouped[month] || 0) + p.amount;
    });
    return Object.entries(grouped).map(([month, amount]) => ({ month, amount })).reverse();
  }, [payments, dateLocale]);

  const value: DJDataValue = {
    loading: authLoading || loading,
    dj,
    allDJProfiles,
    handle,
    venues,
    selectedVenueId,
    setSelectedVenueId,
    sets,
    allSets,
    payments,
    bookingRequests,
    securedContracts,
    isProfileIncomplete,
    upcomingSets,
    pendingAmount,
    totalPaid,
    chartData,
    refetchProfiles: fetchAllDJProfiles,
    refetchSets: async () => { if (dj) await fetchSets(dj.id); },
    refetchAllSets: async () => { await fetchAllSets(allDJProfiles.map(p => p.id)); },
    refetchPayments: async () => { if (dj) await fetchPayments(dj.id); },
    refetchBookingRequests: async () => { if (user) await fetchBookingRequests(user.id); },
    refetchSecuredContracts: async () => { if (user) await fetchSecuredContracts(user.id); },
  };

  return <DJDataContext.Provider value={value}>{children}</DJDataContext.Provider>;
}
