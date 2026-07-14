import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ProfilePhotoUpload } from '@/components/ProfilePhotoUpload';
import { VenuePromoterContent } from '@/components/promoter/VenuePromoterContent';
import { toast } from 'sonner';
import { Home, Building2, KeyRound } from 'lucide-react';
import { ChangePinFlow } from '@/components/ChangePinFlow';
import { RoleIntroGate } from '@/components/onboarding/RoleIntroGate';
import type { PromoterStats } from '@/types/promoter';

interface Promoter {
  id: string;
  user_id: string;
  venue_id: string | null;
  organizer_user_id?: string | null;
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
  venue?: { id: string; name: string; logo_url?: string; custom_domain?: string };
  /** Resolved organizer name for organizer-scoped profiles (no venue). */
  organizerName?: string;
}

/** Stable key for a profile's tab — venue-scoped uses venue_id, organizer-scoped uses the org id. */
const scopeKey = (p: Pick<Promoter, 'venue_id' | 'organizer_user_id'>) =>
  p.venue_id ?? (p.organizer_user_id ? `org:${p.organizer_user_id}` : 'unknown');

interface Announcement {
  id: string;
  title: string;
  content: string;
  created_at: string;
}

const STORAGE_KEY = 'promoter_selected_venue';

const defaultStats: PromoterStats = {
  totalClicks: 0, clicksToday: 0, clicksThisWeek: 0, clicksThisMonth: 0,
  totalConversions: 0, conversionsThisMonth: 0, conversionRate: 0,
  totalRevenue: 0, revenueThisMonth: 0, totalCommission: 0, pendingCommission: 0,
  approvedCommission: 0, paidCommission: 0,
  ticketsSold: 0, tablesReserved: 0,
};

export default function PromoterDashboard() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState<'no_profile' | 'inactive' | null>(null);
  const [allPromoterProfiles, setAllPromoterProfiles] = useState<Promoter[]>([]);
  const [activeTab, setActiveTab] = useState<string>('');
  const [statsMap, setStatsMap] = useState<Record<string, PromoterStats>>({});
  const [announcementsMap, setAnnouncementsMap] = useState<Record<string, Announcement[]>>({});
  const [showChangePinFlow, setShowChangePinFlow] = useState(false);

  useEffect(() => {
    if (!authLoading && user) fetchAllPromoterProfiles();
  }, [user, authLoading]);

  // Realtime: listen for new conversions
  useEffect(() => {
    if (allPromoterProfiles.length === 0) return;
    const promoterIds = allPromoterProfiles.map(p => p.id);
    
    const channel = supabase
      .channel(`promoter-conversions-${user?.id}-${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'promoter_conversions',
        },
        (payload) => {
          const newConversion = payload.new as any;
          if (promoterIds.includes(newConversion.promoter_id)) {
            // Refresh stats for the relevant promoter
            const promoter = allPromoterProfiles.find(p => p.id === newConversion.promoter_id);
            if (promoter) {
              fetchStats(promoter.id, promoter.venue_id);
              toast.success(
                t('promoter.newConversion') || (newConversion.conversion_type === 'ticket' ? '🎟️ Nouvelle vente !' : '🍾 Nouvelle réservation !'),
                { duration: 4000 }
              );
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [allPromoterProfiles]);

  useEffect(() => {
    if (allPromoterProfiles.length > 0 && !activeTab) {
      const saved = localStorage.getItem(STORAGE_KEY);
      const valid = allPromoterProfiles.find(p => scopeKey(p) === saved);
      setActiveTab(valid ? saved! : scopeKey(allPromoterProfiles[0]));
    }
  }, [allPromoterProfiles, activeTab]);

  useEffect(() => {
    if (activeTab) localStorage.setItem(STORAGE_KEY, activeTab);
  }, [activeTab]);

  async function fetchAllPromoterProfiles() {
    if (!user) return;
    try {
      // Query all profiles (active AND inactive) to give a precise error message
      const { data, error } = await supabase
        .from('promoters')
        .select('*, venue:venues(id, name, logo_url, custom_domain)')
        .eq('user_id', user.id);
      if (error) throw error;

      if (!data || data.length === 0) {
        setProfileError('no_profile');
        return;
      }

      const activeProfiles = data.filter(p => p.is_active);
      if (activeProfiles.length === 0) {
        setProfileError('inactive');
        return;
      }

      // Resolve organizer display names for organizer-scoped profiles (no venue) so the
      // tab reads as the organizer, not a generic "Club".
      const orgIds = [...new Set(activeProfiles
        .filter(p => !p.venue_id && p.organizer_user_id)
        .map(p => p.organizer_user_id as string))];
      const orgNames: Record<string, string> = {};
      if (orgIds.length) {
        const { data: orgs } = await supabase.from('organizer_profiles')
          .select('user_id, display_name').in('user_id', orgIds);
        (orgs || []).forEach(o => { if (o.display_name) orgNames[o.user_id] = o.display_name; });
      }
      const enriched = activeProfiles.map(p => ({
        ...p,
        organizerName: !p.venue_id && p.organizer_user_id ? orgNames[p.organizer_user_id] : undefined,
      }));

      setProfileError(null);
      setAllPromoterProfiles(enriched);
      await Promise.all(enriched.map(async (p) => {
        await fetchStats(p.id, p.venue_id);
        if (p.venue_id) await fetchAnnouncements(p.venue_id);
      }));
    } catch (error) {
      console.error('Error fetching promoter data:', error);
      toast.error(t('promoter.loadingError'));
    } finally {
      setLoading(false);
    }
  }

  async function fetchStats(promoterId: string, _venueId: string | null) {
    try {
      const { count: totalClicks } = await supabase.from('promoter_clicks').select('*', { count: 'exact', head: true }).eq('promoter_id', promoterId);
      const { data: conversions } = await supabase.from('promoter_conversions').select('*').eq('promoter_id', promoterId);
      const totalConversions = conversions?.length || 0;
      const ticketsSold = conversions?.filter(c => c.conversion_type === 'ticket' && (c.amount || 0) > 0).length || 0;
      const tablesReserved = conversions?.filter(c => c.conversion_type === 'table' && (c.amount || 0) > 0).length || 0;
      const totalRevenue = conversions?.reduce((sum, c) => sum + (c.amount || 0), 0) || 0;
      const totalCommission = conversions?.reduce((sum, c) => sum + (c.commission || 0), 0) || 0;
      const pendingCommission = conversions?.filter(c => c.status === 'pending').reduce((sum, c) => sum + (c.commission || 0), 0) || 0;

      // Get payouts for approved/paid
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
        }
      }));
    } catch (error) { console.error('Error fetching stats:', error); }
  }

  async function fetchAnnouncements(venueId: string) {
    try {
      const { data } = await supabase.from('promoter_announcements').select('*').eq('venue_id', venueId).order('created_at', { ascending: false }).limit(5);
      setAnnouncementsMap(prev => ({ ...prev, [venueId]: data || [] }));
    } catch (error) { console.error('Error fetching announcements:', error); }
  }


  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (profileError) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="text-center max-w-md space-y-4">
          <div className="h-16 w-16 rounded-2xl bg-destructive/10 flex items-center justify-center mx-auto">
            <KeyRound className="h-8 w-8 text-destructive" />
          </div>
          <h1 className="text-2xl font-bold">
            {profileError === 'no_profile'
              ? "Aucun profil promoteur trouvé"
              : "Compte promoteur désactivé"}
          </h1>
          <p className="text-muted-foreground">
            {profileError === 'no_profile'
              ? "Votre compte a bien le rôle promoteur, mais aucun profil n'a encore été créé pour vous. L'owner du club doit vous inviter depuis son tableau de bord Promoteurs."
              : "Votre profil promoteur existe mais a été désactivé par l'owner du club. Contactez-le pour réactiver votre accès."}
          </p>
          <Button variant="outline" onClick={() => navigate('/')}>
            <Home className="h-4 w-4 mr-2" /> Retour à l'accueil
          </Button>
        </div>
      </div>
    );
  }

  if (showChangePinFlow) {
    return <ChangePinFlow onClose={() => setShowChangePinFlow(false)} hasExistingPin={true} />;
  }

  return (
    <div
      className="min-h-screen dashboard-gradient-bg"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 2rem)' }}
    >
      <RoleIntroGate role="promoter" />
      <header className="sticky top-0 z-40 border-b border-border/30 bg-surface/60 backdrop-blur-xl" style={{ paddingTop: 'max(0.25rem, env(safe-area-inset-top, 0.25rem))' }}>
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-2 px-4">
          <Button variant="ghost" size="icon" className="shrink-0" onClick={() => navigate('/')}>
            <Home className="h-5 w-5" />
          </Button>
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="shrink-0">
              <ProfilePhotoUpload
                currentImageUrl={allPromoterProfiles[0]?.profile_image_url}
                onUpload={async (url) => {
                  await Promise.all(allPromoterProfiles.map(p =>
                    supabase.from('promoters').update({ profile_image_url: url }).eq('id', p.id)
                  ));
                  fetchAllPromoterProfiles();
                }}
                size="sm"
                fallback={allPromoterProfiles[0]?.promo_code?.[0] || 'P'}
              />
            </div>
            <div className="min-w-0">
              <h1 className="truncate font-semibold">{t('promoter.title')}</h1>
              <p className="truncate text-xs text-muted-foreground">
                {allPromoterProfiles.length} {t('promoter.partnerClubs')}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="shrink-0" onClick={() => setShowChangePinFlow(true)} title="Modifier PIN">
            <KeyRound className="h-5 w-5" />
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-3xl p-4 space-y-4">
        {/* Venue Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="overflow-x-auto -mx-4 px-4 scrollbar-hide">
            <TabsList className="inline-flex w-max h-auto p-1 bg-muted/50 gap-0.5">
              {allPromoterProfiles.map((p) => (
                <TabsTrigger key={scopeKey(p)} value={scopeKey(p)} className="min-h-[44px] gap-2 px-4 py-2.5 data-[state=active]:bg-background data-[state=active]:shadow-sm whitespace-nowrap">
                  {p.venue?.logo_url ? (
                    <img src={p.venue.logo_url} alt={p.venue.name} className="h-5 w-5 shrink-0 rounded-full object-cover" />
                  ) : (
                    <Building2 className="h-4 w-4 shrink-0" />
                  )}
                  <span className="max-w-[8.5rem] truncate font-medium sm:max-w-none">{p.venue?.name || p.organizerName || 'Organisateur'}</span>
                  {!p.is_active && <Badge variant="secondary" className="ml-1 shrink-0 text-xs">{t('promoter.inactive')}</Badge>}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          {allPromoterProfiles.map((promoterProfile) => (
            <TabsContent key={scopeKey(promoterProfile)} value={scopeKey(promoterProfile)} className="mt-4">
              <VenuePromoterContent
                promoter={promoterProfile}
                stats={statsMap[promoterProfile.id] || defaultStats}
                announcements={promoterProfile.venue_id ? (announcementsMap[promoterProfile.venue_id] || []) : []}
                onProfileSaved={() => fetchAllPromoterProfiles()}
                allPromoterProfiles={allPromoterProfiles}
              />
            </TabsContent>
          ))}
        </Tabs>

      </div>
    </div>
  );
}
