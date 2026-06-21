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

interface DJDataValue {
  loading: boolean;
  dj: DJ | null;
  allDJProfiles: DJ[];
  venues: DJVenue[];
  selectedVenueId: string;
  setSelectedVenueId: (id: string) => void;
  sets: DJSet[];
  payments: DJPayment[];
  isProfileIncomplete: boolean;
  upcomingSets: DJSet[];
  pendingAmount: number;
  totalPaid: number;
  chartData: { month: string; amount: number }[];
  refetchProfiles: () => Promise<void>;
  refetchSets: () => Promise<void>;
  refetchPayments: () => Promise<void>;
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
  const [payments, setPayments] = useState<DJPayment[]>([]);
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
      const { data, error } = await supabase
        .from('djs')
        .select('*, venue:venues(id, name, logo_url)')
        .eq('user_id', user.id);

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

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
      return;
    }
    if (user) {
      fetchAllDJProfiles();
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
    venues,
    selectedVenueId,
    setSelectedVenueId,
    sets,
    payments,
    isProfileIncomplete,
    upcomingSets,
    pendingAmount,
    totalPaid,
    chartData,
    refetchProfiles: fetchAllDJProfiles,
    refetchSets: async () => { if (dj) await fetchSets(dj.id); },
    refetchPayments: async () => { if (dj) await fetchPayments(dj.id); },
  };

  return <DJDataContext.Provider value={value}>{children}</DJDataContext.Provider>;
}
