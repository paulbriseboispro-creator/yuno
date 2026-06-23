import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';
import { FadeInView } from '@/components/motion';
import { ArrowLeft, Calendar, Users, MapPin, Share2, Bell, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react';
import { formatInTimeZone } from 'date-fns-tz';
import { fr, enUS, es } from 'date-fns/locale';
import { PARIS_TIMEZONE } from '@/lib/timezone';
import { useLanguage } from '@/contexts/LanguageContext';
import { BottomNav } from '@/components/BottomNav';
import { FavoriteButton } from '@/components/FavoriteButton';
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

      if (!prof) {
        // Ancien slug (orga renommée, ex. bde-d-mo-paris-ef75) -> résoudre vers le slug
        // canonique courant et rediriger. Aucun lien partagé ne casse.
        const { data: canonical } = await supabase.rpc('resolve_organizer_slug', { p_slug: slug! });
        if (canonical && canonical !== slug) { navigate(`/o/${canonical}`, { replace: true }); return; }
        setLoading(false);
        return;
      }
      setProfile(prof as OrgProfile);

      // Events organised by this user — on affiche tous les events publics de cet orga
      // (le filtre is_discoverable concerne uniquement la page Explorer, pas le profil orga
      // qu'un visiteur consulte volontairement).
      const { data: evs } = await supabase
        .from('events')
        .select('id, title, start_at, end_at, poster_url, location_city, venue_id, partner_venue_id')
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
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#0A0A0A' }}>
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4" style={{ background: '#0A0A0A' }}>
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
    <div className="relative min-h-[100dvh] flex flex-col" style={{ background: '#0A0A0A' }}>
      <main className="flex-1 pb-28">
        {/* ===== HERO — full-bleed cinematic (Yuno DA) ===== */}
        <div className="relative overflow-hidden" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px))' }}>
          {/* Floating back */}
          <div className="absolute left-5 z-20" style={{ top: 'calc(env(safe-area-inset-top, 0px) + 1rem)' }}>
            <button
              onClick={() => navigate('/')}
              className="flex items-center justify-center h-9 w-9 hover:opacity-80 transition-opacity"
              style={{ borderRadius: '2px', background: 'rgba(0,0,0,0.40)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', border: 'none' }}
            >
              <ArrowLeft className="h-4 w-4 text-white" />
            </button>
          </div>
          {/* Floating share */}
          <div className="absolute right-5 z-20 flex items-center gap-2" style={{ top: 'calc(env(safe-area-inset-top, 0px) + 1rem)' }}>
            <button
              onClick={handleShare}
              aria-label={t('orgPublic.share')}
              className="flex items-center justify-center h-9 w-9 hover:opacity-80 transition-opacity"
              style={{ borderRadius: '2px', background: 'rgba(0,0,0,0.40)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', border: 'none' }}
            >
              <Share2 className="h-4 w-4 text-white" />
            </button>
          </div>

          {/* Hero image — full-bleed 4:3 */}
          <div className="relative w-full overflow-hidden" style={{ aspectRatio: '4/3' }}>
            {profile.cover_url ? (
              <motion.img
                initial={{ scale: 1.06, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.7, ease: 'easeOut' }}
                src={getOptimizedImageUrl(profile.cover_url, { width: 1200, quality: 82 })}
                alt={profile.display_name}
                fetchPriority="high"
                className="absolute inset-0 w-full h-full object-cover"
              />
            ) : (
              <div className="absolute inset-0" style={{ background: 'linear-gradient(160deg, #1a0f12 0%, #3a1020 100%)' }} />
            )}
            {/* Cinematic gradient */}
            <div
              className="absolute inset-0"
              style={{ background: 'linear-gradient(to top, rgba(10,10,10,0.97) 0%, rgba(10,10,10,0.05) 45%, rgba(10,10,10,0.50) 100%)' }}
            />
          </div>
        </div>

        {/* ===== IDENTITY BLOCK (Yuno DA) ===== */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          className="px-5 pt-5"
        >
          {/* Kicker — logo + ORGANIZER */}
          <div className="flex items-center gap-2 mb-2">
            {profile.avatar_url && (
              <img
                src={profile.avatar_url}
                alt={profile.display_name}
                className="h-6 w-6 rounded-full object-cover flex-shrink-0"
                style={{ border: '1px solid rgba(255,255,255,0.14)' }}
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              />
            )}
            <p className="font-mono uppercase" style={{ fontSize: '10px', color: '#5A5A5E', letterSpacing: '0.16em' }}>
              {(t('orgPublic.organizer') || 'Organizer').toUpperCase()}
            </p>
          </div>

          <h1
            className="font-display font-bold"
            style={{ fontSize: 'clamp(34px, 10vw, 54px)', color: '#FFFFFF', textTransform: 'uppercase', letterSpacing: '-0.025em', lineHeight: 0.9, marginBottom: 16 }}
          >
            {profile.display_name}
          </h1>

          {/* Follow + count */}
          <div className="flex items-center gap-3">
            <Button
              onClick={toggleFollow}
              variant={isFollowing ? 'outline' : 'default'}
              size="sm"
              className={`h-8 px-3 rounded-[10px] text-xs font-medium ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 ${isFollowing ? 'border-border/50' : ''}`}
            >
              {isFollowing ? (
                <><Bell className="h-3.5 w-3.5 mr-1.5 fill-current" /> {t('subscribe.active')}</>
              ) : (
                <><Bell className="h-3.5 w-3.5 mr-1.5" /> {t('subscribe.action')}</>
              )}
            </Button>
            {followersCount > 0 && (
              <span style={{ fontSize: '13px', color: '#9A9A9A' }}>
                {followersCount.toLocaleString()} {followersCount === 1
                  ? (t('venue.follower') || 'abonné')
                  : (t('venue.followers') || 'abonnés')}
              </span>
            )}
          </div>
        </motion.div>

        {/* ===== BIO ===== */}
        {profile.bio && (
          <div className="px-5 pt-5">
            <div className="relative">
              <p
                className={!bioExpanded ? 'line-clamp-3' : ''}
                style={{ fontSize: '14px', color: '#9A9A9A', lineHeight: 1.65, letterSpacing: '0.01em' }}
              >
                {profile.bio}
              </p>
              {!bioExpanded && profile.bio.length > 180 && (
                <div
                  className="absolute bottom-0 left-0 right-0 h-10 pointer-events-none"
                  style={{ background: 'linear-gradient(to top, #0A0A0A, transparent)' }}
                />
              )}
            </div>
            {profile.bio.length > 180 && (
              <button
                onClick={() => setBioExpanded(!bioExpanded)}
                className="flex items-center gap-1 mt-2"
                style={{ fontSize: '11px', color: '#5A5A5E', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.06em', textTransform: 'uppercase' }}
              >
                {bioExpanded ? (t('event.seeLess') || 'Voir moins') : (t('event.seeMore') || 'Voir plus')}
                {bioExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
            )}
          </div>
        )}

        {/* ===== SOCIAL / INFO CARD (Yuno DA) ===== */}
        {(profile.instagram_url || profile.website_url) && (
          <div className="px-5 pt-6">
            <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: '4px', padding: '0 16px' }}>
              {([
                profile.instagram_url
                  ? { label: 'Instagram', type: 'instagram', value: '@' + profile.instagram_url.replace(/https?:\/\/(www\.)?instagram\.com\//i, '').replace(/\/$/, ''), href: profile.instagram_url }
                  : null,
                profile.website_url
                  ? { label: 'Website', type: 'website', value: profile.website_url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, ''), href: profile.website_url }
                  : null,
              ])
                .filter((x): x is { label: string; type: string; value: string; href: string } => x !== null)
                .map(({ label, type, value, href }, i, arr) => (
                  <div
                    key={label}
                    className="flex items-center justify-between gap-3"
                    style={{ padding: '11px 0', borderBottom: i < arr.length - 1 ? '1px solid rgba(255,255,255,0.07)' : 'none' }}
                  >
                    <span className="font-mono flex-shrink-0" style={{ fontSize: '11px', color: '#5A5A5E', letterSpacing: '0.08em' }}>{label}</span>
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-right truncate"
                      style={{ fontSize: '12px', color: type === 'instagram' ? '#E8192C' : '#FFFFFF', letterSpacing: '0.02em' }}
                    >
                      {value}
                    </a>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* ===== STATS — ruled row (Yuno DA) ===== */}
        <div
          className="flex items-start px-5 pt-6 pb-5 mt-2"
          style={{ borderTop: '1px solid rgba(255,255,255,0.06)', borderBottom: '1px solid rgba(255,255,255,0.06)', gap: 0 }}
        >
          <div className="flex flex-col flex-1 min-w-0" style={{ paddingRight: 12 }}>
            <span className="font-mono" style={{ fontSize: '9px', color: '#5A5A5E', letterSpacing: '0.14em', marginBottom: 4 }}>{(t('orgPublic.upcomingDatesCount') || 'À venir').toUpperCase()}</span>
            <span className="font-display font-bold tabular-nums" style={{ fontSize: '20px', color: '#FFFFFF', letterSpacing: '-0.01em', lineHeight: 1.1 }}>{upcoming.length}</span>
          </div>
          <div className="flex flex-col flex-1 min-w-0" style={{ paddingRight: 12, borderLeft: '1px solid rgba(255,255,255,0.07)', paddingLeft: 12 }}>
            <span className="font-mono" style={{ fontSize: '9px', color: '#5A5A5E', letterSpacing: '0.14em', marginBottom: 4 }}>{(t('orgPublic.pastDatesCount') || 'Passées').toUpperCase()}</span>
            <span className="font-display font-bold tabular-nums" style={{ fontSize: '20px', color: '#FFFFFF', letterSpacing: '-0.01em', lineHeight: 1.1 }}>{past.length}</span>
          </div>
          <div className="flex flex-col flex-1 min-w-0" style={{ borderLeft: '1px solid rgba(255,255,255,0.07)', paddingLeft: 12 }}>
            <span className="font-mono" style={{ fontSize: '9px', color: '#5A5A5E', letterSpacing: '0.14em', marginBottom: 4 }}>{(t('venue.followers') || 'Abonnés').toUpperCase()}</span>
            <span className="font-display font-bold tabular-nums" style={{ fontSize: '20px', color: '#FFFFFF', letterSpacing: '-0.01em', lineHeight: 1.1 }}>{followersCount}</span>
          </div>
        </div>

        {/* ===== UPCOMING EVENTS — single-column vertical list ===== */}
        {upcoming.length > 0 && (
          <div className="mx-auto max-w-xl pt-8">
            <div
              className="flex items-center justify-between px-5"
              style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px' }}
            >
              <p className="font-mono uppercase" style={{ fontSize: '10px', letterSpacing: '0.14em', color: '#5A5A5E' }}>
                {t('venue.upcomingEvents') || 'Prochains événements'}
              </p>
              <span className="font-mono" style={{ fontSize: '10px', color: '#3A3A3E', letterSpacing: '0.08em' }}>
                {upcoming.length}
              </span>
            </div>

            <div className="flex flex-col gap-6 px-5 pt-4 pb-4">
              {upcoming.map((event, index) => (
                <motion.div
                  key={event.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.06 }}
                  className="cursor-pointer group"
                  onClick={() => navigate(`/event/${event.id}`)}
                >
                  <div className="relative aspect-square rounded-xl overflow-hidden bg-muted">
                    {event.poster_url ? (
                      <img
                        src={getOptimizedImageUrl(event.poster_url, { width: 400, height: 400, quality: 75 })}
                        alt={event.title}
                        className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center">
                        <Calendar className="h-12 w-12 text-muted-foreground" />
                      </div>
                    )}

                    {/* Favorite (heart) — top-right of poster */}
                    <div
                      className="absolute top-3 right-3 z-10 flex items-center justify-center rounded-full w-8 h-8"
                      style={{ background: 'rgba(10,10,10,0.55)', border: '1px solid rgba(255,255,255,0.12)', backdropFilter: 'blur(8px)' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <FavoriteButton
                        type="event"
                        id={event.id}
                        className="h-8 w-8 rounded-full border-0 bg-transparent shadow-none ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 p-0"
                        size="icon"
                        iconClassName="h-3.5 w-3.5"
                      />
                    </div>
                  </div>

                  <div className="pt-2.5">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                      {formatInTimeZone(new Date(event.start_at), PARIS_TIMEZONE, 'EEE d MMM', { locale })}
                    </p>
                    <p className="text-sm font-bold text-foreground mt-0.5 line-clamp-2 leading-tight">
                      {event.title}
                    </p>
                    {(event.venue_name || event.location_city) && (
                      <div className="flex items-center gap-1 mt-1">
                        <MapPin className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                        <span className="text-[11px] text-muted-foreground truncate">
                          {event.venue_name || event.location_city}
                        </span>
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {/* ===== EMPTY STATE for upcoming ===== */}
        {upcoming.length === 0 && (
          <div className="px-5 pt-8">
            <div className="p-8 text-center" style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: '4px' }}>
              <Calendar className="h-10 w-10 mx-auto mb-3" style={{ color: '#3A3A3E' }} />
              <p style={{ fontSize: '13px', color: '#5A5A5E' }}>
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
            <FadeInView as="section" className="pt-8">
              <div className="px-5 mb-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px' }}>
                <p className="font-mono uppercase" style={{ fontSize: '10px', letterSpacing: '0.14em', color: '#5A5A5E' }}>
                  {t('event.drinksMenu') || 'Boissons & cocktails'}
                </p>
                <p className="mt-1" style={{ fontSize: '11px', color: '#5A5A5E' }}>
                  {t('event.drinksServedBy') || 'Servies par'}{' '}
                  <span style={{ color: '#FFFFFF', fontWeight: 500 }}>{selectedGroup.venueName}</span>
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
                      <h3 className="font-mono uppercase" style={{ fontSize: '10px', letterSpacing: '0.12em', color: '#5A5A5E' }}>
                        {categoryLabels[cat]}
                      </h3>
                      <button
                        onClick={() => navigate(`/club/${selectedGroup.venueId}/drinks/${cat}`)}
                        className="flex items-center gap-0.5"
                        style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#5A5A5E', letterSpacing: '0.08em' }}
                      >
                        {t('common.viewAll') || 'Voir tout'}
                        <ChevronRight className="h-3 w-3" />
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
            </FadeInView>
          );
        })()}

        {/* ===== PAST EVENTS — list with thumbnails (Yuno DA) ===== */}
        {past.length > 0 && (
          <div className="mx-auto max-w-xl pt-10">
            <div className="px-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px' }}>
              <p className="font-mono uppercase" style={{ fontSize: '10px', letterSpacing: '0.14em', color: '#5A5A5E' }}>
                {t('orgPublic.pastEvents') || 'Événements passés'}
              </p>
            </div>
            <div className="px-5 pt-4">
              {visiblePast.map((event, i) => (
                <motion.div
                  key={event.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="flex items-center gap-3 py-3"
                  style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
                >
                  <div className="h-14 w-12 shrink-0 overflow-hidden" style={{ borderRadius: 3, background: 'rgba(255,255,255,0.05)' }}>
                    {event.poster_url ? (
                      <img
                        src={event.poster_url}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Calendar className="h-4 w-4" style={{ color: '#5A5A5E' }} />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="truncate" style={{ fontSize: '14px', color: '#FFFFFF', fontWeight: 500 }}>{event.title}</p>
                    <p className="font-mono mt-0.5" style={{ fontSize: '11px', color: '#5A5A5E', letterSpacing: '0.04em' }}>
                      {formatInTimeZone(new Date(event.start_at), PARIS_TIMEZONE, 'EEE d MMM yyyy', { locale })}
                      {event.venue_name && ` · ${event.venue_name}`}
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>
            {past.length > 3 && !showAllPast && (
              <div className="px-5 pt-4">
                <button
                  onClick={() => setShowAllPast(true)}
                  className="w-full flex items-center justify-center"
                  style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#5A5A5E', letterSpacing: '0.08em', textTransform: 'uppercase', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, padding: '10px 0' }}
                >
                  {t('orgPublic.showAllPast') || `Voir les ${past.length} événements passés`}
                </button>
              </div>
            )}
          </div>
        )}
        {/* Footer */}
        <div className="px-5 pt-10 pb-4 text-center">
          <p className="font-mono" style={{ fontSize: '10px', color: '#3A3A3E', letterSpacing: '0.08em' }}>
            © {new Date().getFullYear()} {profile.display_name.toUpperCase()} · POWERED BY YUNO
          </p>
        </div>

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
