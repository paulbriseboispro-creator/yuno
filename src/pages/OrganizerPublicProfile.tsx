import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { motion } from 'framer-motion';
import { ArrowLeft, Calendar, Users, MapPin, Sparkles, Share2, Globe, Bookmark, BookmarkCheck, ChevronRight } from 'lucide-react';
import { Instagram } from '@/components/icons/Instagram';
import { formatInTimeZone } from 'date-fns-tz';
import { fr, enUS, es } from 'date-fns/locale';
import { PARIS_TIMEZONE } from '@/lib/timezone';
import { useLanguage } from '@/contexts/LanguageContext';
import { BottomNav } from '@/components/BottomNav';
import { toast } from 'sonner';
import { getOptimizedImageUrl } from '@/lib/imageOptimization';
import { useTagEventsSource } from '@/hooks/usePurchaseSourceTracking';
import { useVisitorTracking } from '@/hooks/useVisitorTracking';
import { DrinkCard } from '@/components/DrinkCard';
import type { Drink, Event } from '@/types';
import { useStore } from '@/store/useStore';
import { EventSelectionDialog } from '@/components/EventSelectionDialog';
import { CartButton } from '@/components/CartButton';

interface OrgProfile {
  user_id: string;
  display_name: string;
  slug: string | null;
  bio: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  instagram_url: string | null;
  website_url: string | null;
}

interface OrgEvent {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  poster_url: string | null;
  image_url: string | null;
  location_city: string | null;
  venue_id: string | null;
  venue_name?: string;
  venue_logo?: string | null;
}

export default function OrganizerPublicProfile() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { language, t } = useLanguage();
  const locale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  const [profile, setProfile] = useState<OrgProfile | null>(null);
  const [upcoming, setUpcoming] = useState<OrgEvent[]>([]);
  const [past, setPast] = useState<OrgEvent[]>([]);
  const [followersCount, setFollowersCount] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [bioExpanded, setBioExpanded] = useState(false);
  const [showAllPast, setShowAllPast] = useState(false);
  // Drinks menu from partner clubs (active partnerships, drinks-enabled tier, menu_enabled=true)
  const [partnerDrinksByVenue, setPartnerDrinksByVenue] = useState<
    Array<{ venueId: string; venueName: string; drinks: Drink[] }>
  >([]);
  const [selectedPartnerVenueId, setSelectedPartnerVenueId] = useState<string | null>(null);
  const [selectedDrink, setSelectedDrink] = useState<Drink | null>(null);
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const addToCart = useStore((state) => state.addToCart);

  // Tag every visible event with the source so checkout can attribute it
  useTagEventsSource(upcoming.map((e) => e.id), 'organizer_profile');
  // Live visitor tracking on the organizer profile
  useVisitorTracking(undefined, undefined, profile?.user_id || undefined);

  useEffect(() => {
    if (!slug) return;
    void load();
    // Track origin so the smart-back from a standalone /event/:id page returns here.
    sessionStorage.setItem('yuno_event_origin_org_slug', slug);
  }, [slug]);

  const load = async () => {
    setLoading(true);
    try {
      const { data: prof } = await supabase
        .from('organizer_profiles')
        .select('*')
        .eq('slug', slug!)
        .eq('is_public', true)
        .maybeSingle();

      if (!prof) { setLoading(false); return; }
      setProfile(prof as OrgProfile);

      // Events organised by this user — on affiche tous les events publics de cet orga
      // (le filtre is_discoverable concerne uniquement la page Explorer, pas le profil orga
      // qu'un visiteur consulte volontairement).
      const { data: evs } = await supabase
        .from('events')
        .select('id, title, start_at, end_at, poster_url, image_url, location_city, venue_id, partner_venue_id')
        .eq('organizer_user_id', prof.user_id)
        .eq('visibility', 'public')
        .eq('is_active', true)
        .order('start_at', { ascending: true });

      const enriched: OrgEvent[] = (evs ?? []).map((e: any) => ({
        ...e,
        // Normalise: for collab events, the actual host venue lives in partner_venue_id
        venue_id: e.venue_id || e.partner_venue_id || null,
      })) as OrgEvent[];
      const venueIds = [...new Set(enriched.map(e => e.venue_id).filter(Boolean) as string[])];
      if (venueIds.length > 0) {
        const { data: venues } = await supabase
          .from('venues').select('id, name, logo_url').in('id', venueIds);
        const map: Record<string, { name: string; logo_url: string | null }> = {};
        venues?.forEach(v => { map[v.id] = { name: v.name, logo_url: v.logo_url }; });
        enriched.forEach(e => {
          if (e.venue_id && map[e.venue_id]) {
            e.venue_name = map[e.venue_id].name;
            e.venue_logo = map[e.venue_id].logo_url;
          }
        });
      }

      const now = new Date().toISOString();
      setUpcoming(enriched.filter(e => e.end_at >= now));
      setPast(enriched.filter(e => e.end_at < now).reverse().slice(0, 12));

      // Followers count + status
      const { count } = await supabase
        .from('organizer_profile_followers')
        .select('*', { count: 'exact', head: true })
        .eq('organizer_user_id', prof.user_id);
      setFollowersCount(count ?? 0);

      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: f } = await supabase
          .from('organizer_profile_followers')
          .select('id')
          .eq('organizer_user_id', prof.user_id)
          .eq('user_id', user.id)
          .maybeSingle();
        setIsFollowing(!!f);
      }

      // ===== Partner clubs drinks menu =====
      // Aggregate drinks from each club that has an ACTIVE partnership with this organizer.
      // Only display when the club has menu_enabled = true AND a paid/collab subscription
      // (anything other than the free 'core' tier).
      try {
        // Source 1: declared active partnerships
        const { data: partnerships } = await supabase
          .from('venue_organizer_partnerships')
          .select('venue_id')
          .eq('organizer_user_id', prof.user_id)
          .eq('status', 'active');

        // Source 2: any host venue used by this orga's events (solo @ partner club, or co_event)
        // — this catches collab events even when no formal partnership row exists.
        const eventHostVenueIds = enriched
          .map((e: any) => e.venue_id)
          .filter(Boolean) as string[];

        const partnerVenueIds = [
          ...new Set([
            ...(partnerships ?? []).map((p: any) => p.venue_id).filter(Boolean),
            ...eventHostVenueIds,
          ]),
        ];

        if (partnerVenueIds.length > 0) {
          const [{ data: vRows }, { data: subRows }] = await Promise.all([
            supabase.from('venues').select('id, name, menu_enabled').in('id', partnerVenueIds),
            supabase
              .from('venue_subscriptions')
              .select('venue_id, subscription_plan, status')
              .in('venue_id', partnerVenueIds)
              .in('status', ['active', 'trialing']),
          ]);

          const planByVenue: Record<string, string> = {};
          (subRows ?? []).forEach((s: any) => { planByVenue[s.venue_id] = s.subscription_plan; });

          const eligibleVenues = (vRows ?? []).filter((v: any) =>
            v.menu_enabled === true && (planByVenue[v.id] || 'core') !== 'core'
          );

          if (eligibleVenues.length > 0) {
            const eligibleIds = eligibleVenues.map((v: any) => v.id);
            const { data: drinksData } = await supabase
              .from('drinks')
              .select('*')
              .in('venue_id', eligibleIds)
              .eq('active', true)
              .order('position', { ascending: true });

            const grouped: Record<string, Drink[]> = {};
            (drinksData ?? []).forEach((d: any) => {
              const mapped: Drink = {
                id: d.id,
                name: d.name,
                description: d.description || '',
                price: Number(d.price),
                promoPrice: d.promo_price ? Number(d.promo_price) : undefined,
                presalePrice: d.presale_price ? Number(d.presale_price) : undefined,
                presaleActive: d.presale_active || false,
                alcPct: d.alc_pct ? Number(d.alc_pct) : undefined,
                imgUrl: d.img_url,
                venueId: d.venue_id,
                active: d.active,
                position: d.position || 0,
                collection: (d.collection || 'drink') as 'drink' | 'shot' | 'soft',
              };
              if (!grouped[d.venue_id]) grouped[d.venue_id] = [];
              grouped[d.venue_id].push(mapped);
            });

            const result = eligibleVenues
              .map((v: any) => ({ venueId: v.id, venueName: v.name, drinks: grouped[v.id] || [] }))
              .filter(g => g.drinks.length > 0);
            setPartnerDrinksByVenue(result);
            if (result.length > 0) setSelectedPartnerVenueId(result[0].venueId);
          }
        }
      } catch (err) {
        console.error('Error loading partner drinks for organizer profile:', err);
      }
    } finally {
      setLoading(false);
    }
  };

  const toggleFollow = async () => {
    if (!profile) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast.info(t('orgPublic.loginToFollow') || 'Connecte-toi pour suivre cet organisateur');
      navigate('/auth');
      return;
    }
    if (isFollowing) {
      await supabase.from('organizer_profile_followers')
        .delete().eq('organizer_user_id', profile.user_id).eq('user_id', user.id);
      setIsFollowing(false);
      setFollowersCount(c => Math.max(0, c - 1));
    } else {
      await supabase.from('organizer_profile_followers')
        .insert({ organizer_user_id: profile.user_id, user_id: user.id });
      setIsFollowing(true);
      setFollowersCount(c => c + 1);
    }
  };

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try { await navigator.share({ title: profile?.display_name || '', url }); } catch {}
    } else {
      await navigator.clipboard.writeText(url);
      toast.success(t('share.copied') || 'Lien copié');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4 px-4">
        <Users className="h-16 w-16 text-muted-foreground/40" />
        <p className="text-muted-foreground">{t('orgPublic.notFound') || 'Organisateur introuvable'}</p>
        <Button variant="outline" onClick={() => navigate('/')}>
          <ArrowLeft className="h-4 w-4 mr-2" /> {t('nav.backHome') || 'Retour'}
        </Button>
      </div>
    );
  }

  const visiblePast = showAllPast ? past : past.slice(0, 3);

  return (
    <div className="relative min-h-[100dvh] bg-background flex flex-col">
      <main className="flex-1 pb-28">
        {/* ===== HERO BANNER 16:9 (VenuePage style) ===== */}
        <div className="relative px-4" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1rem)' }}>
          {/* Floating back */}
          <div className="absolute left-8 z-20" style={{ top: 'calc(env(safe-area-inset-top, 0px) + 2rem)' }}>
            <button
              onClick={() => navigate('/')}
              className="flex items-center justify-center h-10 w-10 rounded-full bg-black/40 backdrop-blur-xl hover:bg-black/60 transition-colors"
            >
              <ArrowLeft className="h-5 w-5 text-white" />
            </button>
          </div>
          {/* Floating share */}
          <div className="absolute right-8 z-20 flex items-center gap-2" style={{ top: 'calc(env(safe-area-inset-top, 0px) + 2rem)' }}>
            <button
              onClick={handleShare}
              className="flex items-center justify-center h-10 w-10 rounded-full bg-black/40 backdrop-blur-xl hover:bg-black/60 transition-colors"
              aria-label={t('orgPublic.share')}
            >
              <Share2 className="h-5 w-5 text-white" />
            </button>
          </div>

          <div className="relative w-full aspect-video rounded-xl overflow-hidden">
            {profile.cover_url ? (
              <motion.img
                initial={{ scale: 1.05, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.6 }}
                src={getOptimizedImageUrl(profile.cover_url, { width: 1200, quality: 80 })}
                alt={profile.display_name}
                fetchPriority="high"
                className="absolute inset-0 w-full h-full object-cover"
              />
            ) : (
              <div className="absolute inset-0 bg-gradient-to-br from-primary/30 via-primary/10 to-background" />
            )}
            <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/60 to-transparent" />
          </div>
        </div>

        {/* ===== IDENTITY ZONE ===== */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="px-5 pt-4 space-y-2.5"
        >
          {/* Name */}
          <h1 className="font-display text-2xl font-bold leading-tight text-foreground">
            {profile.display_name}
          </h1>

          {/* Avatar + organizer badge */}
          <div className="flex items-center gap-2 min-w-0">
            {profile.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt={profile.display_name}
                className="h-7 w-7 rounded-full object-cover border border-white/[0.06] flex-shrink-0 bg-muted"
                onError={(e) => {
                  // Hide broken image and let initials fallback show
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                  const fallback = (e.currentTarget as HTMLImageElement).nextElementSibling as HTMLElement | null;
                  if (fallback) fallback.style.display = 'flex';
                }}
              />
            ) : null}
            <div
              className="flex h-7 w-7 items-center justify-center rounded-full bg-primary flex-shrink-0"
              style={{ display: profile.avatar_url ? 'none' : 'flex' }}
            >
              <span className="text-xs font-bold text-primary-foreground">
                {profile.display_name.charAt(0).toUpperCase()}
              </span>
            </div>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium flex-shrink-0">
              <Sparkles className="h-3 w-3" />
              {t('orgPublic.organizer') || 'Organisateur'}
            </span>
          </div>

          {/* Follow + count */}
          <div className="flex items-center gap-3">
            <Button
              onClick={toggleFollow}
              variant={isFollowing ? 'outline' : 'default'}
              size="sm"
              className={`h-8 px-3 rounded-full text-xs font-medium ${isFollowing ? 'border-border/50' : ''}`}
            >
              {isFollowing ? (
                <><BookmarkCheck className="h-3.5 w-3.5 mr-1.5" /> {t('venue.following') || 'Suivi'}</>
              ) : (
                <><Bookmark className="h-3.5 w-3.5 mr-1.5" /> {t('venue.follow') || 'Suivre'}</>
              )}
            </Button>
            {followersCount > 0 && (
              <span className="text-sm text-muted-foreground">
                {followersCount.toLocaleString()} {followersCount === 1
                  ? (t('venue.follower') || 'abonné')
                  : (t('venue.followers') || 'abonnés')}
              </span>
            )}
          </div>
        </motion.div>

        {/* ===== BIO ===== */}
        {profile.bio && (
          <div className="px-5 pt-4">
            <div className="relative">
              <p className={`text-sm text-muted-foreground leading-relaxed ${!bioExpanded ? 'line-clamp-3' : ''}`}>
                {profile.bio}
              </p>
              {!bioExpanded && profile.bio.length > 180 && (
                <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-background to-transparent" />
              )}
            </div>
            {profile.bio.length > 180 && (
              <button
                onClick={() => setBioExpanded(!bioExpanded)}
                className="text-xs font-medium text-primary mt-1.5"
              >
                {bioExpanded ? (t('event.seeLess') || 'Voir moins') : (t('event.seeMore') || 'Voir plus')}
              </button>
            )}
          </div>
        )}

        {/* ===== SOCIAL LINKS ===== */}
        {(profile.instagram_url || profile.website_url) && (
          <div className="px-5 pt-4 flex gap-2">
            {profile.instagram_url && (
              <a
                href={profile.instagram_url}
                target="_blank"
                rel="noopener noreferrer"
                className="h-9 w-9 rounded-full bg-white/[0.04] backdrop-blur-sm border border-white/[0.08] flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary/40 hover:bg-primary/10 transition-all"
                aria-label="Instagram"
              >
                <Instagram className="h-4 w-4" />
              </a>
            )}
            {profile.website_url && (
              <a
                href={profile.website_url}
                target="_blank"
                rel="noopener noreferrer"
                className="h-9 w-9 rounded-full bg-white/[0.04] backdrop-blur-sm border border-white/[0.08] flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary/40 hover:bg-primary/10 transition-all"
                aria-label="Website"
              >
                <Globe className="h-4 w-4" />
              </a>
            )}
          </div>
        )}

        {/* ===== STATS PILLS ===== */}
        <div className="px-5 pt-6">
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center p-3 rounded-xl bg-white/[0.03] backdrop-blur-sm border border-white/[0.06]">
              <p className="text-xl font-bold text-primary tabular-nums">{upcoming.length}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5 uppercase tracking-wider">
                {t('orgPublic.upcomingDatesCount') || 'À venir'}
              </p>
            </div>
            <div className="text-center p-3 rounded-xl bg-white/[0.03] backdrop-blur-sm border border-white/[0.06]">
              <p className="text-xl font-bold text-foreground tabular-nums">{past.length}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5 uppercase tracking-wider">
                {t('orgPublic.pastDatesCount') || 'Passées'}
              </p>
            </div>
            <div className="text-center p-3 rounded-xl bg-white/[0.03] backdrop-blur-sm border border-white/[0.06]">
              <p className="text-xl font-bold text-foreground tabular-nums">{followersCount}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5 uppercase tracking-wider">
                {t('venue.followers') || 'Abonnés'}
              </p>
            </div>
          </div>
        </div>

        {/* ===== UPCOMING EVENTS — horizontal posters ===== */}
        {upcoming.length > 0 && (
          <div className="mx-auto max-w-7xl pt-8">
            <div className="px-5 mb-4">
              <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                {t('venue.upcomingEvents') || 'Prochains événements'}
              </h3>
            </div>

            <div className="flex gap-5 overflow-x-auto pb-4 px-5 scrollbar-hide">
              {upcoming.map((event, index) => (
                <motion.div
                  key={event.id}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.06 }}
                  className="flex-shrink-0 w-40 sm:w-52 cursor-pointer group"
                  onClick={() => navigate(`/event/${event.id}`)}
                >
                  <div className="relative aspect-[9/16] rounded-xl overflow-hidden bg-muted">
                    {event.poster_url ? (
                      <img
                        src={getOptimizedImageUrl(event.poster_url, { width: 300, height: 533, quality: 75 })}
                        alt={event.title}
                        className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : event.image_url ? (
                      <img
                        src={getOptimizedImageUrl(event.image_url, { width: 300, quality: 70 })}
                        alt={event.title}
                        className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center">
                        <Calendar className="h-12 w-12 text-muted-foreground" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-background via-background/30 to-transparent" />

                    <div className="absolute bottom-0 left-0 right-0 p-3">
                      <p className="text-[10px] uppercase tracking-wider text-white/70 font-medium">
                        {formatInTimeZone(new Date(event.start_at), PARIS_TIMEZONE, 'EEE d MMM', { locale })}
                      </p>
                      <p className="text-sm font-bold text-white mt-0.5 line-clamp-2 leading-tight">
                        {event.title}
                      </p>
                      {(event.venue_name || event.location_city) && (
                        <div className="flex items-center gap-1 mt-1">
                          <MapPin className="h-3 w-3 text-white/60 flex-shrink-0" />
                          <span className="text-[11px] text-white/70 truncate">
                            {event.venue_name || event.location_city}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {/* ===== EMPTY STATE for upcoming ===== */}
        {upcoming.length === 0 && (
          <div className="px-5 pt-8">
            <div className="p-8 text-center rounded-xl bg-white/[0.03] backdrop-blur-sm border border-white/[0.06]">
              <Calendar className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">
                {t('orgPublic.noUpcoming') || 'Aucun événement à venir pour le moment.'}
              </p>
            </div>
          </div>
        )}

        {/* ===== PARTNER CLUBS DRINKS MENU (single unified menu) ===== */}
        {partnerDrinksByVenue.length > 0 && (() => {
          const selectedGroup =
            partnerDrinksByVenue.find((g) => g.venueId === selectedPartnerVenueId) ||
            partnerDrinksByVenue[0];
          if (!selectedGroup) return null;

          // Group drinks by category (collection: drink / shot / soft)
          const categoryLabels: Record<string, string> = {
            drink: t('drinks.category.drink') || 'Cocktails & boissons',
            shot: t('drinks.category.shot') || 'Shots',
            soft: t('drinks.category.soft') || 'Softs',
          };
          const order: Array<'drink' | 'shot' | 'soft'> = ['drink', 'shot', 'soft'];
          const grouped: Record<string, Drink[]> = {};
          selectedGroup.drinks.forEach((d) => {
            const key = (d.collection || 'drink') as string;
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(d);
          });
          const categories = order.filter((k) => grouped[k]?.length > 0);

          return (
            <motion.section
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="pt-8"
            >
              <div className="px-5 mb-3">
                <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  {t('event.drinksMenu') || 'Boissons & cocktails'}
                </h2>
                <p className="text-[11px] text-muted-foreground mt-1">
                  {t('event.drinksServedBy') || 'Servies par'}{' '}
                  <span className="text-foreground font-medium">{selectedGroup.venueName}</span>
                </p>
              </div>

              {/* Partner venue switcher (only if multiple collab venues) */}
              {partnerDrinksByVenue.length > 1 && (
                <div className="flex gap-2 overflow-x-auto px-5 pb-3 scrollbar-none">
                  {partnerDrinksByVenue.map((g) => {
                    const active = g.venueId === selectedGroup.venueId;
                    return (
                      <button
                        key={g.venueId}
                        onClick={() => setSelectedPartnerVenueId(g.venueId)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-colors ${
                          active
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-white/[0.04] text-muted-foreground border-white/[0.08] hover:bg-white/[0.08]'
                        }`}
                      >
                        {g.venueName}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Categorised drinks */}
              <div className="space-y-5">
                {categories.map((cat) => (
                  <div key={cat}>
                    <div className="px-5 flex items-end justify-between mb-2">
                      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {categoryLabels[cat]}
                      </h3>
                      <button
                        onClick={() => navigate(`/club/${selectedGroup.venueId}/drinks/${cat}`)}
                        className="flex items-center gap-0.5 text-xs text-primary font-medium"
                      >
                        {t('common.viewAll') || 'Voir tout'}
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="flex gap-3 overflow-x-auto px-5 pb-2 snap-x snap-mandatory scrollbar-none">
                      {grouped[cat].slice(0, 8).map((drink) => (
                        <div key={drink.id} className="snap-start">
                          <DrinkCard
                            drink={drink}
                            variant="mini"
                            onAdd={(d) => {
                              setSelectedDrink(d);
                              setEventDialogOpen(true);
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </motion.section>
          );
        })()}

        {/* ===== PAST EVENTS — list with thumbnails ===== */}
        {past.length > 0 && (
          <div className="px-5 pt-8 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              {t('orgPublic.pastEvents') || 'Événements passés'}
            </h3>
            <div className="space-y-2 opacity-70">
              {visiblePast.map((event, i) => (
                <motion.div
                  key={event.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 0.7, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="flex items-center gap-3 p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06]"
                >
                  <div className="h-14 w-12 shrink-0 rounded-lg overflow-hidden bg-white/[0.05]">
                    {(event.poster_url || event.image_url) ? (
                      <img
                        src={(event.poster_url || event.image_url)!}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate text-foreground">{event.title}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {formatInTimeZone(new Date(event.start_at), PARIS_TIMEZONE, 'EEE d MMM yyyy', { locale })}
                      {event.venue_name && ` · ${event.venue_name}`}
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>
            {past.length > 3 && !showAllPast && (
              <Button
                variant="outline"
                size="sm"
                className="w-full bg-white/[0.03] border-white/[0.08] hover:bg-white/[0.06]"
                onClick={() => setShowAllPast(true)}
              >
                {t('orgPublic.showAllPast') || `Voir les ${past.length} événements passés`}
              </Button>
            )}
          </div>
        )}
      </main>

      {partnerDrinksByVenue.length > 0 && (
        <>
          <CartButton />
          <EventSelectionDialog
            open={eventDialogOpen}
            onOpenChange={setEventDialogOpen}
            organizerUserId={profile.user_id}
            onEventSelect={(event) => {
              if (selectedDrink) {
                addToCart(selectedDrink, event.id, event.title, event.startAt);
                toast.success(`${selectedDrink.name} – ${event.title}`);
                setSelectedDrink(null);
              }
            }}
          />
        </>
      )}

      <BottomNav />
    </div>
  );
}
