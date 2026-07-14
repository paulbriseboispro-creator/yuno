import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FadeInView } from '@/components/motion';
import { ArrowLeft, BadgeCheck, Calendar, ChevronDown, ChevronUp, MapPin, Music, Share2 } from 'lucide-react';
import { SiInstagram, SiTiktok, SiSoundcloud, SiSpotify, SiYoutube } from 'react-icons/si';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { formatInTimeZone } from 'date-fns-tz';
import { fr, es, enUS } from 'date-fns/locale';
import { PARIS_TIMEZONE } from '@/lib/timezone';
import { FavoriteButton } from '@/components/FavoriteButton';
import { getOptimizedImageUrl } from '@/lib/imageOptimization';
import { shareContent } from '@/lib/share';
import { DJTrackPlayer } from '@/components/dj/DJTrackPlayer';
import { formatCompactCount } from '@/components/formater';
import { toast } from 'sonner';
import { PublicPage } from '@/components/PublicPage';

const COUNTRY_TRANSLATIONS: Record<string, Record<string, string>> = {
  'France': { fr: 'France', es: 'Francia', en: 'France' },
  'Espagne': { fr: 'Espagne', es: 'España', en: 'Spain' },
  'Spain': { fr: 'Espagne', es: 'España', en: 'Spain' },
  'España': { fr: 'Espagne', es: 'España', en: 'Spain' },
  'Allemagne': { fr: 'Allemagne', es: 'Alemania', en: 'Germany' },
  'Germany': { fr: 'Allemagne', es: 'Alemania', en: 'Germany' },
  'Italie': { fr: 'Italie', es: 'Italia', en: 'Italy' },
  'Italy': { fr: 'Italie', es: 'Italia', en: 'Italy' },
  'Royaume-Uni': { fr: 'Royaume-Uni', es: 'Reino Unido', en: 'United Kingdom' },
  'United Kingdom': { fr: 'Royaume-Uni', es: 'Reino Unido', en: 'United Kingdom' },
  'Belgique': { fr: 'Belgique', es: 'Bélgica', en: 'Belgium' },
  'Belgium': { fr: 'Belgique', es: 'Bélgica', en: 'Belgium' },
  'Suisse': { fr: 'Suisse', es: 'Suiza', en: 'Switzerland' },
  'Switzerland': { fr: 'Suisse', es: 'Suiza', en: 'Switzerland' },
  'Pays-Bas': { fr: 'Pays-Bas', es: 'Países Bajos', en: 'Netherlands' },
  'Netherlands': { fr: 'Pays-Bas', es: 'Países Bajos', en: 'Netherlands' },
  'Portugal': { fr: 'Portugal', es: 'Portugal', en: 'Portugal' },
  'Maroc': { fr: 'Maroc', es: 'Marruecos', en: 'Morocco' },
  'Morocco': { fr: 'Maroc', es: 'Marruecos', en: 'Morocco' },
  'États-Unis': { fr: 'États-Unis', es: 'Estados Unidos', en: 'United States' },
  'United States': { fr: 'États-Unis', es: 'Estados Unidos', en: 'United States' },
};

const CITY_TRANSLATIONS: Record<string, Record<string, string>> = {
  'Londres': { fr: 'Londres', es: 'Londres', en: 'London' },
  'London': { fr: 'Londres', es: 'Londres', en: 'London' },
  'Bruxelles': { fr: 'Bruxelles', es: 'Bruselas', en: 'Brussels' },
  'Brussels': { fr: 'Bruxelles', es: 'Bruselas', en: 'Brussels' },
  'Genève': { fr: 'Genève', es: 'Ginebra', en: 'Geneva' },
  'Geneva': { fr: 'Genève', es: 'Ginebra', en: 'Geneva' },
  'Munich': { fr: 'Munich', es: 'Múnich', en: 'Munich' },
  'Lisbonne': { fr: 'Lisbonne', es: 'Lisboa', en: 'Lisbon' },
  'Lisbon': { fr: 'Lisbonne', es: 'Lisboa', en: 'Lisbon' },
};

function translateLocation(name: string, lang: string): string {
  const langKey = lang === 'fr' ? 'fr' : lang === 'es' ? 'es' : 'en';
  return COUNTRY_TRANSLATIONS[name]?.[langKey] || CITY_TRANSLATIONS[name]?.[langKey] || name;
}

interface DJProfile {
  id: string;
  first_name: string;
  last_name: string;
  stage_name: string | null;
  profile_image_url: string | null;
  cover_image_url: string | null;
  music_genres: string[];
  bio: string | null;
  description: string | null;
  instagram_url: string | null;
  tiktok_url: string | null;
  soundcloud_url: string | null;
  spotify_url: string | null;
  youtube_url: string | null;
  city: string | null;
  country: string | null;
  is_verified: boolean;
  slug: string;
  featured_track_url: string | null;
  featured_track_title: string | null;
}

interface DJVenueChip { id: string; name: string; city: string | null; logo_url: string | null; followers: number }
interface DJOrgChip { slug: string | null; display_name: string; avatar_url: string | null; followers: number }
interface DJExtras { photos: { url: string }[]; venues: DJVenueChip[]; organizers: DJOrgChip[] }

interface DJEvent {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  poster_url: string | null;
  venue_id: string;
  venue_name: string;
  venue_city: string;
  venue_logo: string | null;
}

export default function DJPublicPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  // Smart back: if the visitor came from within the app (e.g. an event line-up),
  // return to that exact page. React Router stamps history.state.idx (0 on the first
  // in-app entry); idx > 0 means there's a previous page to pop. Only a direct visit
  // or external link (idx 0/undefined) falls back to the home page.
  const handleBack = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx;
    if (typeof idx === 'number' && idx > 0) navigate(-1);
    else navigate('/');
  };
  const { language, t } = useLanguage();
  const locale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  const [dj, setDJ] = useState<DJProfile | null>(null);
  const [upcomingEvents, setUpcomingEvents] = useState<DJEvent[]>([]);
  const [pastEvents, setPastEvents] = useState<DJEvent[]>([]);
  const [followersCount, setFollowersCount] = useState(0);
  const [upcomingCount, setUpcomingCount] = useState(0);
  const [pastCount, setPastCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [djId, setDjId] = useState<string | null>(null);
  const [bioExpanded, setBioExpanded] = useState(false);
  const [extras, setExtras] = useState<DJExtras>({ photos: [], venues: [], organizers: [] });

  useEffect(() => {
    if (slug) fetchDJ();
  }, [slug]);

  const handleShare = async () => {
    const url = window.location.href;
    const title = dj?.stage_name || (dj ? `${dj.first_name} ${dj.last_name}` : '');
    const outcome = await shareContent({ title, url });
    if (outcome === 'copied') toast.success(t('share.copied') || 'Lien copié');
  };

  // Followers are counted across ALL of the person's profiles (server-side RPC),
  // so the count matches the aggregated public page, not a single venue row.
  const loadFollowers = async () => {
    if (!slug) return;
    const rpc = supabase.rpc.bind(supabase) as unknown as (
      fn: 'get_dj_public_profile', args: { p_slug: string },
    ) => Promise<{ data: { followers_count?: number } | null; error: unknown }>;
    const { data } = await rpc('get_dj_public_profile', { p_slug: slug });
    if (data) setFollowersCount(Number(data.followers_count) || 0);
  };

  const fetchDJ = async () => {
    try {
      // Resolve the slug OR the clean handle to the PERSON, and aggregate events across
      // all their venue + organizer profiles (server-side RPCs). One DJ = one page.
      const rpcProfile = supabase.rpc.bind(supabase) as unknown as (
        fn: 'get_dj_public_profile', args: { p_slug: string },
      ) => Promise<{ data: (DJProfile & { handle?: string; followers_count?: number }) | null; error: unknown }>;
      const rpcEvents = supabase.rpc.bind(supabase) as unknown as (
        fn: 'get_dj_public_events', args: { p_slug: string },
      ) => Promise<{ data: DJEvent[] | null; error: unknown }>;

      const { data: profile } = await rpcProfile('get_dj_public_profile', { p_slug: slug! });
      if (!profile) {
        setLoading(false);
        return;
      }

      setDJ(profile as DJProfile);
      setDjId(profile.id);
      setFollowersCount(Number(profile.followers_count) || 0);

      // Clean the URL: old per-venue slugs (marco-v-cad4) settle on the handle (marco-v).
      if (profile.handle && profile.handle !== slug) {
        navigate(`/dj/${profile.handle}`, { replace: true });
      }

      // Extras (galerie + clubs joués + orgas), un seul appel. Non bloquant pour le reste.
      const rpcExtras = supabase.rpc.bind(supabase) as unknown as (
        fn: 'get_dj_public_extras', args: { p_slug: string },
      ) => Promise<{ data: DJExtras | null; error: unknown }>;
      rpcExtras('get_dj_public_extras', { p_slug: slug! }).then(({ data }) => {
        if (data) setExtras({
          photos: data.photos ?? [],
          venues: data.venues ?? [],
          organizers: data.organizers ?? [],
        });
      });

      const { data: events } = await rpcEvents('get_dj_public_events', { p_slug: slug! });
      const now = new Date().toISOString();
      const mapped: DJEvent[] = (events || []).map((e) => ({
        id: e.id,
        title: e.title,
        start_at: e.start_at,
        end_at: e.end_at,
        poster_url: e.poster_url,
        venue_id: e.venue_id,
        venue_name: e.venue_name || '',
        venue_city: e.venue_city || '',
        venue_logo: null,
      }));
      const upcoming = mapped.filter(e => e.end_at >= now);
      const past = mapped.filter(e => e.end_at < now).reverse();
      setUpcomingEvents(upcoming);
      setPastEvents(past.slice(0, 10));
      setUpcomingCount(upcoming.length);
      setPastCount(past.length);
    } catch (err) {
      console.error('Error fetching DJ:', err);
    } finally {
      setLoading(false);
    }
  };

  const labels = {
    upcomingDates: t('djPublic.upcomingDates'),
    pastEvents: t('djPublic.pastEvents'),
    about: t('djPublic.about'),
    followers: t('djPublic.followers'),
    upcomingDatesCount: t('djPublic.upcomingDatesCount'),
    pastDatesCount: t('djPublic.pastDatesCount'),
    fans: t('djPublic.fans'),
    notFound: t('djPublic.notFound'),
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#0A0A0A' }}>
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!dj) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4" style={{ background: '#0A0A0A' }}>
        <Music className="h-16 w-16 text-muted-foreground/40" />
        <p className="text-muted-foreground">{labels.notFound}</p>
        <Button variant="outline" onClick={handleBack}>
          <ArrowLeft className="h-4 w-4 mr-2" /> {t('djPublic.back')}
        </Button>
      </div>
    );
  }

  const djName = dj.stage_name || `${dj.first_name} ${dj.last_name}`;
  const locationText = dj.city
    ? `${translateLocation(dj.city, language)}${dj.country ? `, ${translateLocation(dj.country, language)}` : ''}`
    : null;

  const socials = [
    { url: dj.instagram_url, icon: SiInstagram, label: 'Instagram' },
    { url: dj.tiktok_url, icon: SiTiktok, label: 'TikTok' },
    { url: dj.soundcloud_url, icon: SiSoundcloud, label: 'SoundCloud' },
    { url: dj.spotify_url, icon: SiSpotify, label: 'Spotify' },
    { url: dj.youtube_url, icon: SiYoutube, label: 'YouTube' },
  ].filter(s => s.url);

  const visiblePast = pastEvents.slice(0, 3);
  const heroSrc = dj.cover_image_url || dj.profile_image_url;
  const aboutText = dj.description || dj.bio;
  // Dedupe genres case-insensitively — stored data can hold variants like
  // "house" + "House", which .genre-tag uppercases into a visible duplicate.
  const genres = Array.from(
    new Map((dj.music_genres ?? []).map((g) => [g.trim().toLowerCase(), g.trim()])).values()
  ).filter(Boolean);

  return (
    <div className="relative min-h-[100dvh] flex flex-col" style={{ background: '#0A0A0A' }}>
      <PublicPage variant="immersive">
      <main className="flex-1 pb-28">
        {/* ===== HERO — full-bleed cinematic (Yuno DA publique) ===== */}
        <div className="relative overflow-hidden" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px))' }}>
          {/* Floating back */}
          <div className="absolute left-5 z-20" style={{ top: 'calc(env(safe-area-inset-top, 0px) + 1rem)' }}>
            <button
              onClick={handleBack}
              aria-label={t('djPublic.back')}
              className="flex items-center justify-center h-9 w-9 hover:opacity-80 transition-opacity"
              style={{ borderRadius: '2px', background: 'rgba(0,0,0,0.40)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', border: 'none' }}
            >
              <ArrowLeft className="h-4 w-4 text-white" />
            </button>
          </div>
          {/* Floating share */}
          <div className="absolute right-5 z-20" style={{ top: 'calc(env(safe-area-inset-top, 0px) + 1rem)' }}>
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
            {heroSrc ? (
              <motion.img
                initial={{ scale: 1.06, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.7, ease: 'easeOut' }}
                src={getOptimizedImageUrl(heroSrc, { width: 1200, quality: 82 })}
                alt={djName}
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

        {/* ===== IDENTITY BLOCK ===== */}
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="px-5 pt-5">
          {/* Prominent profile photo — overlaps the hero, mirrors the enlarged event line-up avatar */}
          {dj.profile_image_url && (
            <div
              className="overflow-hidden"
              style={{ width: 92, height: 92, borderRadius: 14, border: '3px solid #0A0A0A', boxShadow: '0 0 0 1px rgba(255,255,255,0.12)', background: '#191919', marginTop: -62, marginBottom: 14, position: 'relative', zIndex: 10 }}
            >
              <img
                src={dj.profile_image_url}
                alt={djName}
                className="w-full h-full object-cover object-top"
                onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none'; }}
              />
            </div>
          )}
          {/* Kicker — DJ */}
          <div className="flex items-center gap-2 mb-2">
            <p className="font-mono uppercase" style={{ fontSize: '10px', color: '#5A5A5E', letterSpacing: '0.16em' }}>
              DJ
            </p>
          </div>

          <div className="flex items-start gap-2" style={{ marginBottom: 16 }}>
            <h1
              className="font-display font-bold"
              style={{ fontSize: 'clamp(34px, 10vw, 54px)', color: '#FFFFFF', textTransform: 'uppercase', letterSpacing: '-0.025em', lineHeight: 0.9 }}
            >
              {djName}
            </h1>
            {dj.is_verified && <BadgeCheck className="h-5 w-5 text-primary flex-shrink-0" style={{ marginTop: 4 }} />}
          </div>

          {locationText && (
            <p className="font-mono uppercase flex items-center gap-1.5" style={{ fontSize: '11px', color: '#9A9A9A', letterSpacing: '0.06em', marginBottom: 16 }}>
              <MapPin className="h-3.5 w-3.5" />
              {locationText}
            </p>
          )}

          {/* Subscribe + count */}
          <div className="flex items-center gap-3">
            <FavoriteButton
              type="dj"
              id={dj.id}
              size="sm"
              variant="default"
              showLabel
              label={t('subscribe.action')}
              followingLabel={t('subscribe.active')}
              className="h-8 px-3 rounded-[10px] text-xs font-medium"
              onToggle={loadFollowers}
            />
            {followersCount > 0 && (
              <span style={{ fontSize: '13px', color: '#9A9A9A' }}>
                {followersCount.toLocaleString()} {followersCount === 1
                  ? t('djPublic.followerSingular')
                  : labels.fans}
              </span>
            )}
          </div>

        </motion.div>

        {/* ===== GENRES — .genre-tag ===== */}
        {genres.length > 0 && (
          <div className="px-5 pt-5">
            <div className="flex flex-wrap gap-2">
              {genres.map((genre) => (
                <span key={genre.toLowerCase()} className="genre-tag">{genre}</span>
              ))}
            </div>
          </div>
        )}

        {/* ===== SOCIALS — editorial bordered buttons ===== */}
        {socials.length > 0 && (
          <div className="px-5 pt-6">
            <p className="section-label-ruled mb-4">{t('djPublic.socials')}</p>
            <div className="flex flex-wrap gap-2.5">
              {socials.map(({ url, icon: Icon, label }) => (
                <a
                  key={label}
                  href={url!}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  className="flex items-center justify-center h-11 w-11 rounded-[4px] border border-white/10 text-[#9A9A9A] transition-colors hover:text-[#E8192C] hover:border-[#E8192C]/40"
                >
                  <Icon className="h-4 w-4" />
                </a>
              ))}
            </div>
          </div>
        )}

        {/* ===== DÉCOUVRIR — titre vedette, lecteur audio natif (sous les réseaux) ===== */}
        {dj.featured_track_url && (
          <DJTrackPlayer
            url={dj.featured_track_url}
            title={dj.featured_track_title}
            label={t('djPublic.listen')}
          />
        )}

        {/* ===== ABOUT ===== */}
        {aboutText && (
          <div className="px-5 pt-7">
            <p className="section-label-ruled mb-4">{labels.about}</p>
            <div className="relative">
              <p
                className={!bioExpanded ? 'line-clamp-4' : ''}
                style={{ fontSize: '14px', color: '#9A9A9A', lineHeight: 1.65, letterSpacing: '0.01em' }}
              >
                {aboutText}
              </p>
              {!bioExpanded && aboutText.length > 220 && (
                <div
                  className="absolute bottom-0 left-0 right-0 h-10 pointer-events-none"
                  style={{ background: 'linear-gradient(to top, #0A0A0A, transparent)' }}
                />
              )}
            </div>
            {aboutText.length > 220 && (
              <button
                onClick={() => setBioExpanded(!bioExpanded)}
                className="flex items-center gap-1 mt-2 font-mono uppercase"
                style={{ fontSize: '11px', color: '#5A5A5E', letterSpacing: '0.06em' }}
              >
                {bioExpanded ? t('event.seeLess') : t('event.seeMore')}
                {bioExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
            )}
          </div>
        )}

        {/* ===== STATS — ruled row ===== */}
        <div
          className="flex items-start px-5 pt-6 pb-5 mt-7"
          style={{ borderTop: '1px solid rgba(255,255,255,0.06)', borderBottom: '1px solid rgba(255,255,255,0.06)', gap: 0 }}
        >
          <div className="flex flex-col flex-1 min-w-0" style={{ paddingRight: 12 }}>
            <span className="font-mono" style={{ fontSize: '9px', color: '#5A5A5E', letterSpacing: '0.14em', marginBottom: 4 }}>{labels.upcomingDatesCount.toUpperCase()}</span>
            <span className="font-display font-bold tabular-nums" style={{ fontSize: '20px', color: '#FFFFFF', letterSpacing: '-0.01em', lineHeight: 1.1 }}>{upcomingCount}</span>
          </div>
          <div className="flex flex-col flex-1 min-w-0" style={{ paddingRight: 12, borderLeft: '1px solid rgba(255,255,255,0.07)', paddingLeft: 12 }}>
            <span className="font-mono" style={{ fontSize: '9px', color: '#5A5A5E', letterSpacing: '0.14em', marginBottom: 4 }}>{labels.pastDatesCount.toUpperCase()}</span>
            <span className="font-display font-bold tabular-nums" style={{ fontSize: '20px', color: '#FFFFFF', letterSpacing: '-0.01em', lineHeight: 1.1 }}>{pastCount}</span>
          </div>
          <div className="flex flex-col flex-1 min-w-0" style={{ borderLeft: '1px solid rgba(255,255,255,0.07)', paddingLeft: 12 }}>
            <span className="font-mono" style={{ fontSize: '9px', color: '#5A5A5E', letterSpacing: '0.14em', marginBottom: 4 }}>{labels.followers.toUpperCase()}</span>
            <span className="font-display font-bold tabular-nums" style={{ fontSize: '20px', color: '#FFFFFF', letterSpacing: '-0.01em', lineHeight: 1.1 }}>{followersCount}</span>
          </div>
        </div>

        {/* ===== UPCOMING EVENTS — single-column poster cards ===== */}
        {upcomingEvents.length > 0 && (
          <div className="mx-auto max-w-xl pt-8">
            <div className="flex items-center justify-between px-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px' }}>
              <p className="font-mono uppercase" style={{ fontSize: '10px', letterSpacing: '0.14em', color: '#5A5A5E' }}>
                {labels.upcomingDates}
              </p>
              <span className="font-mono" style={{ fontSize: '10px', color: '#3A3A3E', letterSpacing: '0.08em' }}>
                {upcomingEvents.length}
              </span>
            </div>

            <div className="flex flex-col gap-6 px-5 pt-4 pb-4">
              {upcomingEvents.map((event, index) => (
                <motion.div
                  key={event.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.06 }}
                  className="cursor-pointer group"
                  onClick={() => navigate(`/club/${event.venue_id}/event/${event.id}`)}
                >
                  <div className="relative aspect-square overflow-hidden" style={{ borderRadius: 10, background: 'rgba(255,255,255,0.05)' }}>
                    {event.poster_url ? (
                      <img
                        src={getOptimizedImageUrl(event.poster_url, { width: 400, height: 400, quality: 75 })}
                        alt={event.title}
                        className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'linear-gradient(160deg, #1a0f12 0%, #3a1020 100%)' }}>
                        <Calendar className="h-12 w-12" style={{ color: '#5A5A5E' }} />
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
                    <p className="font-mono uppercase" style={{ fontSize: '10px', letterSpacing: '0.08em', color: '#9A9A9A' }}>
                      {formatInTimeZone(new Date(event.start_at), PARIS_TIMEZONE, 'EEE d MMM', { locale })}
                      {' · '}
                      {formatInTimeZone(new Date(event.start_at), PARIS_TIMEZONE, 'HH:mm', { locale })}
                    </p>
                    <p className="font-display font-bold mt-0.5 line-clamp-2" style={{ fontSize: '15px', color: '#FFFFFF', letterSpacing: '-0.01em', lineHeight: 1.15 }}>
                      {event.title}
                    </p>
                    {(event.venue_name || event.venue_city) && (
                      <div className="flex items-center gap-1.5 mt-1">
                        {event.venue_logo && (
                          <img src={event.venue_logo} alt="" className="h-4 w-4 rounded-full object-cover flex-shrink-0" />
                        )}
                        <span className="font-mono truncate" style={{ fontSize: '11px', color: '#9A9A9A', letterSpacing: '0.04em' }}>
                          {event.venue_name}{event.venue_city ? ` · ${event.venue_city}` : ''}
                        </span>
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {/* ===== PAST EVENTS — thumbnail rows ===== */}
        {pastEvents.length > 0 && (
          <div className="mx-auto max-w-xl pt-10">
            <div className="px-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px' }}>
              <p className="font-mono uppercase" style={{ fontSize: '10px', letterSpacing: '0.14em', color: '#5A5A5E' }}>
                {labels.pastEvents}
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
                      <img src={event.poster_url} alt="" className="w-full h-full object-cover" />
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
            {pastEvents.length > 3 && (
              <div className="px-5 pt-4">
                <button
                  onClick={() => navigate(`/dj/${slug}/past`)}
                  className="w-full flex items-center justify-center font-mono uppercase"
                  style={{ fontSize: '11px', color: '#5A5A5E', letterSpacing: '0.08em', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, padding: '10px 0' }}
                >
                  {t('djPublic.showAllPast')}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ===== CLUBS — classés par abonnés (bas de page) ===== */}
        {extras.venues.length > 0 && (
          <div className="pt-10">
            <p className="section-label-ruled mb-4 px-5">{t('djPublic.clubsPlayed')}</p>
            <div className="flex gap-3 overflow-x-auto pb-1 px-5 scrollbar-hide" style={{ scrollSnapType: 'x mandatory', scrollPaddingLeft: '20px' }}>
              {extras.venues.map((v) => (
                <button
                  key={v.id}
                  onClick={() => navigate(`/club/${v.id}`)}
                  className="flex flex-col items-center gap-2 shrink-0 active:opacity-70 transition-opacity"
                  style={{ width: 96, scrollSnapAlign: 'start' }}
                >
                  <div
                    className="overflow-hidden flex items-center justify-center"
                    style={{ width: 80, height: 80, borderRadius: 14, background: '#191919', border: '1px solid rgba(255,255,255,0.12)' }}
                  >
                    {v.logo_url
                      ? <img src={getOptimizedImageUrl(v.logo_url, { width: 160, height: 160 })} alt={v.name} loading="lazy" className="w-full h-full object-cover" />
                      : <span className="font-display font-bold" style={{ fontSize: 24, color: '#5A5A5E' }}>{v.name?.[0]?.toUpperCase() || '?'}</span>}
                  </div>
                  <p className="font-mono text-center leading-tight truncate w-full" style={{ fontSize: '11px', color: '#E5E5E5', letterSpacing: '0.03em' }}>{v.name}</p>
                  {v.followers > 0 && (
                    <p className="font-mono text-center leading-tight" style={{ fontSize: '9px', color: '#7A7A7E' }}>
                      {formatCompactCount(v.followers, language)}
                    </p>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ===== COLLECTIFS / ORGAS — classés par abonnés (bas de page) ===== */}
        {extras.organizers.length > 0 && (
          <div className="pt-7">
            <p className="section-label-ruled mb-4 px-5">{t('djPublic.organizersPlayed')}</p>
            <div className="flex gap-3 overflow-x-auto pb-1 px-5 scrollbar-hide" style={{ scrollSnapType: 'x mandatory', scrollPaddingLeft: '20px' }}>
              {extras.organizers.map((o, i) => (
                <button
                  key={o.slug || i}
                  onClick={() => o.slug && navigate(`/o/${o.slug}`)}
                  className="flex flex-col items-center gap-2 shrink-0 active:opacity-70 transition-opacity"
                  style={{ width: 96, cursor: o.slug ? 'pointer' : 'default', scrollSnapAlign: 'start' }}
                >
                  <div
                    className="overflow-hidden flex items-center justify-center"
                    style={{ width: 80, height: 80, borderRadius: 14, background: '#191919', border: '1px solid rgba(255,255,255,0.12)' }}
                  >
                    {o.avatar_url
                      ? <img src={getOptimizedImageUrl(o.avatar_url, { width: 160, height: 160 })} alt={o.display_name} loading="lazy" className="w-full h-full object-cover" />
                      : <span className="font-display font-bold" style={{ fontSize: 24, color: '#5A5A5E' }}>{o.display_name?.[0]?.toUpperCase() || '?'}</span>}
                  </div>
                  <p className="font-mono text-center leading-tight truncate w-full" style={{ fontSize: '11px', color: '#E5E5E5', letterSpacing: '0.03em' }}>{o.display_name}</p>
                  {o.followers > 0 && (
                    <p className="font-mono text-center leading-tight" style={{ fontSize: '9px', color: '#7A7A7E' }}>
                      {formatCompactCount(o.followers, language)}
                    </p>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ===== GALERIE — slider scroll-snap (bas de page, sous les orgas) ===== */}
        {extras.photos.length > 0 && (
          <FadeInView className="pt-7">
            <p className="section-label-ruled mb-4 px-5">{t('djPublic.gallery')}</p>
            <div
              className="flex gap-3 overflow-x-auto pb-1 px-5 scrollbar-hide"
              style={{ scrollSnapType: 'x mandatory', scrollPaddingLeft: '20px' }}
            >
              {extras.photos.map((p, i) => (
                <div
                  key={i}
                  className="shrink-0 overflow-hidden"
                  style={{ width: 152, aspectRatio: '3 / 4', borderRadius: 12, background: '#191919', border: '1px solid rgba(255,255,255,0.08)', scrollSnapAlign: 'start' }}
                >
                  <img
                    src={getOptimizedImageUrl(p.url, { width: 320, height: 426, quality: 78 })}
                    alt=""
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                </div>
              ))}
            </div>
          </FadeInView>
        )}

        {/* Footer */}
        <div className="px-5 pt-10 pb-4 text-center">
          <p className="font-mono" style={{ fontSize: '10px', color: '#3A3A3E', letterSpacing: '0.08em' }}>
            © {new Date().getFullYear()} {djName.toUpperCase()} · POWERED BY YUNO
          </p>
        </div>
      </main>
      </PublicPage>

    </div>
  );
}
