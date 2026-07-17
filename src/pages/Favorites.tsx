import { useState, useEffect, useMemo } from 'react';
import { Calendar, Wine, MapPin, Music, Users, Compass, ChevronRight, Heart, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { useFavorites } from '@/hooks/useFavorites';
import { supabase } from '@/integrations/supabase/client';
import { formatInTimeZone } from 'date-fns-tz';
import { fr, es, enUS } from 'date-fns/locale';
import { PARIS_TIMEZONE } from '@/lib/timezone';
import { FadeInView } from '@/components/motion';
import { PageFade } from '@/components/PageFade';
import { EmptyState as GlobalEmptyState } from '@/components/EmptyState';
import { Shimmer, SkeletonLine, SkeletonCircle } from '@/components/skeletons/Shimmer';
import { FavoritePosterCard } from '@/components/favorites/FavoritePosterCard';
import { FavoriteListRow } from '@/components/favorites/FavoriteListRow';
import { FavoritesHeader } from '@/components/favorites/FavoritesHeader';
import { D, shuffleSeed, formatCompact, FILTER_OF_KIND, type FavItem, type Filter } from '@/components/favorites/shared';

/* Upcoming-events label, pluralised + interpolated (t() returns the raw string). */
function upcomingNightsLabel(n: number, t: (k: string) => string): string {
  if (n <= 0) return t('favorites.noUpcoming');
  const key = n === 1 ? 'favorites.upcomingNights_one' : 'favorites.upcomingNights_other';
  return t(key).replace('{{count}}', String(n));
}

function followersLabel(n: number, locale: string, t: (k: string) => string): string {
  const key = n === 1 ? 'favorites.followers_one' : 'favorites.followers_other';
  return t(key).replace('{{count}}', formatCompact(n, locale));
}

/** 8 → « 8€ » · 8.5 → « 8.50€ ». Une carte de 170px n'a pas la place d'un « ,00 » inutile. */
function priceLabel(price: number): string {
  return Number.isInteger(price) ? `${price}€` : `${price.toFixed(2)}€`;
}

/* ── Types ── */
interface FavoriteVenue {
  id: string;
  name: string;
  city: string;
  logoUrl?: string;
  coverUrl?: string;
  isAffiliate?: boolean;
  slug?: string;
  musicGenre?: string;
}

interface FavoriteEvent {
  id: string;
  title: string;
  startAt: string;
  endAt?: string;
  posterUrl?: string;
  venueId?: string;
  venueName?: string;
  isAffiliate?: boolean;
  affiliateSlug?: string;
  musicGenres?: string[];
}

interface FavoriteDrink {
  id: string;
  name: string;
  price: number;
  imgUrl: string;
  venueId: string;
  venueName?: string;
  collection: string;
}

interface FavoriteDJ {
  id: string;
  stageName: string;
  profileImageUrl?: string;
  musicGenres: string[];
  slug?: string;
  handle?: string;
}

interface FollowedOrganizer {
  id: string;
  name: string;
  logoUrl?: string;
  slug?: string;
  musicGenres: string[];
  city?: string;
}

/* ── Lignes brutes renvoyées par Supabase ──
   Le fetch tire ses tables via des ternaires (`ids.length ? requête : vide`), ce
   qui casse l'inférence de types de supabase-js. On déclare donc la forme des
   lignes qu'on lit vraiment, plutôt que de tout passer en `any`. */
interface VenueRow { id: string; name: string; city: string | null; logo_url: string | null; cover_url: string | null; music_genre: string | null }
interface AffVenueRow { id: string; name: string; city: string | null; cover_image_url: string | null; slug: string }
interface EventRow { id: string; title: string; start_at: string; end_at: string | null; poster_url: string | null; venue_id: string | null; partner_venue_id: string | null; organizer_user_id: string | null; music_genres: string[] | null }
interface AffEventRow { id: string; name: string; event_date: string; start_time: string | null; flyer_url: string | null; slug: string; genres: string[] | null; affiliate_venues: { name: string } | null }
interface DrinkRow { id: string; name: string; price: number; img_url: string; venue_id: string; collection: string }
interface DjRow { id: string; stage_name: string | null; first_name: string | null; last_name: string | null; profile_image_url: string | null; music_genres: string[] | null; slug: string | null; handle: string | null }
interface HostVenueRow { id: string; name: string }
interface HostOrgRow { user_id: string; display_name: string }
interface FollowerRow { organizer_user_id: string }
interface OrgProfileRow { user_id: string; display_name: string; avatar_url: string | null; slug: string | null; city: string | null }
interface ClubEventRow { venue_id: string | null; partner_venue_id: string | null }
interface OrgEventRow { organizer_user_id: string | null }
interface FavCountRow { target_id: string; total_count: number }

/* Où mène le CTA « découvrir » selon le filtre actif. Les organisateurs se
   trouvent depuis la page clubs (cf. le wording de discoverClubsDesc) — il n'y a
   pas de route /organizers. */
const DISCOVER: Record<Filter, { path: string; titleKey: string; descKey: string }> = {
  all:        { path: '/',             titleKey: 'favorites.discoverAllTitle',    descKey: 'favorites.discoverAllDesc' },
  clubs:      { path: '/clubs',        titleKey: 'favorites.discoverClubsTitle',  descKey: 'favorites.discoverClubsDesc' },
  organizers: { path: '/clubs',        titleKey: 'favorites.discoverClubsTitle',  descKey: 'favorites.discoverClubsDesc' },
  events:     { path: '/events',       titleKey: 'favorites.discoverEventsTitle', descKey: 'favorites.discoverEventsDesc' },
  djs:        { path: '/djs',          titleKey: 'favorites.discoverDJsTitle',    descKey: 'favorites.discoverDJsDesc' },
  drinks:     { path: '/order-drinks', titleKey: 'favorites.discoverDrinksTitle', descKey: 'favorites.discoverDrinksDesc' },
};

/* État vide propre à chaque filtre. */
const FILTER_EMPTY: Record<Exclude<Filter, 'all'>, { icon: React.ElementType; titleKey: string; descKey: string }> = {
  clubs:      { icon: MapPin,   titleKey: 'subscribe.emptyClubs',      descKey: 'subscribe.emptyClubsDesc' },
  organizers: { icon: Users,    titleKey: 'subscribe.emptyOrganizers', descKey: 'subscribe.emptyOrganizersDesc' },
  events:     { icon: Calendar, titleKey: 'favorites.noEvents',        descKey: 'favorites.noEventsDesc' },
  djs:        { icon: Music,    titleKey: 'subscribe.emptyDJs',        descKey: 'subscribe.emptyDJsDesc' },
  drinks:     { icon: Wine,     titleKey: 'favorites.noDrinks',        descKey: 'favorites.noDrinksDesc' },
};

/* ── Empty state ── */
function EmptyState({ icon: Icon, title, description }: { icon: React.ElementType; title: string; description: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 24px', textAlign: 'center' }}>
      <div style={{
        width: 72,
        height: 72,
        borderRadius: 999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 20,
        background: D.surface2,
        border: `1px solid ${D.lineStrong}`,
      }}>
        <Icon size={32} strokeWidth={1.5} color={D.faint} />
      </div>
      <h3 style={{ margin: '0 0 8px', fontFamily: D.display, fontSize: 18, fontWeight: 700, letterSpacing: '-.01em' }}>{title}</h3>
      <p style={{ margin: 0, fontFamily: D.mono, fontSize: 12.5, color: D.muted, maxWidth: 250, lineHeight: 1.6 }}>
        {description}
      </p>
    </div>
  );
}

/* ── Discover CTA — fills the sparse list with a clear next action ── */
function DiscoverCTA({ title, desc, onClick }: { title: string; desc: string; onClick: () => void }) {
  return (
    <div style={{ padding: '0 20px' }}>
      <button
        onClick={onClick}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '15px 16px',
          cursor: 'pointer',
          textAlign: 'left',
          color: 'inherit',
          background: `linear-gradient(150deg, rgba(232,25,44,.08), ${D.surface})`,
          border: '1px solid rgba(232,25,44,.22)',
          borderRadius: 18,
          boxShadow: '0 14px 30px -22px rgba(0,0,0,.9)',
        }}
      >
        <div style={{
          width: 46,
          height: 46,
          flexShrink: 0,
          borderRadius: 13,
          display: 'grid',
          placeItems: 'center',
          background: D.redSoft,
          border: '1px solid rgba(232,25,44,.3)',
        }}>
          <Compass size={22} strokeWidth={2} color={D.red} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: D.display, fontSize: 15, fontWeight: 700, letterSpacing: '-.01em', lineHeight: 1.2, marginBottom: 3 }}>
            {title}
          </div>
          <div style={{ fontFamily: D.mono, fontSize: 11.5, color: D.muted, lineHeight: 1.45 }}>
            {desc}
          </div>
        </div>
        <div style={{
          width: 32,
          height: 32,
          flexShrink: 0,
          borderRadius: 999,
          display: 'grid',
          placeItems: 'center',
          background: D.red,
          boxShadow: '0 8px 18px -8px rgba(232,25,44,.7)',
        }}>
          <ChevronRight size={18} strokeWidth={2.4} color="#fff" />
        </div>
      </button>
    </div>
  );
}

/* ── Skeleton ──
   Un spinner ne dit rien : il tourne au centre d'un écran noir et l'utilisateur
   attend sans savoir ce qui arrive. Le skeleton dessine déjà la mosaïque, donc la
   page a sa forme finale avant que les données arrivent et le remplissage ne fait
   pas sauter le layout. `count` suit le nombre de favoris déjà connu du contexte :
   on affiche exactement autant d'ardoises que de cartes à venir. */
function FavoritesSkeleton({ count, view }: { count: number; view: 'grid' | 'list' }) {
  const n = Math.min(Math.max(count, 2), 6);

  if (view === 'grid') {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14, padding: '0 20px' }}>
        {Array.from({ length: n }).map((_, i) => (
          <Shimmer key={i} style={{ width: '100%', aspectRatio: '1 / 1', borderRadius: 18 }} />
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '0 20px' }}>
      {Array.from({ length: n }).map((_, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '12px 13px',
            background: `linear-gradient(150deg, ${D.surface2}, ${D.surface})`,
            border: `1px solid ${D.line}`,
            borderRadius: 16,
          }}
        >
          <Shimmer width={56} height={56} style={{ flex: 'none', borderRadius: 13 }} />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <SkeletonLine width="55%" height={16} />
            <SkeletonLine width="35%" height={12} />
          </div>
          <SkeletonCircle size={22} />
        </div>
      ))}
    </div>
  );
}

/* ════════════════════════════════════════
   MAIN PAGE
   ════════════════════════════════════════ */
export default function Favorites() {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const { favorites, loading: favLoading } = useFavorites();

  // Un seul écran, une seule mosaïque. La distinction favori vs abonnement vit
  // dans les cartes (cœur pour soirées/boissons, cloche « abonné » pour
  // clubs/orgas/DJs) et dans le wording des compteurs — pas dans le layout.
  const [activeFilter, setActiveFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'grid' | 'list'>(() => {
    if (typeof window === 'undefined') return 'grid';
    return localStorage.getItem('yuno.favorites.view') === 'list' ? 'list' : 'grid';
  });

  const [venues, setVenues] = useState<FavoriteVenue[]>([]);
  const [events, setEvents] = useState<FavoriteEvent[]>([]);
  const [drinks, setDrinks] = useState<FavoriteDrink[]>([]);
  const [djs, setDJs] = useState<FavoriteDJ[]>([]);
  const [followedOrganizers, setFollowedOrganizers] = useState<FollowedOrganizer[]>([]);
  // Upcoming-events count per club id / organizer user id (keys never collide — both UUIDs).
  const [upcomingByEntity, setUpcomingByEntity] = useState<Record<string, number>>({});
  const [djFollowers, setDjFollowers] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const locale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  const clubFavoriteCount = favorites.filter(f => f.favoriteType === 'club' || f.favoriteType === 'affiliate_venue').length;
  const eventFavoriteCount = favorites.filter(f => f.favoriteType === 'event' || f.favoriteType === 'affiliate_event').length;
  const drinkFavoriteCount = favorites.filter(f => f.favoriteType === 'drink').length;
  const djFavoriteCount = favorites.filter(f => f.favoriteType === 'dj').length;

  const totalCount = clubFavoriteCount + eventFavoriteCount + drinkFavoriteCount + djFavoriteCount + followedOrganizers.length;

  useEffect(() => {
    localStorage.setItem('yuno.favorites.view', view);
  }, [view]);

  useEffect(() => {
    if (favLoading) return;

    // `favorites` change à chaque cœur tapé : une réponse d'un fetch précédent
    // pourrait revenir APRÈS celle du fetch courant et réécrire un état périmé.
    let cancelled = false;

    const fetchFavoriteData = async () => {
      setLoading(true);

      const idsOf = (type: string, key: keyof (typeof favorites)[number]) =>
        favorites.filter(f => f.favoriteType === type).map(f => f[key]).filter(Boolean) as string[];

      const clubIds0 = idsOf('club', 'venueId');
      const affVenueIds = idsOf('affiliate_venue', 'affiliateVenueId');
      const eventIds = idsOf('event', 'eventId');
      const affEventIds = idsOf('affiliate_event', 'affiliateEventId');
      const drinkIds = idsOf('drink', 'drinkId');
      const djIds = idsOf('dj', 'djId');

      // `.in('id', [])` est un aller-retour réseau pour rien : on court-circuite
      // les listes vides côté client.
      const none = <T,>() => Promise.resolve({ data: [] as T[], error: null });

      try {
        /* ── VAGUE 1 — tout ce qui ne dépend que des favoris déjà en mémoire.
              Avant : venues → events → hosts → drinks → djs → user → ... en
              file indienne. Chaque requête attendait la précédente sans en avoir
              besoin, soit ~10 allers-retours empilés. Ici, un seul. ── */
        const [
          venueRes, affVenueRes, eventRes, affEventRes, drinkRes, djRes, djCountRes, userRes,
        ] = await Promise.all([
          clubIds0.length ? supabase.from('venues').select('id, name, city, logo_url, cover_url, music_genre').in('id', clubIds0) : none<VenueRow>(),
          affVenueIds.length ? supabase.from('affiliate_venues').select('id, name, city, cover_image_url, slug').in('id', affVenueIds) : none<AffVenueRow>(),
          eventIds.length ? supabase.from('events').select('id, title, start_at, end_at, poster_url, venue_id, partner_venue_id, organizer_user_id, music_genres').in('id', eventIds) : none<EventRow>(),
          affEventIds.length ? supabase.from('affiliate_events').select('id, name, event_date, start_time, flyer_url, slug, genres, affiliate_venues(name)').in('id', affEventIds) : none<AffEventRow>(),
          drinkIds.length ? supabase.from('drinks').select('id, name, price, img_url, venue_id, collection').in('id', drinkIds) : none<DrinkRow>(),
          // djs_public (vue definer, anon-safe) expose le handle propre -> lien /dj/<handle>.
          djIds.length ? supabase.from('djs_public').select('id, stage_name, first_name, last_name, profile_image_url, music_genres, slug, handle').in('id', djIds) : none<DjRow>(),
          // Compteurs d'abonnés DJ. Le RPC renvoie TOUTE la table (pas de filtre
          // par ids côté serveur) — même appel que le rail DJ d'Explore, donc
          // réponse déjà en cache HTTP la plupart du temps. On ne le tire que si
          // l'utilisateur suit au moins un DJ.
          djIds.length ? supabase.rpc('get_public_favorite_counts', { _favorite_type: 'dj' }) : none<FavCountRow>(),
          supabase.auth.getUser(),
        ]);
        if (cancelled) return;
        if (eventRes.error) throw eventRes.error;

        const regularVenues: FavoriteVenue[] = ((venueRes.data ?? []) as VenueRow[]).map((v) => ({
          id: v.id, name: v.name, city: v.city || '',
          logoUrl: v.logo_url || undefined, coverUrl: v.cover_url || undefined, isAffiliate: false,
          musicGenre: v.music_genre || undefined,
        }));
        const affiliateVenues: FavoriteVenue[] = ((affVenueRes.data ?? []) as AffVenueRow[]).map((v) => ({
          id: v.id, name: v.name, city: v.city || '',
          coverUrl: v.cover_image_url || undefined, isAffiliate: true, slug: v.slug,
        }));
        setVenues([...regularVenues, ...affiliateVenues]);

        setDrinks(((drinkRes.data ?? []) as DrinkRow[]).map((d) => ({
          id: d.id, name: d.name, price: Number(d.price),
          imgUrl: d.img_url, venueId: d.venue_id, venueName: undefined, collection: d.collection,
        })));

        setDJs(((djRes.data ?? []) as DjRow[]).map((d) => ({
          id: d.id,
          stageName: d.stage_name || `${d.first_name} ${d.last_name}`,
          profileImageUrl: d.profile_image_url || undefined,
          musicGenres: d.music_genres || [],
          slug: d.slug || undefined,
          handle: d.handle || undefined,
        })));

        const djCounts: Record<string, number> = {};
        ((djCountRes.data ?? []) as FavCountRow[]).forEach((r) => {
          djCounts[r.target_id] = Number(r.total_count);
        });
        setDjFollowers(djCounts);

        const eventRows = (eventRes.data ?? []) as EventRow[];
        const user = userRes.data?.user ?? null;
        const clubIds = regularVenues.map(v => v.id);
        const nowIso = new Date().toISOString();

        /* ── VAGUE 2 — dépend de la vague 1 (lignes d'events, ids de clubs, user). ── */
        const hostVenueIds = [...new Set(eventRows.flatMap(e => [e.venue_id, e.partner_venue_id]).filter(Boolean))] as string[];
        const hostOrgIds = [...new Set(eventRows.map(e => e.organizer_user_id).filter(Boolean))] as string[];

        const [hostVenuesRes, hostOrgsRes, followedRes, clubEventsRes] = await Promise.all([
          hostVenueIds.length ? supabase.from('venues').select('id, name').in('id', hostVenueIds) : none<HostVenueRow>(),
          hostOrgIds.length ? supabase.from('organizer_profiles').select('user_id, display_name').in('user_id', hostOrgIds) : none<HostOrgRow>(),
          user ? supabase.from('organizer_profile_followers').select('organizer_user_id').eq('user_id', user.id) : none<FollowerRow>(),
          // Soirées à venir par club (compteur des cartes Clubs). Même règle que
          // VenuePage : soirées du club + co-soirées hébergées, actives, pas encore
          // terminées. Les clubs affiliés vivent dans une autre table et restent
          // volontairement sans compteur.
          clubIds.length
            ? supabase.from('events').select('venue_id, partner_venue_id')
                .or(`venue_id.in.(${clubIds.join(',')}),partner_venue_id.in.(${clubIds.join(',')})`)
                .eq('is_active', true).gte('end_at', nowIso)
            : none<ClubEventRow>(),
        ]);
        if (cancelled) return;

        const hostVenueName = new Map(((hostVenuesRes.data ?? []) as HostVenueRow[]).map((v) => [v.id, v.name] as const));
        const hostOrgName = new Map(((hostOrgsRes.data ?? []) as HostOrgRow[]).map((o) => [o.user_id, o.display_name] as const));

        const regularEvents: FavoriteEvent[] = eventRows.map((e) => ({
          id: e.id, title: e.title, startAt: e.start_at, endAt: e.end_at,
          posterUrl: e.poster_url || undefined,
          venueId: e.venue_id, isAffiliate: false,
          venueName: hostVenueName.get(e.venue_id) || hostVenueName.get(e.partner_venue_id) || hostOrgName.get(e.organizer_user_id) || undefined,
          musicGenres: e.music_genres || [],
        }));
        const affiliateEvents: FavoriteEvent[] = ((affEventRes.data ?? []) as AffEventRow[]).map((e) => ({
          id: e.id, title: e.name,
          startAt: `${e.event_date}T${(e.start_time ?? '22:00').slice(0, 5)}:00`,
          posterUrl: e.flyer_url || undefined, venueName: e.affiliate_venues?.name,
          isAffiliate: true, affiliateSlug: e.slug,
          musicGenres: e.genres || [],
        }));
        setEvents([...regularEvents, ...affiliateEvents]);

        const orgUserIds = [...new Set(((followedRes.data ?? []) as FollowerRow[]).map((f) => f.organizer_user_id).filter(Boolean))] as string[];

        /* ── VAGUE 3 — dépend des organisateurs suivis (vague 2). ── */
        const [orgProfilesRes, orgEventsRes] = await Promise.all([
          orgUserIds.length ? supabase.from('organizer_profiles').select('user_id, display_name, avatar_url, slug, city').in('user_id', orgUserIds) : none<OrgProfileRow>(),
          orgUserIds.length
            ? supabase.from('events').select('organizer_user_id')
                .in('organizer_user_id', orgUserIds)
                .eq('visibility', 'public').eq('is_active', true).gte('end_at', nowIso)
            : none<OrgEventRow>(),
        ]);
        if (cancelled) return;

        setFollowedOrganizers(((orgProfilesRes.data ?? []) as OrgProfileRow[]).map((o) => ({
          id: o.user_id, name: o.display_name, logoUrl: o.avatar_url || undefined,
          slug: o.slug || undefined, musicGenres: [],
          city: o.city || undefined,
        })));

        const counts: Record<string, number> = {};
        const clubIdSet = new Set(clubIds);
        ((clubEventsRes.data ?? []) as ClubEventRow[]).forEach((e) => {
          if (e.venue_id && clubIdSet.has(e.venue_id)) counts[e.venue_id] = (counts[e.venue_id] || 0) + 1;
          if (e.partner_venue_id && clubIdSet.has(e.partner_venue_id)) counts[e.partner_venue_id] = (counts[e.partner_venue_id] || 0) + 1;
        });
        ((orgEventsRes.data ?? []) as OrgEventRow[]).forEach((e) => {
          if (e.organizer_user_id) counts[e.organizer_user_id] = (counts[e.organizer_user_id] || 0) + 1;
        });
        setUpcomingByEntity(counts);
      } catch (error) {
        if (!cancelled) console.error('Error fetching favorite data:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchFavoriteData();
    return () => { cancelled = true; };
  }, [favLoading, favorites]);

  const formatEventDate = (startAt: string) => {
    try {
      const d = new Date(startAt);
      if (isNaN(d.getTime())) return startAt.slice(0, 10);
      return formatInTimeZone(d, PARIS_TIMEZONE, 'EEE d MMM', { locale });
    } catch {
      return startAt.slice(0, 10);
    }
  };

  const unfollowOrganizer = async (orgId: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('organizer_profile_followers').delete().eq('organizer_user_id', orgId).eq('user_id', user.id);
    setFollowedOrganizers(prev => prev.filter(o => o.id !== orgId));
  };

  /* ── Aplatissement des cinq familles en un seul flux ── */
  const items: FavItem[] = useMemo(() => {
    const out: FavItem[] = [];

    venues.forEach((v) => {
      const upcoming = upcomingByEntity[v.id] ?? 0;
      out.push({
        key: `club:${v.id}`,
        kind: 'club',
        id: v.id,
        title: v.name,
        imageUrl: v.coverUrl || v.logoUrl,
        footerTag: v.musicGenre,
        // Les clubs affiliés n'ont pas de compteur de soirées (autre table) : on
        // montre la ville plutôt qu'un « aucune soirée » faux.
        meta: v.isAffiliate ? (v.city || undefined) : upcomingNightsLabel(upcoming, t),
        metaTone: !v.isAffiliate && upcoming > 0 ? 'accent' : 'default',
        isAffiliate: v.isAffiliate,
        favType: v.isAffiliate ? 'affiliate_venue' : 'club',
        onOpen: () => (v.isAffiliate ? navigate(`/affiliate-venue/${v.slug}`) : navigate(`/club/${v.id}`)),
        search: [v.name, v.city, v.musicGenre].filter(Boolean).join(' ').toLowerCase(),
      });
    });

    followedOrganizers.forEach((o) => {
      const upcoming = upcomingByEntity[o.id] ?? 0;
      out.push({
        key: `organizer:${o.id}`,
        kind: 'organizer',
        id: o.id,
        title: o.name,
        imageUrl: o.logoUrl,
        meta: upcomingNightsLabel(upcoming, t),
        metaTone: upcoming > 0 ? 'accent' : 'default',
        onOpen: o.slug ? () => navigate(`/o/${o.slug}`) : undefined,
        search: [o.name, o.city].filter(Boolean).join(' ').toLowerCase(),
      });
    });

    events.forEach((e) => {
      const genre = e.musicGenres?.filter(Boolean)[0];
      out.push({
        key: `event:${e.id}`,
        kind: 'event',
        id: e.id,
        title: e.title,
        imageUrl: e.posterUrl,
        meta: [formatEventDate(e.startAt).toUpperCase(), genre].filter(Boolean).join(' · '),
        isAffiliate: e.isAffiliate,
        favType: e.isAffiliate ? 'affiliate_event' : 'event',
        onOpen: () => (e.isAffiliate
          ? navigate(`/affiliate-event/${e.affiliateSlug}`)
          : navigate(`/club/${e.venueId}/event/${e.id}`)),
        search: [e.title, e.venueName, ...(e.musicGenres ?? [])].filter(Boolean).join(' ').toLowerCase(),
      });
    });

    djs.forEach((d) => {
      const followers = djFollowers[d.id] ?? 0;
      out.push({
        key: `dj:${d.id}`,
        kind: 'dj',
        id: d.id,
        title: d.stageName,
        imageUrl: d.profileImageUrl,
        footerTag: d.musicGenres[0],
        meta: followers > 0 ? followersLabel(followers, language, t) : undefined,
        favType: 'dj',
        onOpen: (d.handle || d.slug) ? () => navigate(`/dj/${d.handle || d.slug}`) : undefined,
        search: [d.stageName, ...d.musicGenres].filter(Boolean).join(' ').toLowerCase(),
      });
    });

    drinks.forEach((d) => {
      out.push({
        key: `drink:${d.id}`,
        kind: 'drink',
        id: d.id,
        title: d.name,
        imageUrl: d.imgUrl,
        // Photo produit détourée : centrée et entière, comme sur la carte du club.
        imageFit: 'contain',
        price: priceLabel(d.price),
        favType: 'drink',
        // La carte du club, ouverte sur la catégorie de la boisson : un favori
        // qu'on ne peut pas commander ne sert à rien.
        onOpen: () => navigate(`/club/${d.venueId}/drinks/${d.collection}`),
        search: [d.name, d.venueName, d.collection].filter(Boolean).join(' ').toLowerCase(),
      });
    });

    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venues, followedOrganizers, events, djs, drinks, upcomingByEntity, djFollowers, t, language, navigate]);

  /* Recherche d'abord (elle alimente les compteurs des chips), filtre ensuite. */
  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter(i => i.search.includes(q)) : items;
  }, [items, query]);

  const isLoading = loading || favLoading;

  const counts: Record<Filter, number> = useMemo(() => {
    // Pendant le chargement, les compteurs viennent du contexte (déjà en mémoire,
    // donc pas de 0 qui saute à N quand le fetch atterrit). `items` est encore vide.
    if (isLoading) {
      return {
        all: totalCount,
        clubs: clubFavoriteCount,
        events: eventFavoriteCount,
        djs: djFavoriteCount,
        drinks: drinkFavoriteCount,
        organizers: followedOrganizers.length,
      };
    }
    const c: Record<Filter, number> = { all: searched.length, clubs: 0, events: 0, djs: 0, drinks: 0, organizers: 0 };
    searched.forEach((i) => { c[FILTER_OF_KIND[i.kind]] += 1; });
    return c;
  }, [isLoading, searched, totalCount, clubFavoriteCount, eventFavoriteCount, djFavoriteCount, drinkFavoriteCount, followedOrganizers.length]);

  const visible = useMemo(() => {
    const list = activeFilter === 'all' ? searched : searched.filter(i => FILTER_OF_KIND[i.kind] === activeFilter);
    return [...list].sort((a, b) => shuffleSeed(a.key) - shuffleSeed(b.key));
  }, [searched, activeFilter]);

  // Aucun favori ni abonnement du tout → état vide global unifié à la place de la mosaïque
  const totallyEmpty = !isLoading && totalCount === 0;
  const searching = query.trim().length > 0;
  const discover = DISCOVER[activeFilter];

  return (
    <div style={{ minHeight: '100vh', background: D.bg, paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + var(--live-banner-offset, 0px) + 128px)' }}>
      <FavoritesHeader
        totalCount={totalCount}
        bare={totallyEmpty}
        counts={counts}
        activeFilter={activeFilter}
        onFilter={setActiveFilter}
        query={query}
        onQuery={setQuery}
        view={view}
        onView={setView}
      />

      {/* ── Content ── */}
      <PageFade style={{ maxWidth: 512, margin: '0 auto', padding: '22px 0 0' }}>

        {/* Aucun favori du tout → état vide global unifié */}
        {totallyEmpty && (
          <GlobalEmptyState
            icon={Heart}
            title={t('empty.favorites.title')}
            body={t('empty.favorites.body')}
            ctaLabel={t('empty.favorites.cta')}
            onCta={() => navigate('/')}
          />
        )}

        {!totallyEmpty && isLoading && (
          <FavoritesSkeleton count={totalCount} view={view} />
        )}

        {/* Recherche sans résultat — distinct d'un filtre vide : ici il y a bien
            des favoris, c'est la requête qui ne matche rien. */}
        {!totallyEmpty && !isLoading && visible.length === 0 && searching && (
          <EmptyState
            icon={Sparkles}
            title={t('favorites.searchEmpty')}
            description={t('favorites.searchEmptyDesc').replace('{{query}}', query.trim())}
          />
        )}

        {/* Filtre vide (sans recherche) */}
        {!totallyEmpty && !isLoading && visible.length === 0 && !searching && activeFilter !== 'all' && (
          <EmptyState
            icon={FILTER_EMPTY[activeFilter].icon}
            title={t(FILTER_EMPTY[activeFilter].titleKey)}
            description={t(FILTER_EMPTY[activeFilter].descKey)}
          />
        )}

        {/* ── La mosaïque ── */}
        {!totallyEmpty && !isLoading && visible.length > 0 && (
          view === 'grid' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14, padding: '0 20px' }}>
              {visible.map((item, i) => (
                <FadeInView key={item.key} index={i < 8 ? i : 0}>
                  <FavoritePosterCard item={item} onUnfollow={() => unfollowOrganizer(item.id)} />
                </FadeInView>
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '0 20px' }}>
              {visible.map((item, i) => (
                <FadeInView key={item.key} index={i < 6 ? i : 0}>
                  <FavoriteListRow item={item} onUnfollow={() => unfollowOrganizer(item.id)} />
                </FadeInView>
              ))}
            </div>
          )
        )}

        {/* Découvrir plus — évite l'écran nu quand on ne suit qu'un club ou deux,
            et donne l'action suivante. Masqué pendant une recherche : la réponse
            à « je cherche X » n'est pas « découvre Y ». */}
        {!totallyEmpty && !isLoading && !searching && (
          <div style={{ marginTop: visible.length === 0 ? 8 : 30 }}>
            <DiscoverCTA
              title={t(discover.titleKey)}
              desc={t(discover.descKey)}
              onClick={() => navigate(discover.path)}
            />
          </div>
        )}

      </PageFade>
    </div>
  );
}
