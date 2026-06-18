import { motion } from 'framer-motion';
import { DrinkCard } from '@/components/DrinkCard';
import { CartButton } from '@/components/CartButton';
import { EventSelectionDialog } from '@/components/EventSelectionDialog';

import { BottomNav } from '@/components/BottomNav';
import { FavoriteButton } from '@/components/FavoriteButton';
import { useStore } from '@/store/useStore';
import { Drink, Event, Venue } from '@/types';
import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { useParams } from 'react-router-dom';
import { usePreviewNavigate } from '@/contexts/OwnerPreviewContext';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, ChevronRight, ChevronDown, ChevronUp, Share2, MapPin, Calendar } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { formatInTimeZone } from 'date-fns-tz';
import { fr } from 'date-fns/locale';
import { useLanguage } from '@/contexts/LanguageContext';
import { PARIS_TIMEZONE, nowInParis } from '@/lib/timezone';
import { useVisitorTracking } from '@/hooks/useVisitorTracking';
import { usePromoterTracking } from '@/hooks/usePromoterTracking';
import { getOptimizedImageUrl } from '@/lib/imageOptimization';
import { useFavorites } from '@/hooks/useFavorites';
import { VenuePromoSection } from '@/components/upsell/VenuePromoSection';
import { useTagEventsSource } from '@/hooks/usePurchaseSourceTracking';

interface VenueData extends Venue {
  description?: string;
  shortDescription?: string;
  musicGenre?: string;
  minAge?: number;
  instagramUrl?: string;
  facebookUrl?: string;
  tiktokUrl?: string;
  twitterUrl?: string;
  galleryImages?: string[];
  whatsappNumber?: string;
}

function VenueDescription({ description }: { description: string }) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useLanguage();
  const isLong = description.length > 180;

  return (
    <div className="px-5 pt-5">
      <div className="relative">
        <p
          className={!expanded && isLong ? 'line-clamp-3' : ''}
          style={{ fontSize: '14px', color: '#9A9A9A', lineHeight: 1.65, letterSpacing: '0.01em' }}
        >
          {description}
        </p>
        {!expanded && isLong && (
          <div
            className="absolute bottom-0 left-0 right-0 h-10 pointer-events-none"
            style={{ background: 'linear-gradient(to top, #0A0A0A, transparent)' }}
          />
        )}
      </div>
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 mt-2"
          style={{ fontSize: '11px', color: '#5A5A5E', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.06em', textTransform: 'uppercase' }}
        >
          {expanded ? (t('event.seeLess') || 'Voir moins') : (t('event.seeMore') || 'Voir plus')}
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
      )}
    </div>
  );
}

export default function VenuePage() {
  const { slug } = useParams<{ slug: string }>();
  const { trackAddToCart } = useVisitorTracking(slug); // Track visitors for this venue
  usePromoterTracking(slug); // Capture promoter code from URL
  const navigate = usePreviewNavigate();

  // Promoter link redirect: ?ref=CODE without event → hub page, ?ref=CODE&event=ID → event page
  useEffect(() => {
    if (!slug) return;
    const urlParams = new URLSearchParams(window.location.search);
    const refCode = urlParams.get('ref');
    const eventParam = urlParams.get('event');
    const srcParam = urlParams.get('src');

    if (refCode && eventParam) {
      // Direct event link: redirect to event page with ref preserved
      const params = new URLSearchParams();
      params.set('ref', refCode);
      if (srcParam) params.set('src', srcParam);
      navigate(`/club/${slug}/event/${eventParam}?${params.toString()}`, { replace: true });
      return;
    }

    if (refCode && !eventParam) {
      // General promo link: redirect to canonical hub page
      const params = new URLSearchParams();
      if (srcParam) params.set('src', srcParam);
      const suffix = params.toString() ? `?${params.toString()}` : '';
      navigate(`/promoteur/${refCode}${suffix}`, { replace: true });
      return;
    }
  }, [slug, navigate]);
  const { toast } = useToast();
  const { t } = useLanguage();
  const [venue, setVenue] = useState<VenueData | null>(null);
  const [drinks, setDrinks] = useState<Drink[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [venueLoading, setVenueLoading] = useState(true);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [selectedDrink, setSelectedDrink] = useState<Drink | null>(null);
  const [clickCollectMode, setClickCollectMode] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [showBackButton, setShowBackButton] = useState(false);
  const [isExclusiveMode, setIsExclusiveMode] = useState(false);
  const [, setFollowersCount] = useState<number>(0);
  const [venuePlan, setVenuePlan] = useState<string>('core');
  const [photoIndex, setPhotoIndex] = useState(0);
  const carouselRef = useRef<HTMLDivElement>(null);
  const [menuEnabled, setMenuEnabled] = useState<boolean>(true);
  const addToCart = useStore((state) => state.addToCart);

  // Tag every visible event with the source so checkout can attribute it
  useTagEventsSource(events.map((e) => e.id), 'venue_profile');
  const { isFavorite, getFavoritesByType, favorites } = useFavorites();
  
  // Get favorite drink IDs for personalization
  const favoriteDrinkIds = getFavoritesByType('drink').map(f => f.drinkId).filter(Boolean) as string[];

  useEffect(() => {
    // TEMPORARY: Private link system disabled for presentation
    // Clean up any stale exclusive flags
    sessionStorage.removeItem('exclusiveClub');
    setIsExclusiveMode(false);
    setShowBackButton(false);
  }, [slug, navigate]);

  // Update followers count when favorites change
  useEffect(() => {
    if (!slug) return;
    
    const fetchFollowersCount = async () => {
      const { count } = await supabase
        .from('favorites')
        .select('*', { count: 'exact', head: true })
        .eq('venue_id', slug)
        .eq('favorite_type', 'club');
      
      setFollowersCount(count || 0);
    };
    
    fetchFollowersCount();
  }, [slug, favorites]);

  useEffect(() => {
    if (!slug) {
      setNotFound(true);
      setVenueLoading(false);
      return;
    }

    const fetchVenue = async () => {
      try {
        const { data, error } = await supabase
          .from('venues')
          .select('*')
          .eq('id', slug)
          .maybeSingle();

        if (error) throw error;

        if (!data) {
          setNotFound(true);
          setVenueLoading(false);
          return;
        }

        setVenue({
          id: data.id,
          name: data.name,
          city: data.city,
          address: data.address,
          coverUrl: data.cover_url || undefined,
          logoUrl: data.logo_url,
          coverPosition: data.cover_position as { x: number; y: number } | undefined,
          description: (data as any).description || undefined,
          shortDescription: (data as any).short_description || undefined,
          musicGenre: (data as any).music_genre || undefined,
          minAge: (data as any).min_age || undefined,
          instagramUrl: data.instagram_url || undefined,
          facebookUrl: data.facebook_url || undefined,
          tiktokUrl: data.tiktok_url || undefined,
          twitterUrl: data.twitter_url || undefined,
          galleryImages: (data.gallery_images as string[]) || [],
          whatsappNumber: data.whatsapp_number || undefined,
        });
        setClickCollectMode(data.click_collect_mode || false);
        setMenuEnabled(data.menu_enabled !== false);
      } catch (error) {
        console.error('Error fetching venue:', error);
        setNotFound(true);
      } finally {
        setVenueLoading(false);
      }
    };

    fetchVenue();

    // Set up realtime subscription for venue updates
    const venueChannel = supabase
      .channel(`venue-${slug}-changes`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'venues',
          filter: `id=eq.${slug}`,
        },
        (payload) => {
          if (payload.new && 'click_collect_mode' in payload.new) {
            setClickCollectMode(payload.new.click_collect_mode || false);
          }
          fetchVenue();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(venueChannel);
    };
  }, [slug]);

  // Fetch venue subscription plan
  useEffect(() => {
    if (!slug) return;
    const fetchPlan = async () => {
      const { data } = await supabase
        .from('venue_subscriptions')
        .select('subscription_plan')
        .eq('venue_id', slug)
        .in('status', ['active', 'trialing'])
        .maybeSingle();
      setVenuePlan(data?.subscription_plan || 'core');
    };
    fetchPlan();
  }, [slug]);

  const isDrinksEnabled = venuePlan !== 'core' && menuEnabled;

  useEffect(() => {
    if (!slug || notFound || !isDrinksEnabled) {
      setLoading(false);
      return;
    }

    const fetchDrinks = async () => {
      try {
        const { data, error } = await supabase
          .from('drinks')
          .select('*')
          .eq('venue_id', slug)
          .eq('active', true)
          .order('position', { ascending: true });

        if (error) throw error;
        
        const mappedDrinks: Drink[] = (data || []).map((drink: any) => ({
          id: drink.id,
          name: drink.name,
          description: drink.description || '',
          price: Number(drink.price),
          promoPrice: drink.promo_price ? Number(drink.promo_price) : undefined,
          presalePrice: drink.presale_price ? Number(drink.presale_price) : undefined,
          presaleActive: drink.presale_active || false,
          alcPct: drink.alc_pct ? Number(drink.alc_pct) : undefined,
          imgUrl: drink.img_url,
          venueId: drink.venue_id,
          active: drink.active,
          position: drink.position || 0,
          collection: (drink.collection || 'drink') as 'drink' | 'shot' | 'soft',
        }));

        setDrinks(mappedDrinks);
      } catch (error) {
        console.error('Error fetching drinks:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchDrinks();

    const channel = supabase
      .channel(`drinks-${slug}-changes`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'drinks',
          filter: `venue_id=eq.${slug}`,
        },
        () => {
          fetchDrinks();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [slug, notFound, isDrinksEnabled]);

  // State to store ticket prices per event
  const [eventTicketPrices, setEventTicketPrices] = useState<Record<string, number | null>>({});
  // organizer info per event id (only when event is co-organized)
  const [eventOrganizers, setEventOrganizers] = useState<
    Record<string, { name: string; slug: string | null } | undefined>
  >({});

  useEffect(() => {
    if (!slug || notFound) return;

    const fetchEvents = async () => {
      try {
        const now = nowInParis().toISOString();
        // Include both events the venue owns and events where the venue is the
        // partner host (organizer-led co-events).
        const { data, error } = await supabase
          .from('events')
          .select('*')
          .or(`venue_id.eq.${slug},partner_venue_id.eq.${slug}`)
          .eq('is_active', true)
          .gte('end_at', now)
          .order('start_at', { ascending: true });

        if (error) throw error;

        const rawEvents = data || [];

        const mappedEvents: (Event & {
          ticketingEnabled?: boolean;
          posterUrl?: string;
          posterPosition?: { x: number; y: number; scale: number };
          organizerUserId?: string | null;
          musicGenre?: string;
        })[] = rawEvents.map((event: any) => ({
          id: event.id,
          venueId: event.venue_id,
          title: event.title,
          description: event.description || undefined,
          posterUrl: event.poster_url || undefined,
          posterPosition: event.poster_position as { x: number; y: number; scale: number } | undefined,
          startAt: event.start_at,
          endAt: event.end_at,
          isActive: event.is_active,
          ticketingEnabled: event.ticketing_enabled,
          createdAt: event.created_at,
          updatedAt: event.updated_at,
          organizerUserId: event.organizer_user_id ?? null,
          musicGenre: event.music_genre || undefined,
        }));

        setEvents(mappedEvents);

        // Resolve organizer profile for co-organized events
        const organizerIds = Array.from(
          new Set(mappedEvents.map((e) => e.organizerUserId).filter(Boolean) as string[])
        );
        if (organizerIds.length > 0) {
          const { data: orgs } = await supabase
            .from('organizer_profiles' as any)
            .select('user_id, display_name, slug')
            .in('user_id', organizerIds);
          const map: Record<string, { name: string; slug: string | null }> = {};
          (orgs || []).forEach((o: any) => {
            map[o.user_id] = { name: o.display_name || 'Organisateur', slug: o.slug };
          });
          const byEvent: Record<string, { name: string; slug: string | null } | undefined> = {};
          mappedEvents.forEach((e) => {
            if (e.organizerUserId && map[e.organizerUserId]) {
              byEvent[e.id] = map[e.organizerUserId];
            }
          });
          setEventOrganizers(byEvent);
        }

        // Fetch ticket prices for each event with ticketing enabled
        const ticketingEventIds = mappedEvents.filter(e => e.ticketingEnabled).map(e => e.id);
        if (ticketingEventIds.length > 0) {
          const { data: roundsData } = await supabase
            .from('ticket_rounds')
            .select('event_id, price, is_active, tickets_sold, max_tickets')
            .in('event_id', ticketingEventIds)
            .order('position', { ascending: true });

          if (roundsData) {
            const pricesByEvent: Record<string, number | null> = {};
            ticketingEventIds.forEach(eventId => {
              const eventRounds = roundsData.filter(r => r.event_id === eventId);
              // Find first available active round
              const activeRound = eventRounds.find(r => r.is_active && r.tickets_sold < r.max_tickets);
              pricesByEvent[eventId] = activeRound ? Number(activeRound.price) : 
                (eventRounds.length > 0 ? Number(eventRounds[0].price) : null);
            });
            setEventTicketPrices(pricesByEvent);
          }
        }
      } catch (error) {
        console.error('Error fetching events:', error);
      } finally {
        setEventsLoading(false);
      }
    };

    fetchEvents();

    const eventsChannel = supabase
      .channel(`events-${slug}-changes`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'events',
          filter: `venue_id=eq.${slug}`,
        },
        () => {
          fetchEvents();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'events',
          filter: `partner_venue_id=eq.${slug}`,
        },
        () => {
          fetchEvents();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(eventsChannel);
    };
  }, [slug, notFound]);

  const handleAddDrink = (drink: Drink) => {
    setSelectedDrink(drink);
    setEventDialogOpen(true);
  };

  const handleEventSelect = (event: Event) => {
    if (selectedDrink) {
      addToCart(selectedDrink, event.id, event.title, event.startAt);
      trackAddToCart(); // Track add-to-cart in visitor_sessions
      toast({
        title: t('cart.added'),
        description: `${selectedDrink.name} - ${event.title}`,
      });
      setSelectedDrink(null);
    }
  };

  const handleShareVenue = async () => {
    const url = window.location.href;
    const shareData = { title: venue?.name || '', url };
    if (navigator.share) {
      try { await navigator.share(shareData); } catch {}
    } else {
      await navigator.clipboard.writeText(url);
      toast({ title: t('share.copied') });
    }
  };

  if (venueLoading) {
    return (
      <div className="min-h-screen bg-background pb-20">
        <div className="px-4 pt-[calc(env(safe-area-inset-top,0px)+1rem)]">
          <Skeleton className="w-full aspect-video rounded-xl" />
        </div>
        <div className="px-5 pt-4 space-y-3">
          <Skeleton className="h-7 w-2/3" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-7 w-7 rounded-full" />
            <Skeleton className="h-4 w-40" />
          </div>
          <Skeleton className="h-8 w-28 rounded-full" />
        </div>
        <div className="mx-auto max-w-xl px-5 pt-8 space-y-4">
          <Skeleton className="h-4 w-32" />
          <div className="flex flex-col gap-6">
            <Skeleton className="w-full aspect-square rounded-xl" />
            <Skeleton className="w-full aspect-square rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (notFound || !venue) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center px-4">
          <h1 className="text-4xl font-bold mb-4">404</h1>
          <p className="text-muted-foreground mb-6">{t('venue.notFound')}</p>
          <Button onClick={() => navigate('/')}>
            {t('nav.backHome')}
          </Button>
        </div>
      </div>
    );
  }

  // True if any upcoming event starts today
  const isOpenTonight = events.some((e) => {
    const startDate = new Date(e.startAt);
    const today = new Date();
    return startDate.toDateString() === today.toDateString();
  });

  return (
    <div className="relative min-h-[100dvh] flex flex-col" style={{ background: '#0A0A0A' }}>
      <main className="flex-1 pb-28">

        {/* ===== HERO — full-bleed cinematic ===== */}
        <div className="relative overflow-hidden" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px))' }}>
          {/* Floating back button */}
          <div className="absolute left-5 z-20" style={{ top: 'calc(env(safe-area-inset-top, 0px) + 1rem)' }}>
            <button
              onClick={() => {
                const origin = sessionStorage.getItem('yuno_club_origin');
                navigate(origin === 'map' ? '/map' : '/');
              }}
              className="flex items-center justify-center h-9 w-9 hover:opacity-80 transition-opacity"
              style={{ borderRadius: '2px', background: 'rgba(0,0,0,0.40)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', border: 'none' }}
            >
              <ArrowLeft className="h-4 w-4 text-white" />
            </button>
          </div>
          {/* Floating share + fav */}
          <div className="absolute right-5 z-20 flex items-center gap-2" style={{ top: 'calc(env(safe-area-inset-top, 0px) + 1rem)' }}>
            <button
              onClick={handleShareVenue}
              aria-label={t('share.shareVenue')}
              className="flex items-center justify-center h-9 w-9 hover:opacity-80 transition-opacity"
              style={{ borderRadius: '2px', background: 'rgba(0,0,0,0.40)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', border: 'none' }}
            >
              <Share2 className="h-4 w-4 text-white" />
            </button>
            <div
              className="flex items-center justify-center h-9 w-9 hover:opacity-80 transition-opacity"
              style={{ borderRadius: '2px', background: 'rgba(0,0,0,0.40)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', border: 'none' }}
            >
              <FavoriteButton
                type="club"
                id={venue.id}
                variant="ghost"
                size="icon"
                className="h-9 w-9 border-none text-white shadow-none ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                style={{ borderRadius: '2px' } as React.CSSProperties}
              />
            </div>

          </div>

          {/* Hero image — full-bleed 4:3 */}
          <div
            className="relative w-full overflow-hidden"
            key={venue.coverUrl}
            style={{ aspectRatio: '4/3' }}
          >
            {venue.coverUrl ? (
              <motion.img
                initial={{ scale: 1.06, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.7, ease: 'easeOut' }}
                src={getOptimizedImageUrl(venue.coverUrl, { width: 1200, quality: 82 })}
                alt={venue.name}
                fetchPriority="high"
                className="absolute inset-0 w-full h-full object-cover"
                style={{
                  objectPosition: venue.coverPosition
                    ? `${venue.coverPosition.x}% ${venue.coverPosition.y}%`
                    : 'center',
                }}
              />
            ) : (
              <div
                className="absolute inset-0"
                style={{ background: 'linear-gradient(160deg, #1a0f12 0%, #3a1020 100%)' }}
              />
            )}
            {/* Cinematic gradient */}
            <div
              className="absolute inset-0"
              style={{ background: 'linear-gradient(to top, rgba(10,10,10,0.97) 0%, rgba(10,10,10,0.05) 45%, rgba(10,10,10,0.50) 100%)' }}
            />
            {/* OPEN TONIGHT badge */}
            {isOpenTonight && (
              <div
                className="absolute bottom-4 left-5 z-10 flex items-center gap-1.5 px-3 py-1.5"
                style={{ background: 'rgba(10,10,10,0.72)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 10 }}
              >
                <span
                  className="rounded-full animate-pulse flex-shrink-0"
                  style={{ width: 6, height: 6, background: '#E8192C' }}
                />
                <span className="font-mono font-bold text-white" style={{ fontSize: '10px', letterSpacing: '0.10em' }}>
                  OPEN TONIGHT
                </span>
              </div>
            )}
          </div>
        </div>

        {/* ===== IDENTITY BLOCK ===== */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          className="px-5 pt-5"
        >
          <p className="font-mono uppercase mb-2" style={{ fontSize: '10px', color: '#5A5A5E', letterSpacing: '0.16em' }}>
            CLUB{venue.city ? ` · ${venue.city.toUpperCase()}` : ''}
          </p>
          <h1
            className="font-display font-bold"
            style={{ fontSize: 'clamp(34px, 10vw, 54px)', color: '#FFFFFF', textTransform: 'uppercase', letterSpacing: '-0.025em', lineHeight: 0.9, marginBottom: 14 }}
          >
            {venue.name}
          </h1>
          {/* Short bio */}
          {(venue.shortDescription || venue.description) && (
            <p className="font-serif italic mb-4" style={{ fontSize: '14px', color: '#9A9A9A', lineHeight: 1.6, maxWidth: 400 }}>
              {(() => {
                const bio = venue.shortDescription || venue.description!;
                return bio.length > 140 ? `${bio.slice(0, 140).trimEnd()}…` : bio;
              })()}
            </p>
          )}

          {/* Genre pill */}
          {venue.musicGenre && (
            <div className="flex items-center gap-2 mb-4">
              <span
                className="font-mono uppercase"
                style={{ fontSize: '10px', letterSpacing: '0.12em', color: '#9A9A9A', padding: '4px 10px', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 10 }}
              >
                {venue.musicGenre}
              </span>
            </div>
          )}

          <div className="flex items-center gap-3">
            <FavoriteButton
              type="club"
              id={venue.id}
              variant="outline"
              size="sm"
              className="h-8 px-3 rounded-[10px] text-xs font-medium border-border/50 ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
              showLabel
              label={t('subscribe.action')}
              followingLabel={t('subscribe.active')}
            />
            {clickCollectMode && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[8px] bg-primary/10 text-primary text-[10px] font-medium flex-shrink-0">
                🥤 {t('clickCollect.modeActive')}
              </span>
            )}
          </div>
        </motion.div>

        {/* ===== STATS — MUSIC / AREA / AGE ===== */}
        {(venue.musicGenre || venue.city || venue.minAge) && (
          <div
            className="flex items-start px-5 pt-6 pb-5"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', gap: 0 }}
          >
            {venue.musicGenre && (
              <div className="flex flex-col flex-1 min-w-0" style={{ paddingRight: 12 }}>
                <span className="font-mono" style={{ fontSize: '9px', color: '#5A5A5E', letterSpacing: '0.14em', marginBottom: 4 }}>MUSIC</span>
                <span className="font-display font-bold truncate" style={{ fontSize: '15px', color: '#FFFFFF', textTransform: 'uppercase', letterSpacing: '-0.01em', lineHeight: 1.15 }}>{venue.musicGenre}</span>
              </div>
            )}
            {venue.city && (
              <div className="flex flex-col flex-1 min-w-0" style={{ paddingRight: 12, borderLeft: venue.musicGenre ? '1px solid rgba(255,255,255,0.07)' : 'none', paddingLeft: venue.musicGenre ? 12 : 0 }}>
                <span className="font-mono" style={{ fontSize: '9px', color: '#5A5A5E', letterSpacing: '0.14em', marginBottom: 4 }}>AREA</span>
                <span className="font-display font-bold truncate" style={{ fontSize: '15px', color: '#FFFFFF', textTransform: 'uppercase', letterSpacing: '-0.01em', lineHeight: 1.15 }}>{venue.city}</span>
              </div>
            )}
            {venue.minAge && (
              <div className="flex flex-col flex-shrink-0" style={{ borderLeft: '1px solid rgba(255,255,255,0.07)', paddingLeft: 12 }}>
                <span className="font-mono" style={{ fontSize: '9px', color: '#5A5A5E', letterSpacing: '0.14em', marginBottom: 4 }}>AGE</span>
                <span className="font-display font-bold" style={{ fontSize: '15px', color: '#FFFFFF', letterSpacing: '-0.01em', lineHeight: 1.15 }}>{venue.minAge}+</span>
              </div>
            )}
          </div>
        )}


      {/* ===== EVENTS SECTION ===== */}
      {events.length > 0 && (
        <div className="mx-auto max-w-xl pt-8">
          {/* Section header — ruled */}
          <div
            className="flex items-center justify-between px-5"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px' }}
          >
            <p className="font-mono uppercase" style={{ fontSize: '10px', letterSpacing: '0.14em', color: '#5A5A5E' }}>
              {t('venue.upcomingEvents')}
            </p>
            <span className="font-mono" style={{ fontSize: '10px', color: '#3A3A3E', letterSpacing: '0.08em' }}>
              {events.length}
            </span>
          </div>

          {/* Cards — vertical single-column list (1:1 poster + text below) */}
          <div className="flex flex-col gap-6 px-5 pt-4 pb-2">
            {events.map((event, index) => {
              const organizer = eventOrganizers[event.id];
              const isCoOrganized = !!organizer;
              const posterSrc = (event as any).posterUrl;
              const startDate = new Date(event.startAt);

              return (
                <motion.article
                  key={event.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.06 }}
                  onClick={() => {
                    if (isCoOrganized) {
                      navigate(`/event/${event.id}`);
                    } else {
                      navigate(`/club/${slug}/event/${event.id}`);
                    }
                  }}
                  className="cursor-pointer group"
                >
                  {/* Poster — 1:1 */}
                  <div className="relative aspect-square rounded-xl overflow-hidden bg-muted">
                    {posterSrc ? (
                      <img
                        src={getOptimizedImageUrl(posterSrc, { width: 400, height: 400, quality: 75 })}
                        alt={event.title}
                        className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        loading="lazy"
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

                  {/* Text — separated below the image */}
                  <div className="pt-2.5">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                      {formatInTimeZone(startDate, PARIS_TIMEZONE, 'EEE d MMM', { locale: fr })}
                    </p>
                    <p className="text-sm font-bold text-foreground mt-0.5 line-clamp-2 leading-tight">
                      {event.title}
                    </p>
                    {venue.city && (
                      <div className="flex items-center gap-1 mt-1">
                        <MapPin className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                        <span className="text-[11px] text-muted-foreground truncate">
                          {venue.city}
                        </span>
                      </div>
                    )}
                  </div>
                </motion.article>
              );
            })}
          </div>
        </div>
      )}

      {/* ===== LA CARTE ===== */}
      {isDrinksEnabled && (
        <div className="pt-8">
          {/* Promo drinks */}
          <VenuePromoSection drinks={drinks} onAdd={handleAddDrink} />

          {loading ? (
            <div className="flex justify-center py-10">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : drinks.length > 0 && (
            <>
              {([
                { key: 'drink', label: t('venue.drinks'), route: 'drink' },
                { key: 'shot', label: t('venue.shots'), route: 'shot' },
                { key: 'soft', label: t('venue.softs'), route: 'soft' },
              ] as const).map(({ key, label, route }) => {
                const categoryDrinks = [...drinks.filter(d => d.collection === key)]
                  .sort((a, b) => {
                    const aIsFav = favoriteDrinkIds.includes(a.id);
                    const bIsFav = favoriteDrinkIds.includes(b.id);
                    if (aIsFav && !bIsFav) return -1;
                    if (!aIsFav && bIsFav) return 1;
                    return 0;
                  });

                if (categoryDrinks.length === 0) return null;
                const hasMore = categoryDrinks.length > 8;

                return (
                  <motion.section
                    key={key}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.1 }}
                    className="mb-8"
                  >
                    {/* Section header — ruled */}
                    <div
                      className="flex items-center justify-between px-5"
                      style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px' }}
                    >
                      <p className="font-mono uppercase" style={{ fontSize: '10px', letterSpacing: '0.14em', color: '#5A5A5E' }}>
                        {label}
                      </p>
                      <div className="flex items-center gap-3">
                        <span className="font-mono" style={{ fontSize: '10px', color: '#3A3A3E', letterSpacing: '0.08em' }}>
                          {categoryDrinks.length}
                        </span>
                        {hasMore && (
                          <button
                            onClick={() => navigate(`/club/${slug}/drinks/${route}`)}
                            className="flex items-center gap-0.5"
                            style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#5A5A5E', letterSpacing: '0.08em' }}
                          >
                            {t('venue.seeAll')}
                            <ChevronRight className="h-2.5 w-2.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Horizontal scroll */}
                    <div className="flex gap-2.5 overflow-x-auto pb-2 px-5 pt-3 scrollbar-hide">
                      {(hasMore ? categoryDrinks.slice(0, 8) : categoryDrinks).map((drink) => (
                        <DrinkCard
                          key={drink.id}
                          drink={drink}
                          onAdd={handleAddDrink}
                          isFavorite={favoriteDrinkIds.includes(drink.id)}
                          variant="mini"
                        />
                      ))}
                      {hasMore && (
                        <button
                          onClick={() => navigate(`/club/${slug}/drinks/${route}`)}
                          className="flex-shrink-0 flex items-center justify-center"
                          style={{ width: 72, border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)', borderRadius: 3 }}
                        >
                          <div className="text-center">
                            <ChevronRight className="h-4 w-4 mx-auto mb-0.5" style={{ color: '#5A5A5E' }} />
                            <span className="font-mono" style={{ fontSize: '9px', color: '#5A5A5E', letterSpacing: '0.06em' }}>{t('venue.seeAll')}</span>
                          </div>
                        </button>
                      )}
                    </div>
                  </motion.section>
                );
              })}
            </>
          )}
        </div>
      )}

        {/* ===== PHOTOS — snap carousel ===== */}
        {venue.galleryImages && venue.galleryImages.length > 0 && (
          <div className="pt-10">
            <div className="px-5 mb-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px' }}>
              <p className="yuno-rule">PHOTOS</p>
            </div>

            {/* Slides */}
            <div
              ref={carouselRef}
              className="flex overflow-x-auto scrollbar-hide snap-x snap-mandatory"
              style={{ scrollBehavior: 'smooth' }}
              onScroll={() => {
                if (!carouselRef.current) return;
                const { scrollLeft, clientWidth } = carouselRef.current;
                setPhotoIndex(Math.round(scrollLeft / clientWidth));
              }}
            >
              {venue.galleryImages.map((img, i) => (
                <div
                  key={i}
                  className="snap-center flex-shrink-0 w-full relative overflow-hidden"
                  style={{ aspectRatio: '4/3' }}
                >
                  <img
                    src={getOptimizedImageUrl(img, { width: 800, quality: 80 })}
                    alt={`${venue.name} ${i + 1}`}
                    className="absolute inset-0 w-full h-full object-cover"
                    loading="lazy"
                  />
                </div>
              ))}
            </div>

            {/* Dot indicators */}
            {venue.galleryImages.length > 1 && (
              <div className="flex justify-center items-center gap-1.5 mt-3 px-5">
                {venue.galleryImages.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      carouselRef.current?.scrollTo({ left: i * carouselRef.current.clientWidth, behavior: 'smooth' });
                    }}
                    style={{
                      width: i === photoIndex ? 16 : 4,
                      height: 4,
                      borderRadius: 2,
                      background: i === photoIndex ? '#E8192C' : 'rgba(255,255,255,0.18)',
                      transition: 'all 0.2s ease',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ===== THE ROOM — full description ===== */}
        {venue.description && (
          <div className="px-5 pt-10">
            <div style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px', marginBottom: '12px' }}>
              <p className="yuno-rule">THE ROOM</p>
            </div>
            <VenueDescription description={venue.description} />
          </div>
        )}

        {/* ===== INFO CARD ===== */}
        {(venue.address || venue.instagramUrl || venue.whatsappNumber) && (
          <div className="px-5 pt-10">
            <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: '4px', padding: '0 16px' }}>
              {([
                venue.address ? { label: 'Address', type: 'address', value: venue.address } : null,
                venue.instagramUrl ? { label: 'Instagram', type: 'instagram', value: '@' + venue.instagramUrl.replace(/https?:\/\/(www\.)?instagram\.com\//i, '').replace(/\/$/, '') } : null,
                venue.whatsappNumber ? { label: 'WhatsApp', type: 'whatsapp', value: venue.whatsappNumber } : null,
              ]).filter((x): x is { label: string; type: string; value: string } => x !== null)
                .map(({ label, type, value }, i, arr) => (
                  <div
                    key={label}
                    className="flex items-start justify-between gap-3"
                    style={{ padding: '11px 0', borderBottom: i < arr.length - 1 ? '1px solid rgba(255,255,255,0.07)' : 'none' }}
                  >
                    <span className="font-mono flex-shrink-0" style={{ fontSize: '11px', color: '#5A5A5E', letterSpacing: '0.08em' }}>{label}</span>
                    {type === 'address' ? (
                      <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(value)}`} target="_blank" rel="noopener noreferrer" className="font-mono text-right" style={{ fontSize: '12px', color: '#FFFFFF', letterSpacing: '0.02em' }}>{value}</a>
                    ) : type === 'instagram' ? (
                      <a href={venue.instagramUrl!} target="_blank" rel="noopener noreferrer" className="font-mono text-right" style={{ fontSize: '12px', color: '#E8192C', letterSpacing: '0.02em' }}>{value}</a>
                    ) : (
                      <a href={`https://wa.me/${value.replace(/[^0-9]/g, '')}`} target="_blank" rel="noopener noreferrer" className="font-mono text-right" style={{ fontSize: '12px', color: '#25D366', letterSpacing: '0.02em' }}>{value}</a>
                    )}
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Copyright */}
        <div className="px-5 pt-10 pb-4 text-center">
          <p className="font-mono" style={{ fontSize: '10px', color: '#3A3A3E', letterSpacing: '0.08em' }}>
            © {new Date().getFullYear()} {venue.name.toUpperCase()} · POWERED BY YUNO
          </p>
        </div>

      </main>

      {isDrinksEnabled && (
        <>
          <CartButton />
          <EventSelectionDialog
            open={eventDialogOpen}
            onOpenChange={setEventDialogOpen}
            onEventSelect={handleEventSelect}
            venueId={venue.id}
          />
        </>
      )}

      <BottomNav />
    </div>
  );
}
