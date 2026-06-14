import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { formatInTimeZone } from 'date-fns-tz';
import { fr, es, enUS } from 'date-fns/locale';
import { PARIS_TIMEZONE } from '@/lib/timezone';

interface PromoterInfo {
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
  promoCode: string;
}

interface VenueWithEvents {
  venue_id: string;
  venue_name: string | null;
  venue_logo_url: string | null;
  venue_slug?: string | null;
  events: EventCard[];
}

interface OrganizerWithEvents {
  organizer_id: string;
  organizer_name: string | null;
  organizer_logo_url: string | null;
  organizer_slug?: string | null;
  events: EventCard[];
}

interface EventCard {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  image_url: string | null;
  poster_url: string | null;
  music_genre: string;
  ticketing_enabled: boolean;
  venue_id: string | null;
  organizer_user_id?: string | null;
  partner_organizer_id?: string | null;
}

type EventWithOwner = EventCard & {
  ownerName: string | null;
  ownerLogoUrl: string | null;
  ownerSlug: string | null;
  ownerKind: 'venue' | 'organizer';
};

// ─────────────────────────────────────────────────────────────────────────────
// Icons
// ─────────────────────────────────────────────────────────────────────────────

function IconArrow() {
  return (
    <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 5h6M5 2l3 3-3 3"/>
    </svg>
  );
}

function IconVerified() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-label="Promoteur vérifié" role="img">
      <circle cx="12" cy="12" r="11" fill="#E8192C"/>
      <path d="M7 12.5l3.5 3.5 6.5-7" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Event Card
// ─────────────────────────────────────────────────────────────────────────────

function EventCard({
  event,
  timeLabel,
  onNavigate,
}: {
  event: EventWithOwner;
  timeLabel: string;
  onNavigate: () => void;
}) {
  const live = (() => {
    const now = new Date();
    return new Date(event.start_at) <= now && new Date(event.end_at) >= now;
  })();
  const ctaLabel = event.ticketing_enabled ? 'Billets' : 'Voir';
  const img = event.poster_url || event.image_url;

  return (
    <div
      onClick={onNavigate}
      style={{
        display: 'flex',
        alignItems: 'stretch',
        borderRadius: '10px',
        border: live ? '1px solid rgba(232,25,44,0.45)' : '1px solid rgba(255,255,255,0.08)',
        background: '#141414',
        overflow: 'hidden',
        marginBottom: '10px',
        cursor: 'pointer',
        boxShadow: live ? '0 0 0 1px rgba(232,25,44,0.20)' : 'none',
        transition: 'border-color 250ms ease, transform 250ms cubic-bezier(0.16,1,0.3,1)',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = live ? 'rgba(232,25,44,0.6)' : 'rgba(255,255,255,0.14)';
        (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = live ? 'rgba(232,25,44,0.45)' : 'rgba(255,255,255,0.08)';
        (e.currentTarget as HTMLElement).style.transform = 'translateY(0)';
      }}
    >
      {/* Poster */}
      <div
        style={{
          width: 'clamp(96px, 26vw, 110px)',
          minWidth: 'clamp(96px, 26vw, 110px)',
          position: 'relative',
          overflow: 'hidden',
          background: '#111111',
        }}
      >
        {img ? (
          <img
            src={img}
            alt={event.title}
            loading="lazy"
            style={{ width: '100%', height: '100%', minHeight: '110px', objectFit: 'cover', objectPosition: 'center', display: 'block' }}
          />
        ) : (
          <div style={{ width: '100%', height: '100%', minHeight: '110px', background: 'linear-gradient(160deg, #1a0f12 0%, #3a1020 100%)' }} />
        )}
        {live && (
          <div
            style={{
              position: 'absolute',
              top: '6px',
              left: '6px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '3px 7px',
              borderRadius: '999px',
              background: 'rgba(232,25,44,0.90)',
              backdropFilter: 'blur(6px)',
              WebkitBackdropFilter: 'blur(6px)',
            }}
          >
            <span style={{ position: 'relative', display: 'inline-flex', width: '6px', height: '6px' }}>
              <span style={{ position: 'absolute', inset: 0, borderRadius: '999px', background: '#fff', opacity: 0.75, animation: 'livePing 1.4s cubic-bezier(0,0,0.2,1) infinite' }} />
              <span style={{ position: 'relative', display: 'inline-flex', width: '6px', height: '6px', borderRadius: '999px', background: '#fff' }} />
            </span>
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '8px',
                fontWeight: 800,
                letterSpacing: '0.14em',
                color: '#FFFFFF',
                textTransform: 'uppercase' as const,
              }}
            >
              Live
            </span>
          </div>
        )}
      </div>

      {/* Body */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          padding: '14px 14px 12px',
          gap: '4px',
          minWidth: 0,
        }}
      >
        {/* Owner (venue / organizer) */}
        {event.ownerName && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
            {event.ownerLogoUrl && (
              <img
                src={event.ownerLogoUrl}
                alt=""
                style={{ width: '14px', height: '14px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
              />
            )}
            <p
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 'clamp(11px, 2.8vw, 12px)',
                fontWeight: 600,
                color: '#9A9A9A',
                letterSpacing: '0.08em',
                textTransform: 'uppercase' as const,
                lineHeight: 1,
                margin: 0,
                whiteSpace: 'nowrap' as const,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {event.ownerName}
            </p>
          </div>
        )}

        {/* Title */}
        <h3
          style={{
            fontFamily: "'Space Grotesk', 'Helvetica Neue', Arial, sans-serif",
            fontSize: 'clamp(15px, 4vw, 17px)',
            fontWeight: 700,
            color: '#FFFFFF',
            textTransform: 'uppercase' as const,
            letterSpacing: '-0.005em',
            lineHeight: 1.1,
            whiteSpace: 'nowrap' as const,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            margin: 0,
          }}
        >
          {event.title}
        </h3>

        {/* Time */}
        <p
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 'clamp(11px, 2.8vw, 12px)',
            color: '#5A5A5E',
            letterSpacing: '0.04em',
            lineHeight: 1,
            margin: '2px 0 0',
          }}
        >
          {timeLabel}
        </p>

        {/* Genre + CTA */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 'auto',
            paddingTop: '10px',
            borderTop: '1px solid rgba(255,255,255,0.07)',
          }}
        >
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 'clamp(11px, 2.8vw, 12px)',
              fontWeight: 600,
              color: '#9A9A9A',
              letterSpacing: '0.10em',
              textTransform: 'uppercase' as const,
              whiteSpace: 'nowrap' as const,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {event.music_genre}
          </span>

          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: 'clamp(7px, 1.8vw, 8px) clamp(13px, 3.3vw, 16px)',
              borderRadius: '999px',
              background: '#E8192C',
              color: '#FFFFFF',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 'clamp(11px, 2.8vw, 12px)',
              fontWeight: 700,
              letterSpacing: '0.14em',
              textTransform: 'uppercase' as const,
              whiteSpace: 'nowrap' as const,
              flexShrink: 0,
            }}
          >
            {ctaLabel}
            <IconArrow />
          </span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

export default function PromoterHub() {
  const { promoCode, slug } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { language } = useLanguage();
  const queryRefCode = (searchParams.get('ref') || '').trim();
  const source = (searchParams.get('src') || '').trim();
  const refCode = (promoCode || queryRefCode || '').trim();
  const isLegacyPromoRoute = Boolean(!promoCode && slug && queryRefCode);

  const [venues, setVenues] = useState<VenueWithEvents[]>([]);
  const [organizers, setOrganizers] = useState<OrganizerWithEvents[]>([]);
  const [promoter, setPromoter] = useState<PromoterInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Reset loading state when promo code changes
    setLoading(true);
  }, [refCode]);
  useEffect(() => {
    if (!isLegacyPromoRoute) return;
    const params = new URLSearchParams();
    if (source) params.set('src', source);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    navigate(`/promoteur/${queryRefCode}${suffix}`, { replace: true });
  }, [isLegacyPromoRoute, queryRefCode, source, navigate]);

  useEffect(() => {
    if (!refCode) return;
    (async () => {
      const { data, error } = await supabase.functions.invoke('resolve-promoter-link', {
        body: { promoCode: refCode },
      });
      if (error || !data || data.error) {
        setLoading(false);
        return;
      }

      setPromoter({
        firstName: data.first_name,
        lastName: data.last_name,
        profileImageUrl: data.profile_image_url,
        promoCode: data.promo_code,
      });

      if (data.venues && Array.isArray(data.venues)) {
        setVenues(data.venues);
      } else if (data.venue_id) {
        setVenues([{
          venue_id: data.venue_id,
          venue_name: data.venue_name,
          venue_logo_url: data.venue_logo_url,
          events: [],
        }]);
      }
      if (data.organizers && Array.isArray(data.organizers)) {
        setOrganizers(data.organizers);
      }
      setLoading(false);
    })();
  }, [refCode]);

  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  const formatDateLabel = (dateStr: string) => {
    return formatInTimeZone(new Date(dateStr), PARIS_TIMEZONE, 'EEEE d MMMM', { locale: dateLocale }).toUpperCase();
  };

  const formatTime = (dateStr: string) => {
    return formatInTimeZone(new Date(dateStr), PARIS_TIMEZONE, 'HH:mm');
  };

  const goToEvent = (event: EventWithOwner) => {
    const trackingCode = (promoter?.promoCode || refCode || '').trim().toUpperCase();
    const params = new URLSearchParams();

    if (trackingCode) params.set('ref', trackingCode);
    params.set('event', event.id);
    if (source) params.set('src', source);

    // For venue-scoped events, deep-link to club page
    if (event.venue_id && event.ownerKind === 'venue' && event.ownerSlug) {
      navigate(`/club/${event.ownerSlug}/event/${event.id}?${params.toString()}`);
      return;
    }
    // Organizer-only events → public organizer profile route handles it
    if (event.ownerKind === 'organizer' && event.ownerSlug) {
      navigate(`/o/${event.ownerSlug}?${params.toString()}`);
      return;
    }
    // Fallback: query string-only ticket flow
    navigate(`/?${params.toString()}`);
  };

  const promoterName = promoter?.firstName
    ? `${promoter.firstName} ${promoter.lastName || ''}`.trim()
    : promoter?.promoCode || refCode;

  // Flatten venues + organizers into a single timeline
  const allEvents: EventWithOwner[] = [
    ...venues.flatMap(v =>
      v.events.map(e => ({
        ...e,
        ownerName: v.venue_name,
        ownerLogoUrl: v.venue_logo_url,
        ownerSlug: v.venue_slug || null,
        ownerKind: 'venue' as const,
      }))
    ),
    ...organizers.flatMap(o =>
      o.events.map(e => ({
        ...e,
        ownerName: o.organizer_name,
        ownerLogoUrl: o.organizer_logo_url,
        ownerSlug: o.organizer_slug || null,
        ownerKind: 'organizer' as const,
      }))
    ),
  ].sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());

  // Dedupe by event id (collab events may appear from both sides)
  const seenIds = new Set<string>();
  const dedupedEvents = allEvents.filter(e => {
    if (seenIds.has(e.id)) return false;
    seenIds.add(e.id);
    return true;
  });

  const groupedByDate: Record<string, EventWithOwner[]> = {};
  dedupedEvents.forEach(ev => {
    const key = formatInTimeZone(new Date(ev.start_at), PARIS_TIMEZONE, 'yyyy-MM-dd');
    if (!groupedByDate[key]) groupedByDate[key] = [];
    groupedByDate[key].push(ev);
  });

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0A0A0A' }}>
        <div style={{ maxWidth: '480px', margin: '0 auto', padding: '40px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <div className="skeleton" style={{ width: '96px', height: '96px', borderRadius: '50%' }} />
          <div className="skeleton" style={{ width: '160px', height: '24px', borderRadius: '6px' }} />
          <div className="skeleton" style={{ width: '100px', height: '14px', borderRadius: '6px' }} />
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '16px' }}>
            {[1, 2, 3].map(i => (
              <div key={i} className="skeleton" style={{ width: '100%', height: '110px', borderRadius: '10px' }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Not found ────────────────────────────────────────────────────────────
  if (!promoter) {
    return (
      <div style={{ minHeight: '100vh', background: '#0A0A0A', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', textAlign: 'center' }}>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 800, color: '#E8192C', letterSpacing: '0.16em', fontSize: '18px', marginBottom: '16px' }}>YUNO</span>
        <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", color: '#FFFFFF', fontSize: '24px', fontWeight: 700, margin: '0 0 8px' }}>
          {language === 'fr' ? 'Lien introuvable' : language === 'es' ? 'Enlace no encontrado' : 'Link not found'}
        </h1>
        <p style={{ fontFamily: "'JetBrains Mono', monospace", color: '#5A5A5E', fontSize: '13px', maxWidth: '280px' }}>
          {language === 'fr'
            ? "Ce lien promoteur n'existe pas ou n'est plus actif."
            : language === 'es'
            ? 'Este enlace de promotor no existe o ya no está activo.'
            : 'This promoter link does not exist or is no longer active.'}
        </p>
      </div>
    );
  }

  return (
    <>
      <div
        style={{
          minHeight: '100vh',
          background: '#0A0A0A',
          fontFamily: "'Inter', system-ui, sans-serif",
          WebkitFontSmoothing: 'antialiased',
        }}
      >
        {/* Glow */}
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            top: '-120px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '600px',
            height: '400px',
            background: 'radial-gradient(ellipse at center, rgba(232,25,44,0.11) 0%, transparent 70%)',
            pointerEvents: 'none',
            zIndex: 0,
          }}
        />

        <main style={{ position: 'relative', zIndex: 1, maxWidth: '480px', margin: '0 auto', paddingBottom: '120px' }}>

          {/* ══ PROFIL PROMOTEUR ═════════════════════════════════════ */}
          <section
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '14px',
              padding: '48px 24px 28px',
            }}
            aria-label="Profil promoteur"
          >
            {/* Avatar */}
            {promoter.profileImageUrl ? (
              <img
                src={promoter.profileImageUrl}
                alt={promoterName}
                style={{
                  width: 'clamp(80px, 22vw, 96px)',
                  height: 'clamp(80px, 22vw, 96px)',
                  borderRadius: '50%',
                  objectFit: 'cover',
                  border: '2px solid rgba(255,255,255,0.14)',
                  boxShadow: '0 0 0 4px rgba(232,25,44,0.10)',
                }}
              />
            ) : (
              <div
                style={{
                  width: 'clamp(80px, 22vw, 96px)',
                  height: 'clamp(80px, 22vw, 96px)',
                  borderRadius: '50%',
                  border: '2px solid rgba(255,255,255,0.14)',
                  boxShadow: '0 0 0 4px rgba(232,25,44,0.10)',
                  background: 'linear-gradient(135deg, #1B1B1E 0%, #222226 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: "'Space Grotesk', sans-serif",
                  fontSize: '28px',
                  fontWeight: 700,
                  color: '#E5E5E5',
                }}
                aria-hidden="true"
              >
                {(promoter.firstName?.[0] || promoter.promoCode[0] || '?').toUpperCase()}
              </div>
            )}

            {/* Nom + rôle */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h1
                  style={{
                    fontFamily: "'Space Grotesk', 'Helvetica Neue', Arial, sans-serif",
                    fontSize: 'clamp(20px, 5.5vw, 26px)',
                    fontWeight: 700,
                    color: '#FFFFFF',
                    letterSpacing: '-0.01em',
                    textTransform: 'uppercase' as const,
                    textAlign: 'center' as const,
                    margin: 0,
                  }}
                >
                  {promoterName}
                </h1>
                <IconVerified />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#E8192C' }} />
                <span
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 'clamp(11px, 2.8vw, 12px)',
                    fontWeight: 500,
                    letterSpacing: '0.16em',
                    color: '#5A5A5E',
                    textTransform: 'uppercase' as const,
                  }}
                >
                  @{promoter.promoCode}
                </span>
              </div>
            </div>

            {/* Venue badges */}
            {venues.length > 0 && (
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
                {venues.map(v => (
                  <div
                    key={v.venue_id}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '7px',
                      padding: '6px 12px 6px 8px',
                      borderRadius: '999px',
                      border: '1px solid rgba(255,255,255,0.14)',
                      background: '#141414',
                    }}
                  >
                    {v.venue_logo_url && (
                      <img
                        src={v.venue_logo_url}
                        alt={v.venue_name || ''}
                        style={{ width: '16px', height: '16px', borderRadius: '50%', objectFit: 'cover' }}
                      />
                    )}
                    <span
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: '11px',
                        fontWeight: 500,
                        letterSpacing: '0.06em',
                        color: '#E5E5E5',
                        textTransform: 'uppercase' as const,
                        whiteSpace: 'nowrap' as const,
                      }}
                    >
                      {v.venue_name}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Divider */}
          <div style={{ margin: '0 24px', height: '1px', background: 'rgba(255,255,255,0.08)' }} />

          {/* ══ ÉVÉNEMENTS ═══════════════════════════════════════════ */}
          <section style={{ padding: '8px 20px 0' }} aria-label="Événements">
            {dedupedEvents.length === 0 ? (
              <p
                style={{
                  textAlign: 'center',
                  color: '#5A5A5E',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '12px',
                  letterSpacing: '0.06em',
                  padding: '40px 0',
                }}
              >
                {language === 'fr'
                  ? 'Aucune soirée pour le moment.'
                  : language === 'es'
                  ? 'Ningún evento por el momento.'
                  : 'No upcoming events.'}
              </p>
            ) : (
              Object.entries(groupedByDate).map(([dateKey, events]) => (
                <div key={dateKey}>
                  {/* Séparateur date */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: '10px',
                      paddingBottom: '10px',
                      borderBottom: '1px solid rgba(255,255,255,0.07)',
                      margin: '28px 0 14px',
                    }}
                  >
                    <h2
                      style={{
                        fontFamily: "'Space Grotesk', 'Helvetica Neue', Arial, sans-serif",
                        fontSize: 'clamp(17px, 4.5vw, 20px)',
                        fontWeight: 700,
                        color: '#FFFFFF',
                        textTransform: 'uppercase' as const,
                        letterSpacing: '-0.01em',
                        lineHeight: 1,
                        margin: 0,
                      }}
                    >
                      {formatDateLabel(events[0].start_at)}
                    </h2>
                    <span
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: '10px',
                        color: '#3A3A3E',
                        letterSpacing: '0.14em',
                        textTransform: 'uppercase' as const,
                      }}
                    >
                      {events.length} EVENT{events.length !== 1 ? 'S' : ''}
                    </span>
                  </div>

                  {/* Event cards */}
                  {events.map((ev) => (
                    <EventCard
                      key={ev.id}
                      event={ev}
                      timeLabel={`${formatTime(ev.start_at)} - ${formatTime(ev.end_at)}`}
                      onNavigate={() => goToEvent(ev)}
                    />
                  ))}
                </div>
              ))
            )}
          </section>

          {/* ══ CTA ══════════════════════════════════════════════════ */}
          <div style={{ padding: '32px 20px 0', display: 'flex', justifyContent: 'center' }}>
            <button
              onClick={() => navigate('/')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '10px',
                padding: 'clamp(13px, 3.5vw, 16px) clamp(24px, 6vw, 32px)',
                borderRadius: '999px',
                background: 'linear-gradient(135deg, #E8192C 0%, #c0121f 100%)',
                color: '#FFFFFF',
                fontFamily: "'Space Grotesk', 'Helvetica Neue', Arial, sans-serif",
                fontSize: 'clamp(14px, 3.5vw, 15px)',
                fontWeight: 700,
                letterSpacing: '0.04em',
                textTransform: 'uppercase' as const,
                border: 'none',
                boxShadow: '0 4px 20px rgba(232,25,44,0.35)',
                cursor: 'pointer',
                transition: 'transform 200ms ease, box-shadow 200ms ease',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)';
                (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 28px rgba(232,25,44,0.45)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.transform = 'translateY(0)';
                (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 20px rgba(232,25,44,0.35)';
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="18" rx="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
              {language === 'fr' ? 'Voir plus de soirées' : language === 'es' ? 'Ver más eventos' : 'See more events'}
              <IconArrow />
            </button>
          </div>

        </main>

        {/* ══ STICKY POWERED BY YUNO ══════════════════════════════ */}
        <a
          href="https://yunoapp.eu"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Propulsé par Yuno"
          style={{
            position: 'fixed',
            bottom: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 100,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '14px',
            padding: '12px 20px',
            borderRadius: '999px',
            background: 'rgba(14,14,14,0.88)',
            backdropFilter: 'blur(18px)',
            WebkitBackdropFilter: 'blur(18px)',
            border: '1px solid rgba(255,255,255,0.10)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.55)',
            textDecoration: 'none',
            cursor: 'pointer',
            whiteSpace: 'nowrap' as const,
          }}
        >
          <span
            style={{
              fontFamily: "'Inter', system-ui, sans-serif",
              fontSize: '13px',
              fontWeight: 400,
              color: 'rgba(255,255,255,0.55)',
              letterSpacing: '0.01em',
            }}
          >
            Powered by
          </span>
          <span
            style={{
              fontFamily: "'Space Grotesk', 'Helvetica Neue', Arial, sans-serif",
              fontSize: '13px',
              fontWeight: 800,
              color: '#FFFFFF',
              letterSpacing: '0.06em',
              textTransform: 'uppercase' as const,
              background: '#E8192C',
              padding: '5px 10px',
              borderRadius: '8px',
              lineHeight: 1,
            }}
          >
            YUNO
          </span>
        </a>

      </div>

      <style>{`
        @keyframes livePing {
          75%, 100% { transform: scale(2); opacity: 0; }
        }
      `}</style>
    </>
  );
}
