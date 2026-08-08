import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, MapPin, ExternalLink, ChevronDown, ChevronUp,
  Share2, Music, Heart,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSuppressBottomNav } from '@/components/PersistentBottomNav';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { toast } from 'sonner';
import { shareContent } from '@/lib/share';
import { useAffiliateVisitorTracking, trackAffiliateClick } from '@/hooks/useAffiliateVisitorTracking';
import { useFavorites } from '@/hooks/useFavorites';
import { StickyCheckoutFooter } from '@/components/StickyCheckoutFooter';
import { openExternal } from '@/lib/native';
import { OfferBadges } from '@/components/affiliate/OfferBadges';

type AffiliateEvent = {
  id: string;
  name: string;
  slug: string;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  flyer_url: string | null;
  gallery_urls: string[];
  description: string | null;
  genres: string[];
  dj_names: string[];
  external_ticket_url: string | null;
  price_from: number | null;
  is_free: boolean;
  is_sold_out: boolean;
  status: string;
  affiliate_id: string;
  has_tables: boolean;
  tables_only: boolean;
  has_guest_list: boolean;
  guest_list_type: string | null;
  affiliate_venues: {
    id: string;
    name: string;
    city: string | null;
    neighborhood: string | null;
    slug: string;
    address: string | null;
    instagram: string | null;
    website: string | null;
    cover_image_url: string | null;
    logo_url: string | null;
  } | null;
};

type AffiliateProfile = {
  id: string;
  name: string;
  linktree_slug: string | null;
  avatar_url: string | null;
  user_id: string | null;
};

// ── Loading skeleton (matches native EventDetails skeleton) ──────────────────
function LoadingSkeleton() {
  return (
    <div className="min-h-screen pb-28" style={{ background: '#0A0A0A' }}>
      <div className="px-4 pt-4">
        <Skeleton className="w-full aspect-square rounded-none" />
      </div>
      <div className="px-5 pt-6 space-y-3">
        <Skeleton className="h-10 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <div className="px-5 pt-8 space-y-4">
        <Skeleton className="h-20 w-full rounded" />
        <Skeleton className="h-24 w-full rounded" />
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function AffiliateEventPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { language, t } = useLanguage();
  const [event, setEvent] = useState<AffiliateEvent | null>(null);
  const [affiliate, setAffiliate] = useState<AffiliateProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [showFullDescription, setShowFullDescription] = useState(false);
  const [showLeaveNotice, setShowLeaveNotice] = useState(false);
  const { isFavorite, toggleFavorite } = useFavorites();

  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  const isOwner = !!(user?.id && affiliate?.user_id && user.id === affiliate.user_id);

  // Attribution promoteur : /affiliate-event/slug?via=<linktree_slug> crédite
  // les vues et les clics au membre, sans passer par sa page /promo. Le
  // tracking ne démarre qu'une fois la résolution faite, sinon la session
  // serait créée deux fois (une sans membre, une avec).
  const [viaSlug] = useState(() => new URLSearchParams(window.location.search).get('via'));
  const [viaMemberId, setViaMemberId] = useState<string | null>(null);
  const [viaResolved, setViaResolved] = useState(!viaSlug);

  useEffect(() => {
    if (!viaSlug || !event?.affiliate_id) return;
    let active = true;
    (async () => {
      const { data } = await supabase
        .from('affiliate_members')
        .select('id')
        .eq('affiliate_id', event.affiliate_id)
        .eq('linktree_slug', viaSlug)
        .eq('is_active', true)
        .maybeSingle();
      if (active) {
        setViaMemberId(data?.id ?? null);
        setViaResolved(true);
      }
    })();
    return () => { active = false; };
  }, [viaSlug, event?.affiliate_id]);

  useAffiliateVisitorTracking({
    affiliateId: viaResolved ? (event?.affiliate_id ?? '') : '',
    affiliateMemberId: viaMemberId ?? undefined,
    affiliateEventId: event?.id,
    affiliateVenueId: event?.affiliate_venues?.id,
    isOwner,
  });

  useEffect(() => {
    if (slug) fetchEvent();
  }, [slug]);

  const fetchEvent = async () => {
    setLoading(true);
    const today = new Date().toISOString().split('T')[0];
    const { data } = await supabase
      .from('affiliate_events')
      .select('*, affiliate_venues(id, name, city, neighborhood, slug, address, instagram, website, cover_image_url, logo_url)')
      .eq('slug', slug!)
      .in('status', ['published', 'featured'])
      .gte('event_date', today)
      .maybeSingle();

    if (!data) { navigate('/'); return; }
    setEvent(data as unknown as AffiliateEvent);

    const { data: aff } = await supabase
      .from('affiliates')
      .select('id, name, linktree_slug, avatar_url, user_id')
      .eq('id', data.affiliate_id)
      .single();
    if (aff) setAffiliate(aff as unknown as AffiliateProfile);

    setLoading(false);
  };

  const trackTicketClick = () => {
    if (!event) return;
    trackAffiliateClick({
      affiliateId: event.affiliate_id,
      affiliateEventId: event.id,
      affiliateVenueId: event.affiliate_venues?.id ?? null,
      affiliateMemberId: viaMemberId,
      userId: user?.id ?? null,
      isInternal: isOwner,
    });
  };

  // Un événement partenaire se règle sur la billetterie du club, HORS Yuno. On
  // confirme la sortie AVANT d'ouvrir le navigateur externe : impossible d'injecter
  // une bannière dans SafariVC, donc le contexte (« vous quittez Yuno, vers quel
  // site ») se donne ici, en interstitiel, juste avant la redirection.
  const requestTickets = () => {
    if (!event?.external_ticket_url) return;
    setShowLeaveNotice(true);
  };

  const confirmLeave = () => {
    if (!event?.external_ticket_url) return;
    trackTicketClick();
    openExternal(event.external_ticket_url);
    setShowLeaveNotice(false);
  };

  const handleShare = async () => {
    const url = window.location.href;
    const shareData = { title: event?.name || '', url };
    const outcome = await shareContent(shareData);
    if (outcome === 'copied') toast.success(t('share.copied'));
  };

  // Un événement affilié en vente pose son propre CTA « prendre un billet » collant
  // en bas d'écran : dans ce cas seulement, il prend la place de la barre d'onglets.
  // Hook appelé avant les early-returns (règle des hooks) — pendant le chargement
  // `event` est null, donc la barre reste visible sous le skeleton.
  useSuppressBottomNav(!!event && !event.is_sold_out && !!event.external_ticket_url);

  if (loading) return <LoadingSkeleton />;
  if (!event) return null;

  const venue = event.affiliate_venues;

  // Date & time formatting
  const dateObj = new Date(`${event.event_date}T${(event.start_time || '22:00').substring(0, 5)}:00`);
  const dayNum = format(dateObj, 'd');
  const monthYear = format(dateObj, 'MMMM yyyy', { locale: dateLocale });
  const dayName = format(dateObj, 'EEEE', { locale: dateLocale });
  // Jour en toutes lettres UNE fois (« jeudi 6 août 2026 »), pas « jeudi jeu. 6… ».
  const dateShort = format(dateObj, 'd MMM yyyy', { locale: dateLocale });
  const timeOpen = event.start_time ? event.start_time.slice(0, 5) : '22:00';
  const timeClose = event.end_time ? event.end_time.slice(0, 5) : null;

  // Price
  const isFree = event.is_free;
  const isSoldOut = event.is_sold_out;
  const priceFrom = event.price_from;
  const hasTicketLink = !!event.external_ticket_url;

  // Domaine de la billetterie externe, montré dans l'interstitiel de sortie.
  let ticketHost = '';
  if (event.external_ticket_url) {
    try { ticketHost = new URL(event.external_ticket_url).hostname.replace(/^www\./, ''); }
    catch { /* URL invalide : pas de domaine à afficher */ }
  }

  const priceDisplay = isFree
    ? t('affiliate.freeEntry')
    : priceFrom != null
    ? `${t('event.startingFrom')} ${priceFrom.toFixed(2)}€`
    : t('affiliate.seePrices');

  // Hero meta line — le club est déjà affiché au-dessus (ligne d'identité), on ne
  // le répète donc pas ici. Reste : date · ouverture · fermeture.
  const metaParts = [
    `${dayName.toUpperCase()} ${dateShort.toUpperCase()}`,
    `${t('event.doorsOpen').toUpperCase()} ${timeOpen}`,
    timeClose ? `${t('event.doorsClose').toUpperCase()} ${timeClose}` : null,
  ].filter(Boolean);

  return (
    <div className="min-h-screen pb-28" style={{ background: '#0A0A0A' }}>

      {/* ── CINEMATIC HERO ───────────────────────────────────── */}
      <section
        className="relative overflow-hidden"
        style={{ aspectRatio: '1 / 1', borderBottom: '1px solid rgba(255,255,255,0.07)' }}
      >
        {/* Background image */}
        {event.flyer_url ? (
          <img
            src={event.flyer_url}
            alt={event.name}
            className="absolute inset-0 w-full h-full object-cover object-center"
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{ background: 'linear-gradient(160deg, #1a0808 0%, #3d0f18 50%, #0A0A0A 100%)' }}
          />
        )}

        {/* Gradient overlay — identical to native */}
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(to top, rgba(10,10,10,0.97) 0%, rgba(10,10,10,0.2) 50%, rgba(10,10,10,0.55) 100%)' }}
        />

        {/* Top bar: back (left) + share (right) */}
        <div
          className="absolute top-0 left-0 right-0 z-20 flex items-start justify-between"
          style={{ padding: 'calc(env(safe-area-inset-top, 0px) + 8px) 16px 0' }}
        >
          <button
            onClick={() => navigate(-1)}
            aria-label={t('affiliate.back')}
            className="flex items-center justify-center hover:opacity-80 transition-opacity"
            style={{ width: 36, height: 36, borderRadius: '2px', background: 'rgba(0,0,0,0.40)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', color: '#fff', border: 'none', cursor: 'pointer' }}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={() => event && toggleFavorite('affiliate_event', event.id)}
              aria-label={t('affiliate.interested')}
              className="flex items-center justify-center hover:opacity-80 transition-opacity"
              style={{ width: 36, height: 36, borderRadius: '2px', background: 'rgba(0,0,0,0.40)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', color: event && isFavorite('affiliate_event', event.id) ? '#E8192C' : '#fff', border: 'none', cursor: 'pointer' }}
            >
              <Heart className={`h-4 w-4 ${event && isFavorite('affiliate_event', event.id) ? 'fill-[#E8192C]' : ''}`} />
            </button>
            <button
              onClick={handleShare}
              aria-label={t('affiliate.share')}
              className="flex items-center justify-center hover:opacity-80 transition-opacity"
              style={{ width: 36, height: 36, borderRadius: '2px', background: 'rgba(0,0,0,0.40)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', color: '#fff', border: 'none', cursor: 'pointer' }}
            >
              <Share2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Bottom: badges + title + meta */}
        <div
          className="absolute bottom-0 left-0 right-0 z-10"
          style={{ padding: '0 20px clamp(24px, 5vh, 44px)' }}
        >
          {/* Badges row */}
          <div className="flex flex-wrap items-center gap-2 mb-4 animate-hero-label">
            {isSoldOut && (
              <span
                className="font-mono font-bold tracking-[0.18em] text-white px-3 py-1"
                style={{ fontSize: '11px', background: '#E8192C', borderRadius: '2px' }}
              >
                {t('event.soldOut').toUpperCase()}
              </span>
            )}
            {/* PARTENAIRE badge — red, pas violet */}
            <span
              className="font-mono font-bold tracking-[0.14em]"
              style={{
                fontSize: '10px',
                color: '#E8192C',
                background: 'rgba(232,25,44,0.12)',
                border: '1px solid rgba(232,25,44,0.28)',
                borderRadius: '2px',
                padding: '3px 9px',
              }}
            >
              {t('affiliate.partner').toUpperCase()}
            </span>
            {event.genres.slice(0, 2).map(g => (
              <span
                key={g}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  height: '22px',
                  padding: '0 9px',
                  borderRadius: '999px',
                  fontSize: '10px',
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  background: 'rgba(255,255,255,0.07)',
                  border: '1px solid rgba(255,255,255,0.10)',
                  color: 'rgba(255,255,255,0.80)',
                  backdropFilter: 'blur(10px)',
                  WebkitBackdropFilter: 'blur(10px)',
                }}
              >
                {g}
              </span>
            ))}
            <OfferBadges flags={event} size="md" />
          </div>

          {/* Event title */}
          <h1
            className="font-display text-white uppercase animate-hero-h1"
            style={{
              fontSize: 'clamp(38px, 9vw, 100px)',
              fontWeight: 700,
              letterSpacing: '-0.025em',
              lineHeight: 0.9,
              marginBottom: '18px',
            }}
          >
            {event.name}
          </h1>

          {/* Meta line — identité = le CLUB d'abord (logo + nom, blanc), puis
              × l'agence RP en second (gris). Même hiérarchie que l'in-Yuno
              (entité principale × partenaire). */}
          <div className="animate-hero-body">
            {(venue || affiliate) && (
              <div className="flex items-center gap-2 mb-1">
                {venue && (venue.logo_url || venue.cover_image_url) && (
                  <img
                    src={venue.logo_url || venue.cover_image_url!}
                    alt={venue.name}
                    className="rounded-full object-cover shrink-0"
                    style={{ width: 18, height: 18 }}
                  />
                )}
                {venue && (
                  <span className="font-mono text-white font-semibold tracking-[0.08em]" style={{ fontSize: '12px' }}>
                    {venue.name.toUpperCase()}
                  </span>
                )}
                {venue && affiliate && (
                  <span className="text-[#3A3A3E]" style={{ fontSize: '11px' }}>×</span>
                )}
                {affiliate && (
                  <span className="font-mono text-[#9A9A9A] tracking-[0.08em]" style={{ fontSize: '11px' }}>
                    {affiliate.name.toUpperCase()}
                  </span>
                )}
              </div>
            )}
            <p className="font-mono text-[#9A9A9A] tracking-[0.06em]" style={{ fontSize: '12px' }}>
              {metaParts.join(' · ')}
            </p>
          </div>
        </div>
      </section>

      {/* ── CONTENT ─────────────────────────────────────────────── */}
      <div style={{ maxWidth: '768px', margin: '0 auto' }}>

        {/* ── Actions row ── */}
        <div
          className="flex flex-wrap items-center gap-2.5 animate-hero-cta"
          style={{ padding: 'clamp(20px, 4vw, 28px) 20px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}
        >
          <button
            onClick={() => toggleFavorite('affiliate_event', event.id)}
            className="inline-flex items-center gap-2 font-mono font-semibold tracking-[0.08em] uppercase transition-colors"
            style={{
              fontSize: '11px',
              height: '32px',
              padding: '0 14px',
              background: isFavorite('affiliate_event', event.id) ? 'rgba(232,25,44,0.08)' : 'transparent',
              border: `1px solid ${isFavorite('affiliate_event', event.id) ? 'rgba(232,25,44,0.40)' : '#2A2A2A'}`,
              color: isFavorite('affiliate_event', event.id) ? '#E8192C' : '#888888',
              borderRadius: '2px',
              cursor: 'pointer',
            }}
          >
            <Heart className={`h-3 w-3 ${isFavorite('affiliate_event', event.id) ? 'fill-[#E8192C]' : ''}`} />
            {isFavorite('affiliate_event', event.id) ? t('affiliate.interested') : t('affiliate.interestedQuestion')}
          </button>
          <button
            onClick={handleShare}
            className="inline-flex items-center gap-2 font-mono font-semibold tracking-[0.08em] uppercase transition-colors hover:border-[#3A3A3A] hover:text-white"
            style={{ fontSize: '11px', height: '32px', padding: '0 14px', background: 'transparent', border: '1px solid #2A2A2A', color: '#888888', borderRadius: '2px', cursor: 'pointer' }}
          >
            <Share2 className="h-3 w-3" />
            {t('affiliate.share')}
          </button>
          {/* YUNO partner label */}
          <span className="font-mono text-[#5A5A5E]" style={{ fontSize: '11px', letterSpacing: '0.04em' }}>
            {t('affiliate.partnerEventLabel')}{' '}
            <span className="font-bold" style={{ color: '#E8192C' }}>YUNO</span>
          </span>
        </div>

        {/* ── TICKET CALLOUT ── */}
        {!isSoldOut && hasTicketLink && (
          <section style={{ padding: '20px 20px 0' }}>
            <div
              style={{
                border: '1px solid rgba(232,25,44,0.28)',
                borderRadius: 4,
                padding: '16px 20px',
                background: 'rgba(232,25,44,0.04)',
              }}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p
                    className="font-mono uppercase mb-1"
                    style={{ fontSize: '9px', color: '#E8192C', letterSpacing: '0.14em' }}
                  >
                    {event.tables_only ? t('aff.badge.tablesOnly') : t('event.ticketsAvailable')}
                  </p>
                  <p
                    className="font-display font-bold text-white"
                    style={{ fontSize: 'clamp(20px, 5vw, 30px)', letterSpacing: '-0.025em', lineHeight: 1 }}
                  >
                    {priceDisplay}
                  </p>
                </div>
                <button
                  onClick={requestTickets}
                  className="shrink-0 font-mono font-bold uppercase inline-flex items-center gap-2"
                  style={{
                    height: 44,
                    padding: '0 22px',
                    background: '#E8192C',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 3,
                    fontSize: '11px',
                    cursor: 'pointer',
                    letterSpacing: '0.10em',
                    transition: 'transform 160ms cubic-bezier(0.23, 1, 0.32, 1)',
                    WebkitTapHighlightColor: 'transparent',
                  } as React.CSSProperties}
                  onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.97)')}
                  onMouseUp={e => (e.currentTarget.style.transform = '')}
                  onMouseLeave={e => (e.currentTarget.style.transform = '')}
                  onTouchStart={e => (e.currentTarget.style.transform = 'scale(0.97)')}
                  onTouchEnd={e => (e.currentTarget.style.transform = '')}
                >
                  {event.tables_only ? t('aff.badge.bookTable') : t('affiliate.getTickets')} <ExternalLink className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="font-mono" style={{ fontSize: '10px', color: '#5A5A5E', letterSpacing: '0.04em', marginTop: 10 }}>
                {t('affiliate.redirectNotice')}
              </p>
            </div>
          </section>
        )}

        {/* Sold out inline callout */}
        {isSoldOut && (
          <section style={{ padding: '20px 20px 0' }}>
            <div
              style={{
                border: '1px solid rgba(255,255,255,0.10)',
                borderRadius: 4,
                padding: '16px 20px',
                background: 'rgba(255,255,255,0.02)',
              }}
            >
              <p
                className="font-mono uppercase mb-1"
                style={{ fontSize: '9px', color: '#5A5A5E', letterSpacing: '0.14em' }}
              >
                {t('affiliate.ticketing')}
              </p>
              <p
                className="font-display font-bold"
                style={{ fontSize: 'clamp(17px, 4vw, 22px)', color: '#E8192C', letterSpacing: '-0.02em', lineHeight: 1.1 }}
              >
                {t('event.soldOut')}
              </p>
            </div>
          </section>
        )}

        {/* No ticket link */}
        {!hasTicketLink && !isSoldOut && (
          <section style={{ padding: '20px 20px 0' }}>
            <div
              style={{
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 4,
                padding: '16px 20px',
                background: 'rgba(255,255,255,0.01)',
              }}
            >
              <p
                className="font-mono uppercase mb-1"
                style={{ fontSize: '9px', color: '#5A5A5E', letterSpacing: '0.14em' }}
              >
                {t('affiliate.ticketing')}
              </p>
              <p
                className="font-display font-bold text-white"
                style={{ fontSize: 'clamp(17px, 4vw, 22px)', letterSpacing: '-0.02em', lineHeight: 1.1 }}
              >
                {t('affiliate.comingSoon')}
              </p>
            </div>
          </section>
        )}

        {/* ── INFO TABLE ── */}
        <section
          style={{ padding: 'clamp(32px, 5vw, 44px) 20px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}
        >
          <p className="section-label-ruled mb-6">{t('affiliate.dateAndVenue')}</p>

          {/* Large typographic date + time */}
          <div
            className="flex items-stretch mb-6 pb-6"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
          >
            <div className="flex-1">
              <p className="font-mono uppercase mb-2" style={{ fontSize: '9px', color: '#5A5A5E', letterSpacing: '0.14em' }}>
                {t('affiliate.date')}
              </p>
              <p
                className="font-display font-bold text-white"
                style={{ fontSize: 'clamp(48px, 12vw, 72px)', letterSpacing: '-0.04em', lineHeight: 0.85 }}
              >
                {dayNum}
              </p>
              <p
                className="font-display font-bold uppercase"
                style={{ fontSize: 'clamp(14px, 3.5vw, 20px)', color: '#9A9A9A', letterSpacing: '-0.01em', lineHeight: 1.1, marginTop: 4, textTransform: 'capitalize' }}
              >
                {monthYear}
              </p>
            </div>

            {/* Vertical divider */}
            <div className="shrink-0" style={{ width: 1, background: 'rgba(255,255,255,0.07)', margin: '0 24px' }} />

            <div className="flex-1">
              <p className="font-mono uppercase mb-2" style={{ fontSize: '9px', color: '#5A5A5E', letterSpacing: '0.14em' }}>
                {t('event.doorsOpen')}
              </p>
              <p
                className="font-display font-bold text-white"
                style={{ fontSize: 'clamp(48px, 12vw, 72px)', letterSpacing: '-0.04em', lineHeight: 0.85 }}
              >
                {timeOpen}
              </p>
              {timeClose && (
                <p
                  className="font-mono uppercase"
                  style={{ fontSize: '10px', color: '#5A5A5E', letterSpacing: '0.08em', marginTop: 8 }}
                >
                  {t('event.doorsClose')} {timeClose}
                </p>
              )}
            </div>
          </div>

          {/* Compact details table */}
          {(venue?.address || venue?.city || venue?.neighborhood) && (
            <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: '4px', padding: '0 16px' }}>
              {([
                venue?.name ? { label: t('affiliate.venue'), value: venue.name } : null,
                venue?.neighborhood || venue?.city
                  ? { label: t('affiliate.neighborhood'), value: [venue.neighborhood, venue.city].filter(Boolean).join(' · ') }
                  : null,
                venue?.address ? { label: t('event.address'), value: venue.address, isAddress: true } : null,
              ].filter(Boolean) as { label: string; value: string; isAddress?: boolean }[]).map((row, i, arr) => (
                <div
                  key={row.label}
                  className="flex items-start justify-between gap-3"
                  style={{ padding: '11px 0', borderBottom: i < arr.length - 1 ? '1px solid rgba(255,255,255,0.07)' : 'none' }}
                >
                  <span className="font-mono flex-shrink-0" style={{ fontSize: '12px', color: '#5A5A5E' }}>{row.label}</span>
                  {row.isAddress ? (
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(row.value)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-right transition-colors hover:text-[#E8192C]"
                      style={{ fontSize: '12px', color: '#FFFFFF', letterSpacing: '0.02em', maxWidth: '60%' }}
                    >
                      {row.value}
                    </a>
                  ) : (
                    <span className="font-mono text-right" style={{ fontSize: '12px', color: '#FFFFFF', letterSpacing: '0.02em', maxWidth: '65%' }}>{row.value}</span>
                  )}
                </div>
              ))}
              {venue?.address && (
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
          )}
        </section>

        {/* ── VENUE CARD ── */}
        {venue && (
          <section
            style={{ padding: 'clamp(32px, 5vw, 44px) 20px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}
          >
            <p className="section-label-ruled mb-6">{t('affiliate.venue')}</p>
            <div
              className="flex items-center"
              style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: '4px', padding: '18px 20px', background: 'rgba(255,255,255,0.02)' }}
            >
              <button
                onClick={() => venue.slug && navigate(`/affiliate-venue/${venue.slug}`)}
                className="flex items-center gap-3 min-w-0 flex-1 text-left hover:opacity-80 transition-opacity"
                style={{ cursor: 'pointer' }}
              >
                <div
                  className="shrink-0 overflow-hidden"
                  style={{ width: 52, height: 52, borderRadius: '4px', border: '1px solid rgba(255,255,255,0.08)', background: '#191919' }}
                >
                  {venue.cover_image_url
                    ? <img src={venue.cover_image_url} alt={venue.name} className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center"><MapPin className="h-5 w-5" style={{ color: '#5A5A5E' }} /></div>
                  }
                </div>
                <div className="min-w-0 flex-1">
                  <p
                    className="font-display font-bold uppercase truncate"
                    style={{ fontSize: 'clamp(14px, 2vw, 18px)', color: '#FFFFFF', letterSpacing: '-0.005em' }}
                  >
                    {venue.name}
                  </p>
                  {(venue.neighborhood || venue.city) && (
                    <p className="font-mono mt-0.5" style={{ fontSize: '10px', color: '#5A5A5E', letterSpacing: '0.06em' }}>
                      {[venue.neighborhood, venue.city].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
                <span className="text-[#5A5A5E] text-sm shrink-0 ml-2">→</span>
              </button>
            </div>
          </section>
        )}

        {/* ── RP (agence partenaire qui anime la soirée) ── */}
        {affiliate && (
          <section
            style={{ padding: 'clamp(32px, 5vw, 44px) 20px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}
          >
            <p className="section-label-ruled mb-6">{t('affiliate.rp')}</p>
            <div
              style={{ border: '1px solid rgba(255,255,255,0.06)', borderRadius: '4px', padding: '12px 16px' }}
            >
              <button
                onClick={() => affiliate.linktree_slug && navigate(`/rp/${affiliate.linktree_slug}`)}
                className="flex items-center gap-3 min-w-0 w-full hover:opacity-80 transition-opacity text-left"
                style={{ cursor: affiliate.linktree_slug ? 'pointer' : 'default' }}
              >
                <div
                  className="shrink-0 overflow-hidden"
                  style={{ width: 52, height: 52, borderRadius: '4px', border: '1px solid rgba(255,255,255,0.08)', background: '#191919' }}
                >
                  {affiliate.avatar_url
                    ? <img src={affiliate.avatar_url} alt={affiliate.name} className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center font-mono font-bold" style={{ fontSize: '13px', color: '#5A5A5E' }}>{affiliate.name.slice(0, 2).toUpperCase()}</div>
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
          </section>
        )}

        {/* ── DESCRIPTION ── */}
        {event.description && (
          <section
            style={{ padding: 'clamp(32px, 5vw, 44px) 20px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}
          >
            <p className="section-label-ruled mb-5">{t('event.about')}</p>
            <div className="relative">
              <p
                className={`whitespace-pre-line ${!showFullDescription ? 'line-clamp-6' : ''}`}
                style={{ fontSize: '14px', color: '#9A9A9A', lineHeight: 1.65 }}
              >
                {event.description}
              </p>
              {!showFullDescription && event.description.length > 200 && (
                <div
                  className="absolute bottom-0 inset-x-0 h-14 pointer-events-none"
                  style={{ background: 'linear-gradient(to top, #0A0A0A, transparent)' }}
                />
              )}
            </div>
            {event.description.length > 200 && (
              <div className="flex justify-center pt-3">
                <button
                  onClick={() => setShowFullDescription(!showFullDescription)}
                  className="flex items-center gap-1.5 font-mono font-semibold tracking-[0.08em] uppercase transition-colors hover:text-white"
                  style={{ fontSize: '10px', color: '#5A5A5E', background: 'transparent', border: 'none', cursor: 'pointer', padding: '6px 12px' }}
                >
                  {showFullDescription
                    ? <><ChevronUp className="h-3.5 w-3.5" />{t('event.seeLess')}</>
                    : <>{t('event.seeMore')}<ChevronDown className="h-3.5 w-3.5" /></>
                  }
                </button>
              </div>
            )}
          </section>
        )}

        {/* ── DJ / LINE-UP ── */}
        {event.dj_names.length > 0 && (
          <section
            style={{ padding: 'clamp(32px, 5vw, 44px) 20px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}
          >
            <p className="section-label-ruled mb-6">{t('affiliate.lineup')}</p>
            <div
              className="flex gap-5 overflow-x-auto pb-2 scrollbar-hide"
              style={{ margin: '0 -20px', padding: '0 20px' }}
            >
              {event.dj_names.map(dj => (
                <div
                  key={dj}
                  className="flex flex-col items-center gap-3 flex-shrink-0"
                  style={{ maxWidth: 68 }}
                >
                  <div
                    className="overflow-hidden flex items-center justify-center"
                    style={{ width: 60, height: 60, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.10)', background: '#191919' }}
                  >
                    <Music className="h-6 w-6" style={{ color: '#5A5A5E' }} />
                  </div>
                  <p
                    className="font-mono text-center leading-tight"
                    style={{ fontSize: '12px', color: '#9A9A9A', letterSpacing: '0.04em', textTransform: 'uppercase', maxWidth: 68 }}
                  >
                    {dj}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── GALLERY ── */}
        {event.gallery_urls.length > 0 && (
          <section
            style={{ padding: 'clamp(32px, 5vw, 44px) 20px' }}
          >
            <p className="section-label-ruled mb-5">{t('affiliate.photos')}</p>
            <div className="grid grid-cols-3 gap-1.5">
              {event.gallery_urls.slice(0, 9).map((url, i) => (
                <div key={i} className="aspect-square overflow-hidden" style={{ borderRadius: '4px' }}>
                  <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" />
                </div>
              ))}
            </div>
          </section>
        )}

      </div>

      {/* ── STICKY CHECKOUT FOOTER (même composant que les soirées in-Yuno) ── */}
      {!isSoldOut && hasTicketLink && (
        <StickyCheckoutFooter
          amount={!isFree && priceFrom != null ? priceFrom : 0}
          label={isFree ? t('affiliate.freeEntry') : priceFrom != null ? t('event.startingFrom') : t('affiliate.seePrices')}
          subtitleText={t('affiliate.redirectNotice')}
          buttonText={t('affiliate.getTickets')}
          icon={<ExternalLink className="h-4 w-4" />}
          onClick={requestTickets}
        />
      )}

      {/* ── INTERSTITIEL « SORTIE HORS YUNO » ─────────────────────
          On ne peut pas injecter de bannière dans le navigateur in-app du club :
          on donne donc le contexte ici, en feuille du bas, juste avant la sortie. */}
      <AnimatePresence>
        {showLeaveNotice && (
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="affiliate-leave-title"
            className="fixed inset-0 z-[100] flex items-end justify-center"
            style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowLeaveNotice(false)}
          >
            <motion.div
              onClick={e => e.stopPropagation()}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 34 }}
              style={{
                width: '100%',
                maxWidth: 480,
                background: '#141414',
                borderTop: '1px solid rgba(255,255,255,0.10)',
                borderTopLeftRadius: 16,
                borderTopRightRadius: 16,
                padding: '10px 22px calc(env(safe-area-inset-bottom, 0px) + 22px)',
                boxShadow: '0 -20px 60px rgba(0,0,0,0.6)',
              }}
            >
              {/* grabber */}
              <div style={{ width: 40, height: 4, borderRadius: 999, background: 'rgba(255,255,255,0.18)', margin: '4px auto 20px' }} />

              <div className="flex items-center justify-center mb-4" style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(232,25,44,0.12)' }}>
                <ExternalLink className="h-5 w-5" style={{ color: '#E8192C' }} />
              </div>

              <p className="font-mono font-bold" style={{ fontSize: '10px', color: '#E8192C', letterSpacing: '0.14em', marginBottom: '8px' }}>
                {t('affiliate.partner').toUpperCase()} · YUNO
              </p>
              <h2
                id="affiliate-leave-title"
                className="font-display text-white uppercase"
                style={{ fontSize: '22px', fontWeight: 700, letterSpacing: '-0.01em', lineHeight: 1.1, marginBottom: '10px' }}
              >
                {t('affiliate.leaveNotice.title')}
              </h2>
              <p style={{ fontSize: '14px', lineHeight: 1.55, color: 'rgba(255,255,255,0.65)', marginBottom: ticketHost ? '16px' : '22px' }}>
                {t('affiliate.leaveNotice.body')}
              </p>

              {ticketHost && (
                <div
                  className="flex items-center gap-2.5 mb-5"
                  style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: '4px', padding: '11px 14px', background: 'rgba(255,255,255,0.02)' }}
                >
                  <ExternalLink className="h-4 w-4 shrink-0" style={{ color: '#5A5A5E' }} />
                  <div className="min-w-0">
                    <p className="font-mono uppercase" style={{ fontSize: '9px', color: '#5A5A5E', letterSpacing: '0.14em' }}>
                      {t('affiliate.leaveNotice.destination')}
                    </p>
                    <p className="font-mono truncate" style={{ fontSize: '13px', color: '#FFFFFF', letterSpacing: '0.02em' }}>
                      {ticketHost}
                    </p>
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-2">
                <button
                  onClick={confirmLeave}
                  className="inline-flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
                  style={{ width: '100%', height: 48, borderRadius: '4px', background: '#E8192C', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '14px', fontWeight: 600, boxShadow: '0 8px 24px rgba(232,25,44,0.35)' }}
                >
                  {t('affiliate.leaveNotice.continue')} <ExternalLink className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setShowLeaveNotice(false)}
                  className="hover:opacity-80 transition-opacity"
                  style={{ width: '100%', height: 46, borderRadius: '4px', background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.15)', cursor: 'pointer', fontSize: '14px', fontWeight: 600 }}
                >
                  {t('affiliate.leaveNotice.cancel')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
