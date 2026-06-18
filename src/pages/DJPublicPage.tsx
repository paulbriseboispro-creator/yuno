import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, BadgeCheck, Calendar, MapPin, Music, Sparkles, Users } from 'lucide-react';
import { SiInstagram, SiTiktok, SiSoundcloud, SiSpotify, SiYoutube } from 'react-icons/si';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { formatInTimeZone } from 'date-fns-tz';
import { fr, es, enUS } from 'date-fns/locale';
import { PARIS_TIMEZONE } from '@/lib/timezone';
import { FavoriteButton } from '@/components/FavoriteButton';
import { BottomNav } from '@/components/BottomNav';

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
}

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
  const [showAllPast, setShowAllPast] = useState(false);

  useEffect(() => {
    if (slug) fetchDJ();
  }, [slug]);

  const fetchFollowersCount = async (id: string) => {
    const { count } = await supabase
      .from('favorites')
      .select('id', { count: 'exact', head: true })
      .eq('favorite_type', 'dj')
      .eq('dj_id', id);
    setFollowersCount(count || 0);
  };

  const fetchDJ = async () => {
    try {
      const { data, error } = await supabase
        .from('djs')
        .select('*')
        .eq('slug', slug)
        .eq('is_active', true)
        .maybeSingle();

      if (error || !data) {
        setLoading(false);
        return;
      }

      setDJ(data as unknown as DJProfile);
      setDjId(data.id);

      const { data: eventDjs } = await supabase
        .from('event_djs')
        .select('event_id')
        .eq('dj_id', data.id);

      const eventIds = (eventDjs || []).map(ed => ed.event_id);

      if (eventIds.length > 0) {
        const { data: events } = await supabase
          .from('events')
          .select('id, title, start_at, end_at, poster_url, venue_id')
          .in('id', eventIds)
          .order('start_at', { ascending: true });

        if (events && events.length > 0) {
          const venueIds = [...new Set(events.map(e => e.venue_id))];
          const { data: venues } = await supabase
            .from('venues')
            .select('id, name, city, logo_url')
            .in('id', venueIds);

          const venueMap = Object.fromEntries(
            (venues || []).map(v => [v.id, { name: v.name, city: v.city, logo_url: v.logo_url }])
          );

          const now = new Date().toISOString();
          const mapped: DJEvent[] = events.map(e => ({
            id: e.id,
            title: e.title,
            start_at: e.start_at,
            end_at: e.end_at,
            poster_url: e.poster_url,
            venue_id: e.venue_id,
            venue_name: venueMap[e.venue_id]?.name || '',
            venue_city: venueMap[e.venue_id]?.city || '',
            venue_logo: venueMap[e.venue_id]?.logo_url || null,
          }));

          const upcoming = mapped.filter(e => e.end_at >= now);
          const past = mapped.filter(e => e.end_at < now).reverse();
          setUpcomingEvents(upcoming);
          setPastEvents(past.slice(0, 10));
          setUpcomingCount(upcoming.length);
          setPastCount(past.length);
        }
      }

      await fetchFollowersCount(data.id);
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
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!dj) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4">
        <Music className="h-16 w-16 text-muted-foreground" />
        <p className="text-muted-foreground">{labels.notFound}</p>
        <Button variant="outline" onClick={() => navigate('/')}>
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

  const visiblePast = showAllPast ? pastEvents : pastEvents.slice(0, 3);

  return (
    <div className="min-h-[100dvh] bg-[#050505] pb-[calc(6rem+env(safe-area-inset-bottom))]">
      {/* Hero cover with ambient glow */}
      <div className="relative">
        <div className="aspect-[16/9] w-full overflow-hidden">
          {dj.cover_image_url ? (
            <img src={dj.cover_image_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-primary/30 via-primary/10 to-transparent" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[#050505] via-[#050505]/60 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-transparent" />
        </div>

        {/* Ambient glow behind avatar */}
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 w-40 h-40 rounded-full bg-primary/20 blur-3xl pointer-events-none" />

        <Button
          variant="ghost"
          size="icon"
          className="absolute top-[calc(1rem+env(safe-area-inset-top))] left-4 bg-black/40 backdrop-blur-sm rounded-full text-white hover:bg-black/60"
          onClick={() => navigate('/')}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>

        {/* Profile photo */}
        <div className="absolute -bottom-14 left-1/2 -translate-x-1/2 z-10">
          <div className="h-28 w-28 rounded-full border-[3px] border-primary/40 overflow-hidden bg-card shadow-[0_0_30px_rgba(220,38,38,0.15)]">
            {dj.profile_image_url ? (
              <img src={dj.profile_image_url} alt={djName} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-primary/20">
                <Music className="h-10 w-10 text-primary" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Header info */}
      <div className="px-4 text-center space-y-3 relative z-10" style={{ paddingTop: '4.5rem' }}>
        <div className="flex items-center justify-center gap-2">
          <h1 className="text-2xl font-bold text-foreground">{djName}</h1>
          {dj.is_verified && <BadgeCheck className="h-5 w-5 text-primary" />}
        </div>

        {locationText && (
          <p className="text-sm text-muted-foreground flex items-center justify-center gap-1">
            <MapPin className="h-3.5 w-3.5" />
            {locationText}
          </p>
        )}

        {/* Stat pills */}
        <div className="flex justify-center gap-3">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.04] backdrop-blur-sm border border-white/[0.08] text-xs">
            <Users className="h-3.5 w-3.5 text-primary" />
            <span className="font-semibold text-foreground">{followersCount}</span>
            <span className="text-muted-foreground">{labels.fans}</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.04] backdrop-blur-sm border border-white/[0.08] text-xs">
            <Calendar className="h-3.5 w-3.5 text-primary" />
            <span className="font-semibold text-foreground">{upcomingCount + pastCount}</span>
            <span className="text-muted-foreground">events</span>
          </div>
        </div>

        <FavoriteButton
          type="dj"
          id={dj.id}
          size="default"
          variant="outline"
          showLabel
          label={t('subscribe.action')}
          followingLabel={t('subscribe.active')}
          className="mx-auto"
          onToggle={() => djId && fetchFollowersCount(djId)}
        />
      </div>

      <div className="mx-auto max-w-lg px-4 mt-6 space-y-6">
        {/* Genre badges */}
        {dj.music_genres && dj.music_genres.length > 0 && (
          <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <div className="flex flex-wrap gap-2 justify-center">
              {dj.music_genres.map((genre, i) => (
                <Badge key={i} className="bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 text-xs uppercase tracking-wider px-3 py-1">
                  <Music className="h-3 w-3 mr-1.5" />
                  {genre}
                </Badge>
              ))}
            </div>
          </motion.section>
        )}

        {/* Social links — premium pills */}
        {socials.length > 0 && (
          <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="flex justify-center gap-3">
            {socials.map(({ url, icon: Icon, label }) => (
              <a
                key={label}
                href={url!}
                target="_blank"
                rel="noopener noreferrer"
                className="h-10 w-10 rounded-full bg-white/[0.04] backdrop-blur-sm border border-white/[0.08] flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary/40 hover:bg-primary/10 transition-all duration-200"
                aria-label={label}
              >
                <Icon className="h-4 w-4" />
              </a>
            ))}
          </motion.section>
        )}

        {/* About — glassmorphic card */}
        {(dj.description || dj.bio) && (
          <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <div className="p-4 rounded-xl bg-white/[0.03] backdrop-blur-sm border border-white/[0.06]">
              <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                {labels.about}
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">{dj.description || dj.bio}</p>
            </div>
          </motion.section>
        )}

        {/* Upcoming events — poster cards */}
        {upcomingEvents.length > 0 && (
          <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 text-primary" />
              {labels.upcomingDates}
            </h2>
            <div className="space-y-3">
              {upcomingEvents.map((event, i) => (
                <PremiumEventCard
                  key={event.id}
                  event={event}
                  locale={locale}
                  index={i}
                  onClick={() => navigate(`/club/${event.venue_id}/event/${event.id}`)}
                />
              ))}
            </div>
          </motion.section>
        )}

        {/* Past events */}
        {pastEvents.length > 0 && (
          <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              {labels.pastEvents}
            </h2>
            <div className="space-y-3 opacity-50">
              {visiblePast.map((event, i) => (
                <PremiumEventCard key={event.id} event={event} locale={locale} index={i} clickable={false} />
              ))}
            </div>
            {pastEvents.length > 3 && !showAllPast && (
              <Button variant="outline" size="sm" className="w-full bg-white/[0.03] border-white/[0.08] hover:bg-white/[0.06]" onClick={() => setShowAllPast(true)}>
                {t('djPublic.showAllPast')}
              </Button>
            )}
          </motion.section>
        )}

        {/* Stats section — glassmorphic */}
        <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center p-4 rounded-xl bg-white/[0.03] backdrop-blur-sm border border-white/[0.06]">
              <p className="text-2xl font-bold text-primary tabular-nums">{upcomingCount}</p>
              <p className="text-[10px] text-muted-foreground mt-1">{labels.upcomingDatesCount}</p>
            </div>
            <div className="text-center p-4 rounded-xl bg-white/[0.03] backdrop-blur-sm border border-white/[0.06]">
              <p className="text-2xl font-bold text-muted-foreground tabular-nums">{pastCount}</p>
              <p className="text-[10px] text-muted-foreground mt-1">{labels.pastDatesCount}</p>
            </div>
            <div className="text-center p-4 rounded-xl bg-white/[0.03] backdrop-blur-sm border border-white/[0.06]">
              <p className="text-2xl font-bold text-foreground tabular-nums">{followersCount}</p>
              <p className="text-[10px] text-muted-foreground mt-1">{labels.followers}</p>
            </div>
          </div>
        </motion.section>
      </div>

      <BottomNav />
    </div>
  );
}

/** Premium event card with poster image */
function PremiumEventCard({ event, locale, index, onClick, clickable = true }: {
  event: DJEvent;
  locale: any;
  index: number;
  onClick?: () => void;
  clickable?: boolean;
}) {
  const day = formatInTimeZone(new Date(event.start_at), PARIS_TIMEZONE, 'd', { locale });
  const month = formatInTimeZone(new Date(event.start_at), PARIS_TIMEZONE, 'MMM', { locale }).toUpperCase();
  const time = formatInTimeZone(new Date(event.start_at), PARIS_TIMEZONE, 'HH:mm', { locale });
  const posterSrc = event.poster_url;

  const content = (
    <div className="flex items-center gap-3 w-full">
      {/* Poster thumbnail */}
      <div className="h-[80px] w-[60px] shrink-0 rounded-lg overflow-hidden bg-white/[0.05]">
        {posterSrc ? (
          <img src={posterSrc} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center">
            <span className="text-lg font-bold leading-none text-primary">{day}</span>
            <span className="text-[9px] font-bold uppercase text-primary/70 mt-0.5">{month}</span>
          </div>
        )}
      </div>

      {/* Event info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate text-foreground">{event.title}</p>
        <div className="flex items-center gap-1.5 mt-1">
          {event.venue_logo && (
            <img src={event.venue_logo} alt="" className="h-4 w-4 rounded-full object-cover shrink-0" />
          )}
          <p className="text-xs text-muted-foreground truncate">
            {event.venue_name}{event.venue_city ? ` · ${event.venue_city}` : ''}
          </p>
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">
          {formatInTimeZone(new Date(event.start_at), PARIS_TIMEZONE, 'EEE d MMM', { locale })} · {time}
        </p>
      </div>

      {clickable && (
        <span className="text-xs text-primary font-medium shrink-0">→</span>
      )}
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
    >
      {clickable ? (
        <button
          onClick={onClick}
          className="w-full flex items-center p-3 rounded-xl bg-white/[0.03] backdrop-blur-sm border border-white/[0.06] hover:border-primary/30 hover:bg-white/[0.05] transition-all duration-200 text-left"
        >
          {content}
        </button>
      ) : (
        <div className="w-full flex items-center p-3 rounded-xl bg-white/[0.03] backdrop-blur-sm border border-white/[0.06] text-left">
          {content}
        </div>
      )}
    </motion.div>
  );
}
