import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Share2, MapPin, Globe, ExternalLink,
  ChevronDown, ChevronUp, Bell,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { SUBSCRIPTIONS_ENABLED } from '@/lib/planFeatures';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { BottomNav } from '@/components/BottomNav';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { toast } from 'sonner';
import { useAffiliateVisitorTracking } from '@/hooks/useAffiliateVisitorTracking';
import { useFavorites } from '@/hooks/useFavorites';

// ── Types ────────────────────────────────────────────────────────────────────
type AffiliateVenue = {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  neighborhood: string | null;
  description: string | null;
  cover_image_url: string | null;
  gallery_urls: string[];
  instagram: string | null;
  tiktok: string | null;
  website: string | null;
  external_booking_url: string | null;
  genres: string[];
  min_age: number | null;
  dress_code: string | null;
  address: string | null;
  affiliate_id: string;
};

type UpcomingEvent = {
  id: string;
  name: string;
  slug: string;
  event_date: string;
  start_time: string | null;
  flyer_url: string | null;
  price_from: number | null;
  is_free: boolean;
  is_sold_out: boolean;
  genres: string[];
  external_ticket_url: string | null;
  status: string;
};

type AffiliateProfile = {
  user_id: string | null;
  name: string;
  linktree_slug: string | null;
  avatar_url: string | null;
};

// ── Collapsible description ───────────────────────────────────────────────────
function VenueDescription({ description }: { description: string }) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const isLong = description.length > 180;

  return (
    <div className="px-5 pt-4">
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
          className="flex items-center gap-1 mt-2 cursor-pointer"
          style={{ fontSize: '11px', color: '#5A5A5E', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.06em', textTransform: 'uppercase', background: 'transparent', border: 'none' }}
        >
          {expanded ? t('event.seeLess') : t('event.seeMore')}
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
      )}
    </div>
  );
}

// ── Loading skeleton ──────────────────────────────────────────────────────────
function LoadingSkeleton() {
  return (
    <div className="min-h-screen pb-28" style={{ background: '#0A0A0A' }}>
      <div className="px-4 pt-4">
        <Skeleton className="w-full rounded-none" style={{ aspectRatio: '4/3' }} />
      </div>
      <div className="px-5 pt-5 space-y-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-10 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-7 w-28 rounded-full" />
      </div>
      <div className="px-5 pt-8 space-y-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-44 w-full rounded" />
        <Skeleton className="h-44 w-full rounded" />
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AffiliateVenuePage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { language, t } = useLanguage();
  const { user } = useAuth();
  const [venue, setVenue] = useState<AffiliateVenue | null>(null);
  const [events, setEvents] = useState<UpcomingEvent[]>([]);
  const [affiliate, setAffiliate] = useState<AffiliateProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [photoIndex, setPhotoIndex] = useState(0);
  const carouselRef = useRef<HTMLDivElement>(null);

  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  const isOwner = !!(user?.id && affiliate?.user_id && user.id === affiliate.user_id);
  const { isFavorite, toggleFavorite } = useFavorites();

  useAffiliateVisitorTracking({
    affiliateId: venue?.affiliate_id ?? '',
    affiliateVenueId: venue?.id,
    isOwner,
  });

  useEffect(() => {
    if (slug) fetchVenue();
  }, [slug]);

  const fetchVenue = async () => {
    setLoading(true);
    const { data: v } = await supabase
      .from('affiliate_venues')
      .select('*')
      .eq('slug', slug!)
      .eq('is_active', true)
      .single();

    if (!v) { navigate('/'); return; }
    setVenue({
      ...v,
      gallery_urls: (v.gallery_urls ?? []) as string[],
      genres: (v.genres ?? []) as string[],
    } as unknown as AffiliateVenue);

    const today = new Date().toISOString().split('T')[0];
    const [{ data: evts }, { data: aff }] = await Promise.all([
      supabase
        .from('affiliate_events')
        .select('id, name, slug, event_date, start_time, flyer_url, price_from, is_free, is_sold_out, genres, external_ticket_url, status')
        .eq('affiliate_venue_id', v.id)
        .in('status', ['published', 'featured'])
        .gte('event_date', today)
        .order('event_date', { ascending: true })
        .limit(20),
      supabase
        .from('affiliates')
        .select('user_id, name, linktree_slug, avatar_url')
        .eq('id', v.affiliate_id)
        .single(),
    ]);

    setEvents((evts ?? []) as unknown as UpcomingEvent[]);
    if (aff) setAffiliate(aff as unknown as AffiliateProfile);
    setLoading(false);
  };

  const handleShare = async () => {
    const url = window.location.href;
    const shareData = { title: venue?.name || '', url };
    if (navigator.share) {
      try { await navigator.share(shareData); } catch {}
    } else {
      await navigator.clipboard.writeText(url);
      toast.success(t('share.copied'));
    }
  };

  if (loading) return <LoadingSkeleton />;
  if (!venue) return null;

  // Is there an event tonight?
  const todayStr = new Date().toISOString().split('T')[0];
  const isOpenTonight = events.some(e => e.event_date === todayStr);

  // Stats bar items (non-null)
  const statItems: { label: string; value: string }[] = [
    venue.genres.length > 0 ? { label: t('affiliate.statMusic').toUpperCase(), value: venue.genres[0].toUpperCase() } : null,
    venue.city ? { label: t('affiliate.statArea').toUpperCase(), value: venue.city.toUpperCase() } : null,
    venue.min_age ? { label: t('affiliate.statAge').toUpperCase(), value: `${venue.min_age}+` } : null,
    venue.dress_code ? { label: t('affiliate.statDress').toUpperCase(), value: venue.dress_code.toUpperCase() } : null,
  ].filter(Boolean) as { label: string; value: string }[];

  // Info card rows
  const infoRows: { label: string; href: string; value: string; color?: string }[] = [
    venue.address
      ? { label: t('event.address'), href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue.address)}`, value: venue.address }
      : null,
    venue.instagram
      ? { label: 'Instagram', href: `https://instagram.com/${venue.instagram.replace('@', '')}`, value: '@' + venue.instagram.replace('@', ''), color: '#E8192C' }
      : null,
    venue.website
      ? { label: t('affiliate.website'), href: venue.website, value: venue.website.replace(/^https?:\/\//, '').replace(/\/$/, '') }
      : null,
    venue.external_booking_url
      ? { label: t('affiliate.booking'), href: venue.external_booking_url, value: `${t('affiliate.bookTable')} →` }
      : null,
  ].filter(Boolean) as { label: string; href: string; value: string; color?: string }[];

  return (
    <div className="relative min-h-[100dvh] flex flex-col" style={{ background: '#0A0A0A' }}>
      <main className="flex-1 pb-28">

        {/* ===== HERO — full-bleed 4:3 ===== */}
        <div className="relative overflow-hidden" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px))' }}>

          {/* Floating back */}
          <div className="absolute left-5 z-20" style={{ top: 'calc(env(safe-area-inset-top, 0px) + 1rem)' }}>
            <button
              onClick={() => navigate(-1)}
              aria-label={t('affiliate.back')}
              className="flex items-center justify-center h-9 w-9 rounded-full cursor-pointer"
              style={{ background: 'rgba(10,10,10,0.65)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.12)' }}
            >
              <ArrowLeft className="h-4 w-4 text-white" />
            </button>
          </div>

          {/* Floating actions: like + share */}
          <div className="absolute right-5 z-20 flex items-center gap-2" style={{ top: 'calc(env(safe-area-inset-top, 0px) + 1rem)' }}>
            <button
              onClick={() => venue && toggleFavorite('affiliate_venue', venue.id)}
              aria-label={t('subscribe.action')}
              className="flex items-center justify-center h-9 w-9 rounded-full cursor-pointer"
              style={{ background: 'rgba(10,10,10,0.65)', backdropFilter: 'blur(10px)', border: `1px solid ${venue && isFavorite('affiliate_venue', venue.id) ? 'rgba(232,25,44,0.50)' : 'rgba(255,255,255,0.12)'}` }}
            >
              <Bell
                className="h-4 w-4"
                style={{ color: venue && isFavorite('affiliate_venue', venue.id) ? '#E8192C' : 'white', fill: venue && isFavorite('affiliate_venue', venue.id) ? '#E8192C' : 'transparent' }}
              />
            </button>
            <button
              onClick={handleShare}
              aria-label={t('affiliate.share')}
              className="flex items-center justify-center h-9 w-9 rounded-full cursor-pointer"
              style={{ background: 'rgba(10,10,10,0.65)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.12)' }}
            >
              <Share2 className="h-4 w-4 text-white" />
            </button>
          </div>

          {/* Hero image */}
          <div className="relative w-full overflow-hidden" style={{ aspectRatio: '4/3' }}>
            {venue.cover_image_url ? (
              <img
                src={venue.cover_image_url}
                alt={venue.name}
                className="absolute inset-0 w-full h-full object-cover"
                fetchPriority="high"
              />
            ) : (
              <div
                className="absolute inset-0"
                style={{ background: 'linear-gradient(160deg, #1a0808 0%, #3d0f18 50%, #0A0A0A 100%)' }}
              />
            )}
            {/* Cinematic gradient — identical to native */}
            <div
              className="absolute inset-0"
              style={{ background: 'linear-gradient(to top, rgba(10,10,10,0.97) 0%, rgba(10,10,10,0.05) 45%, rgba(10,10,10,0.50) 100%)' }}
            />

            {/* OPEN TONIGHT badge */}
            {isOpenTonight && (
              <div
                className="absolute bottom-4 left-5 z-10 flex items-center gap-1.5 px-3 py-1.5"
                style={{ background: 'rgba(10,10,10,0.72)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 999 }}
              >
                <span
                  className="rounded-full animate-pulse flex-shrink-0"
                  style={{ width: 6, height: 6, background: '#E8192C' }}
                />
                <span className="font-mono font-bold text-white" style={{ fontSize: '10px', letterSpacing: '0.10em' }}>
                  {t('affiliate.tonight').toUpperCase()}
                </span>
              </div>
            )}

            {/* PARTENAIRE badge — top right of image */}
            <div className="absolute top-4 right-14 z-20">
              <span
                className="font-mono font-bold"
                style={{ fontSize: '9px', color: '#E8192C', background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.28)', borderRadius: '2px', padding: '3px 8px', letterSpacing: '0.12em' }}
              >
                {t('affiliate.partner').toUpperCase()}
              </span>
            </div>
          </div>
        </div>

        {/* ===== IDENTITY BLOCK ===== */}
        <div className="px-5 pt-5 animate-hero-body">
          {/* Pre-title: type + city */}
          <p className="font-mono uppercase mb-2" style={{ fontSize: '10px', color: '#5A5A5E', letterSpacing: '0.16em' }}>
            CLUB{venue.city ? ` · ${venue.city.toUpperCase()}` : ''}{venue.neighborhood ? ` · ${venue.neighborhood.toUpperCase()}` : ''}
          </p>

          {/* Venue name */}
          <h1
            className="font-display font-bold"
            style={{ fontSize: 'clamp(34px, 10vw, 54px)', color: '#FFFFFF', textTransform: 'uppercase', letterSpacing: '-0.025em', lineHeight: 0.9, marginBottom: 14 }}
          >
            {venue.name}
          </h1>

          {/* Short bio (first 140 chars of description) */}
          {venue.description && (
            <p className="font-serif italic mb-4" style={{ fontSize: '14px', color: '#9A9A9A', lineHeight: 1.6, maxWidth: 400 }}>
              {venue.description.length > 140
                ? `${venue.description.slice(0, 140).trimEnd()}…`
                : venue.description}
            </p>
          )}

          {/* Genre pills */}
          {venue.genres.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap mb-4">
              {venue.genres.map(g => (
                <span
                  key={g}
                  className="font-mono uppercase"
                  style={{ fontSize: '10px', letterSpacing: '0.12em', color: '#9A9A9A', padding: '4px 10px', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 999 }}
                >
                  {g}
                </span>
              ))}
            </div>
          )}

          {/* Follow button */}
          <button
            onClick={() => toggleFavorite('affiliate_venue', venue.id)}
            className="inline-flex items-center gap-2 font-mono font-semibold tracking-[0.08em] uppercase transition-colors mb-2"
            style={{
              fontSize: '10px',
              height: '28px',
              padding: '0 12px',
              background: isFavorite('affiliate_venue', venue.id) ? 'rgba(232,25,44,0.08)' : 'transparent',
              border: `1px solid ${isFavorite('affiliate_venue', venue.id) ? 'rgba(232,25,44,0.40)' : 'rgba(255,255,255,0.18)'}`,
              color: isFavorite('affiliate_venue', venue.id) ? '#E8192C' : '#9A9A9A',
              borderRadius: '2px',
              cursor: 'pointer',
            }}
          >
            <Bell
              className="h-3 w-3"
              style={{ fill: isFavorite('affiliate_venue', venue.id) ? '#E8192C' : 'transparent' }}
            />
            {isFavorite('affiliate_venue', venue.id) ? t('subscribe.active') : t('subscribe.action')}
          </button>
        </div>

        {/* ===== STATS BAR ===== */}
        {statItems.length > 0 && (
          <div
            className="flex items-start px-5 pt-6 pb-5"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', gap: 0 }}
          >
            {statItems.map((item, i) => (
              <div
                key={item.label}
                className="flex flex-col flex-1 min-w-0"
                style={{
                  paddingRight: 12,
                  paddingLeft: i === 0 ? 0 : 12,
                  borderLeft: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.07)',
                }}
              >
                <span className="font-mono" style={{ fontSize: '9px', color: '#5A5A5E', letterSpacing: '0.14em', marginBottom: 4 }}>
                  {item.label}
                </span>
                <span
                  className="font-display font-bold truncate"
                  style={{ fontSize: '15px', color: '#FFFFFF', textTransform: 'uppercase', letterSpacing: '-0.01em', lineHeight: 1.15 }}
                >
                  {item.value}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* ===== EVENTS ===== */}
        {events.length > 0 && (
          <div className="pt-8">
            {/* Section header */}
            <div
              className="flex items-center justify-between px-5"
              style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px' }}
            >
              <p className="font-mono uppercase" style={{ fontSize: '10px', letterSpacing: '0.14em', color: '#5A5A5E' }}>
                {t('affiliate.upcomingEvents')}
              </p>
              <span className="font-mono" style={{ fontSize: '10px', color: '#3A3A3E', letterSpacing: '0.08em' }}>
                {events.length}
              </span>
            </div>

            {/* Event cards — 16:9 poster style, identique au native */}
            <div className="px-5 pt-4 pb-2 space-y-3">
              {events.map((event, index) => {
                const timeStr = event.start_time ? event.start_time.slice(0, 5) : '22:00';
                const dateObj = new Date(`${event.event_date}T${timeStr}:00`);
                const isToday = event.event_date === todayStr;
                const dateLabel = isToday
                  ? t('affiliate.tonight').toUpperCase()
                  : format(dateObj, 'EEE dd MMM', { locale: dateLocale }).toUpperCase();
                const timeLabel = timeStr;

                const priceLabel = event.is_free
                  ? t('affiliate.free')
                  : event.is_sold_out
                  ? t('event.soldOut')
                  : event.price_from != null
                  ? `${event.price_from.toFixed(2)}€`
                  : null;

                return (
                  <article
                    key={event.id}
                    onClick={() => navigate(`/affiliate-event/${event.slug}`)}
                    className="cursor-pointer overflow-hidden"
                    style={{
                      borderRadius: 4,
                      border: '1px solid rgba(255,255,255,0.08)',
                      animationDelay: `${index * 60}ms`,
                    }}
                  >
                    {/* Poster 16:9 */}
                    <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', background: '#111', overflow: 'hidden' }}>
                      {event.flyer_url ? (
                        <img
                          src={event.flyer_url}
                          alt={event.name}
                          className="absolute inset-0 w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div
                          className="absolute inset-0"
                          style={{ background: 'linear-gradient(160deg, #1a0808 0%, #3d0f18 100%)' }}
                        />
                      )}
                      {/* Bottom gradient */}
                      <div
                        className="absolute inset-0"
                        style={{ background: 'linear-gradient(to top, rgba(10,10,10,0.94) 0%, rgba(10,10,10,0) 55%)' }}
                      />

                      {/* Genre badge */}
                      {event.genres.length > 0 && (
                        <div className="absolute top-3 left-3 z-10">
                          <span className="genre-tag">{event.genres[0]}</span>
                        </div>
                      )}

                      {/* SOLD OUT badge */}
                      {event.is_sold_out && (
                        <div className="absolute top-3 right-3 z-10">
                          <span
                            className="font-mono font-bold tracking-[0.14em] text-white px-2 py-1"
                            style={{ fontSize: '9px', background: 'rgba(232,25,44,0.85)', borderRadius: '2px' }}
                          >
                            {t('event.soldOut').toUpperCase()}
                          </span>
                        </div>
                      )}

                      {/* Date + title overlay */}
                      <div className="absolute bottom-0 left-0 right-0 z-10 px-4 pb-3.5">
                        <p
                          className="font-mono uppercase mb-1.5"
                          style={{ fontSize: '10px', color: 'rgba(255,255,255,0.50)', letterSpacing: '0.14em' }}
                        >
                          {dateLabel}{!isToday && ` · ${timeLabel}`}
                        </p>
                        <h3
                          className="font-display font-bold text-white uppercase"
                          style={{ fontSize: 'clamp(20px, 5.5vw, 30px)', letterSpacing: '-0.02em', lineHeight: 0.93 }}
                        >
                          {event.name}
                        </h3>
                      </div>
                    </div>

                    {/* Bottom strip */}
                    <div
                      className="flex items-center justify-between px-4 py-3"
                      style={{ background: '#0e0e0e', borderTop: '1px solid rgba(255,255,255,0.06)' }}
                    >
                      <p
                        className="font-mono truncate"
                        style={{ fontSize: '10px', color: '#5A5A5E', letterSpacing: '0.08em', textTransform: 'uppercase' }}
                      >
                        {venue.name}
                        {!isToday && <span style={{ color: '#3A3A3E' }}> · {timeLabel}</span>}
                      </p>
                      <div className="flex items-center gap-2.5 shrink-0 ml-3">
                        {priceLabel && (
                          <span
                            className="font-mono font-bold"
                            style={{
                              fontSize: '13px',
                              color: event.is_sold_out ? '#5A5A5E' : event.is_free ? '#9A9A9A' : '#E8192C',
                              letterSpacing: '0.02em',
                            }}
                          >
                            {priceLabel}
                          </span>
                        )}
                        <span className="font-mono" style={{ fontSize: '12px', color: '#3A3A3E' }}>→</span>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        )}

        {/* ===== PHOTOS — snap carousel ===== */}
        {venue.gallery_urls.length > 0 && (
          <div className="pt-10">
            <div className="px-5 mb-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px' }}>
              <p className="yuno-rule">{t('affiliate.photos')}</p>
            </div>

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
              {venue.gallery_urls.map((img, i) => (
                <div
                  key={i}
                  className="snap-center flex-shrink-0 w-full relative overflow-hidden"
                  style={{ aspectRatio: '4/3' }}
                >
                  <img
                    src={img}
                    alt={`${venue.name} ${i + 1}`}
                    className="absolute inset-0 w-full h-full object-cover"
                    loading="lazy"
                  />
                </div>
              ))}
            </div>

            {/* Dot indicators */}
            {venue.gallery_urls.length > 1 && (
              <div className="flex justify-center items-center gap-1.5 mt-3 px-5">
                {venue.gallery_urls.map((_, i) => (
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
            <div style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px', marginBottom: '4px' }}>
              <p className="yuno-rule">{t('affiliate.theRoom')}</p>
            </div>
            <VenueDescription description={venue.description} />
          </div>
        )}

        {/* ===== INFO CARD ===== */}
        {infoRows.length > 0 && (
          <div className="px-5 pt-10">
            <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: '4px', padding: '0 16px' }}>
              {infoRows.map(({ label, href, value, color }, i) => (
                <div
                  key={label}
                  className="flex items-start justify-between gap-3"
                  style={{ padding: '11px 0', borderBottom: i < infoRows.length - 1 ? '1px solid rgba(255,255,255,0.07)' : 'none' }}
                >
                  <span className="font-mono flex-shrink-0" style={{ fontSize: '11px', color: '#5A5A5E', letterSpacing: '0.08em' }}>
                    {label}
                  </span>
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-right truncate transition-opacity hover:opacity-70"
                    style={{ fontSize: '12px', color: color || '#FFFFFF', letterSpacing: '0.02em', maxWidth: '65%' }}
                  >
                    {value}
                  </a>
                </div>
              ))}
              {venue.address && (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue.address)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1 w-full my-4 font-mono text-[#5A5A5E] hover:text-white transition-colors"
                  style={{ height: '38px', borderRadius: '4px', fontSize: '11px', letterSpacing: '0.08em', border: '1px solid rgba(255,255,255,0.08)', background: 'transparent' }}
                >
                  {t('affiliate.openInMaps')} →
                </a>
              )}
            </div>
          </div>
        )}

        {/* ===== ORGANISATEUR PARTENAIRE ===== */}
        {affiliate && (
          <div className="px-5 pt-10">
            <div style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px', marginBottom: '12px' }}>
              <p className="yuno-rule">{t('affiliate.organizer')}</p>
            </div>
            <div
              style={{ border: '1px solid rgba(255,255,255,0.06)', borderRadius: '4px', padding: '12px 16px' }}
            >
              <button
                onClick={() => affiliate.linktree_slug && navigate(`/p/${affiliate.linktree_slug}`)}
                className="flex items-center gap-3 min-w-0 w-full hover:opacity-80 transition-opacity text-left"
                style={{ cursor: affiliate.linktree_slug ? 'pointer' : 'default', background: 'transparent', border: 'none' }}
              >
                <div
                  className="shrink-0 overflow-hidden"
                  style={{ width: 48, height: 48, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.08)', background: '#191919' }}
                >
                  {affiliate.avatar_url
                    ? <img src={affiliate.avatar_url} alt={affiliate.name} className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center font-mono font-bold" style={{ fontSize: '12px', color: '#5A5A5E' }}>{affiliate.name.slice(0, 2).toUpperCase()}</div>
                  }
                </div>
                <div className="min-w-0 flex-1">
                  <p
                    className="font-mono truncate"
                    style={{ fontSize: '13px', color: '#E5E5E5', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600 }}
                  >
                    {affiliate.name}
                  </p>
                  <p className="font-mono mt-1" style={{ fontSize: '10px', color: '#5A5A5E', letterSpacing: '0.04em' }}>
                    {t('affiliate.yunoPartner')}
                  </p>
                </div>
                {affiliate.linktree_slug && (
                  <span className="text-[#3A3A3E] text-xs shrink-0 ml-2">→</span>
                )}
              </button>
            </div>
          </div>
        )}

        {/* ===== COPYRIGHT ===== */}
        <div className="px-5 pt-10 pb-4 text-center">
          <p className="font-mono" style={{ fontSize: '10px', color: '#3A3A3E', letterSpacing: '0.08em' }}>
            © {new Date().getFullYear()} {venue.name.toUpperCase()}{SUBSCRIPTIONS_ENABLED ? ' · POWERED BY YUNO' : ''}
          </p>
        </div>

      </main>

      <BottomNav />
    </div>
  );
}
