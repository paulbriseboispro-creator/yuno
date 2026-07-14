import { motion } from 'framer-motion';
import { Settings, Trophy, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { isPreviewActive } from '@/contexts/PreviewModeContext';
import { PageFade } from '@/components/PageFade';
import { ProfileSkeleton } from '@/components/skeletons/ProfileSkeleton';
import { useLanguage } from '@/contexts/LanguageContext';
import { LoyaltyRewardsSheet } from '@/components/loyalty/LoyaltyRewardsSheet';
import { ProfileHeader } from '@/components/profile/ProfileHeader';
import { NightlifeSection } from '@/components/profile/NightlifeSection';
import { FunStats } from '@/components/profile/FunStats';
import { TasteQuiz } from '@/components/profile/TasteQuiz';
import { SuggestedEvents } from '@/components/profile/SuggestedEvents';
import { RewardsSection } from '@/components/profile/RewardsSection';
import { LoyaltyHubCard } from '@/components/profile/LoyaltyHubCard';
import { RoleAccessCards } from '@/components/profile/RoleAccessCards';
import { YunoAssistant } from '@/components/profile/YunoAssistant';
import { PartyStreak } from '@/components/profile/PartyStreak';
import { ProfileShareCard } from '@/components/profile/ProfileShareCard';
import { ProfileQuickStats } from '@/components/profile/ProfileQuickStats';
import { useNightlifeProfile } from '@/hooks/useNightlifeProfile';
import { useLeaderboard } from '@/hooks/useLeaderboard';
import { toast } from 'sonner';

export default function Profile() {
  const { user, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [showLoyaltySheet, setShowLoyaltySheet] = useState(false);
  const [selectedVenueId, setSelectedVenueId] = useState<string | null>(null);
  const [userRoles, setUserRoles] = useState<string[]>([]);
  const [isOrganizerProfile, setIsOrganizerProfile] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isAffiliate, setIsAffiliate] = useState(false);
  const [isAffiliatePromoter, setIsAffiliatePromoter] = useState(false);
  const [showQuiz, setShowQuiz] = useState(false);
  const [showShareSheet, setShowShareSheet] = useState(false);
  
  const {
    profile,
    stats,
    loyaltyCards,
    tasteProfile,
    badge,
    streak,
    loading,
    updateProfile,
    refetch
  } = useNightlifeProfile();

  // Fetch leaderboard ranks for all venues
  const [venueRanks, setVenueRanks] = useState<Record<string, number>>({});
  
  useEffect(() => {
    if (user && loyaltyCards.length > 0) {
      supabase
        .from('client_scores')
        .select('venue_id, rank')
        .eq('user_id', user.id)
        .then(({ data }) => {
          if (data) {
            const map: Record<string, number> = {};
            data.forEach((s: any) => { if (s.rank) map[s.venue_id] = s.rank; });
            setVenueRanks(map);
          }
        });
    }
  }, [user, loyaltyCards.length]);

  // Enrich loyalty cards with rank data
  const enrichedCards = loyaltyCards.map(card => ({
    ...card,
    rank: venueRanks[card.venue_id] || null,
  }));

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth?redirect=/profile');
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (user) {
      fetchUserRoles();
      checkAdminStatus();
    }
  }, [user]);

  const checkAdminStatus = async () => {
    // Aperçu preview : le compte démo owner est super-admin, mais un prospect ne doit
    // JAMAIS voir d'accès admin (la carte « Admin » est masquée). Le super-admin ne sert
    // qu'à womber, hors preview.
    if (isPreviewActive()) { setIsAdmin(false); return; }
    try {
      const { data } = await supabase.rpc('is_super_admin');
      setIsAdmin(data === true);
    } catch (error) {
      console.error('Error checking admin status:', error);
    }
  };

  const fetchUserRoles = async () => {
    try {
      const [{ data: roles }, { data: profileRow }] = await Promise.all([
        supabase.from('user_roles').select('role').eq('user_id', user?.id),
        supabase.from('profiles').select('profile_type').eq('id', user?.id).maybeSingle(),
      ]);

      if (roles && roles.length > 0) {
        const roleList = roles.map((r) => r.role);
        setUserRoles(roleList);
        setIsAffiliate(roleList.includes('affiliate') && !roleList.includes('affiliate_member'));
        setIsAffiliatePromoter(roleList.includes('affiliate_member'));
      }
      // Organizer access is driven by profile_type, not user_roles.
      setIsOrganizerProfile(profileRow?.profile_type === 'organizer');
    } catch (error) {
      console.error('Error fetching roles:', error);
    }
  };

  const handleAvatarUpdate = async (avatarUrl: string, backgroundUrl: string) => {
    const result = await updateProfile({ avatar_url: avatarUrl, background_url: backgroundUrl });
    if (result.success) {
      refetch();
    }
  };

  const handleLoyaltyCardClick = (venueId: string) => {
    setSelectedVenueId(venueId);
    setShowLoyaltySheet(true);
  };

  // Silhouette fidèle de la page pendant le chargement (auth OU data) — zéro layout shift
  if (authLoading || loading) {
    return <ProfileSkeleton />;
  }

  // Build nightlife data for the NightlifeSection
  const nightlifeData = stats ? {
    nextEvent: stats.next_event_title ? {
      title: stats.next_event_title,
      date: stats.next_event_date,
      venueName: stats.next_event_venue_name
    } : null,
    lastEvent: stats.last_event_title ? {
      title: stats.last_event_title,
      date: stats.last_event_date,
      venueName: stats.last_event_venue_name
    } : null,
    favoriteDrink: stats.favorite_drink,
    favoriteClub: stats.favorite_club_name
  } : {
    nextEvent: null,
    lastEvent: null,
    favoriteDrink: null,
    favoriteClub: null
  };

  const handleBack = () => {
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      <PageFade className="mx-auto max-w-3xl p-3 sm:p-4 space-y-4 sm:space-y-6">
        {/* Immersive Profile Header with Avatar Hero */}
        <ProfileHeader
          firstName={profile?.first_name || null}
          avatarUrl={profile?.avatar_url || null}
          backgroundUrl={profile?.background_url || null}
          city={profile?.city || null}
          badge={badge}
          userId={user?.id || ''}
          onAvatarUpdate={handleAvatarUpdate}
          onBack={handleBack}
          onShareClick={() => setShowShareSheet(true)}
          onCityUpdate={() => refetch()}
        />

        {/* Yuno AI Assistant - CTA above stats */}
        <YunoAssistant firstName={profile?.first_name} />

        {/* Quick Stats - Large glassmorphic cards */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
        >
          <ProfileQuickStats
            nightsAttended={Number(stats?.nights_attended) || 0}
            venuesVisited={stats?.venues_visited || 0}
            drinksOrdered={Number(stats?.drinks_ordered) || 0}
            citiesExplored={stats?.cities_explored || 0}
            mostActiveHour={stats?.most_active_hour || 23}
          />
        </motion.div>

        {/* Party Streak */}
        <PartyStreak
          currentStreak={streak.currentStreak}
          longestStreak={streak.longestStreak}
        />

        {/* Role Access Cards */}
        <RoleAccessCards
          isAdmin={isAdmin}
          isOwner={userRoles.includes('owner')}
          isManager={userRoles.includes('manager')}
          isPromoter={userRoles.includes('promoter')}
          isDJ={userRoles.includes('dj')}
          isBarman={userRoles.includes('barman')}
          isBouncer={userRoles.includes('bouncer')}
         isVipHost={userRoles.includes('vip_host')}
          isCloakroom={userRoles.includes('cloakroom')}
          isOrganizer={isOrganizerProfile || userRoles.includes('organizer')}
          isAffiliate={isAffiliate}
          isAffiliatePromoter={isAffiliatePromoter}
        />

        {/* Yuno AI Assistant - moved above stats */}

        {/* Taste Quiz - DISABLED FOR NOW 
        {!tasteProfile && !showQuiz && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <TasteQuiz
              userId={user?.id || ''}
              onComplete={() => {
                setShowQuiz(false);
                refetch();
              }}
            />
          </motion.div>
        )}

        {showQuiz && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <TasteQuiz
              userId={user?.id || ''}
              onComplete={() => {
                setShowQuiz(false);
                refetch();
              }}
            />
          </motion.div>
        )}

        {tasteProfile && user && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12 }}
          >
            <SuggestedEvents
              userId={user.id}
              tasteProfile={tasteProfile}
              favoriteClubId={stats?.favorite_club_id}
            />
          </motion.div>
        )}
        END DISABLED */}

        {/* Unified Loyalty & Leaderboard Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.13 }}
        >
          <LoyaltyHubCard
            cards={enrichedCards}
            onCardClick={handleLoyaltyCardClick}
            onViewAll={() => navigate('/loyalty')}
          />
        </motion.div>




        {/* 2. My Nightlife Section (SECOND) */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.16 }}
        >
          <NightlifeSection
            nextEvent={nightlifeData.nextEvent}
            lastEvent={nightlifeData.lastEvent}
            favoriteDrink={nightlifeData.favoriteDrink}
            favoriteClub={nightlifeData.favoriteClub}
          />
        </motion.div>

        {/* 3. Night DNA - Fun Stats (THIRD) */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.18 }}
        >
        <FunStats
            nightsAttended={Number(stats?.nights_attended) || 0}
            drinksOrdered={Number(stats?.drinks_ordered) || 0}
            mostActiveHour={stats?.most_active_hour || 23}
            totalSpent={Number(stats?.total_spent) || 0}
            venuesVisited={stats?.venues_visited || 0}
            citiesExplored={stats?.cities_explored || 0}
            favoriteClubVisits={stats?.favorite_club_visits || 0}
            favoriteClubName={stats?.favorite_club_name}
            favoriteClubLogo={stats?.favorite_club_logo}
            lastEventTitle={stats?.last_event_title}
            lastEventDate={stats?.last_event_date}
            hasVipReservation={stats?.has_vip_reservation || false}
            hasRedeemedReward={stats?.has_redeemed_reward || false}
          />
        </motion.div>

        {/* 4. Retake Quiz Button - DISABLED FOR NOW
        {tasteProfile && !showQuiz && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="flex justify-center"
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowQuiz(true)}
              className="text-primary"
            >
              🎯 {t('quiz.retakeQuiz')}
            </Button>
          </motion.div>
        )}
        END DISABLED */}

        {/* Share Profile Sheet (triggered from header button) */}
        <ProfileShareCard
          open={showShareSheet}
          onOpenChange={setShowShareSheet}
          firstName={profile?.first_name || null}
          avatarUrl={profile?.avatar_url || null}
          badge={badge}
          nightsAttended={Number(stats?.nights_attended) || 0}
          venuesVisited={stats?.venues_visited || 0}
          drinksOrdered={Number(stats?.drinks_ordered) || 0}
          citiesExplored={stats?.cities_explored || 0}
          currentStreak={streak.currentStreak}
          favoriteClub={stats?.favorite_club_name || null}
        />

        {/* Edit Info Button */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
        >
          <button
            className="btn btn--ghost w-full"
            onClick={() => navigate('/settings')}
          >
            <Settings className="h-4 w-4" />
            {t('profile.editMyInfo')}
          </button>
        </motion.div>
      </PageFade>

      
      {/* Loyalty Rewards Sheet */}
      {selectedVenueId && (
        <LoyaltyRewardsSheet
          open={showLoyaltySheet}
          onOpenChange={setShowLoyaltySheet}
          venueId={selectedVenueId}
        />
      )}
    </div>
  );
}
