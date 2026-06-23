import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { useAffiliateVisitorTracking, trackAffiliateClick } from '@/hooks/useAffiliateVisitorTracking';
import { format, type Locale } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { FadeInView } from '@/components/motion';

type DayFilter = 'today' | 'tomorrow' | 'weekend' | null;
type PriceFilter = 'free' | 'paid' | null;
type SortMode = 'by_day' | 'by_genre' | 'by_price' | 'custom';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type TrustStat = { value: string; label: string };

type OrgProfile = {
  id: string;
  name: string;
  city: string | null;
  type: string;
  avatar_url: string | null;
  instagram: string | null;
  tiktok: string | null;
  website: string | null;
  whatsapp: string | null;
  trust_stats: TrustStat[];
  promoter_social_mode: 'promoter' | 'agency';
  allow_promoter_sort: boolean;
  linktree_sort_mode: SortMode;
};

type MemberProfile = {
  id: string;
  user_id: string | null;
  first_name: string | null;
  last_name: string | null;
  linktree_slug: string | null;
  avatar_url: string | null;
  instagram: string | null;
  tiktok: string | null;
  affiliate_id: string;
  linktree_sort_mode: SortMode | null;
  org: OrgProfile | null;
};

type LinktreeEvent = {
  row_id: string;
  affiliate_event_id: string;
  promo_link: string | null;
  sort_order: number;
  name: string;
  slug: string;
  event_date: string;
  start_time: string | null;
  flyer_url: string | null;
  price_from: number | null;
  is_free: boolean;
  is_sold_out: boolean;
  external_ticket_url: string | null;
  genres: string[];
  venue_name: string | null;
};

type GroupedDate = {
  date: string;
  label: string;
  items: LinktreeEvent[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Icons
// ─────────────────────────────────────────────────────────────────────────────

function IconInstagram() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
      <circle cx="12" cy="12" r="4"/>
      <circle cx="17.5" cy="6.5" r="0.5" fill="currentColor" stroke="none"/>
    </svg>
  );
}

function IconTikTok() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.18 8.18 0 0 0 4.78 1.52V6.76a4.85 4.85 0 0 1-1.01-.07z"/>
    </svg>
  );
}

function IconWhatsApp() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/>
    </svg>
  );
}

function IconGlobe() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10"/>
      <line x1="2" y1="12" x2="22" y2="12"/>
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
    </svg>
  );
}

function IconArrow() {
  return (
    <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 5h6M5 2l3 3-3 3"/>
    </svg>
  );
}

function PartnerBadge() {
  const { t } = useLanguage();
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '5px 10px 5px 7px',
        borderRadius: '999px',
        border: '1px solid rgba(232,25,44,0.25)',
        background: 'rgba(232,25,44,0.07)',
      }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="11" fill="#E8192C"/>
        <path d="M7 12.5l3.5 3.5 6.5-7" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      <span
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '10px',
          fontWeight: 700,
          letterSpacing: '0.14em',
          color: '#E8192C',
          textTransform: 'uppercase' as const,
        }}
      >
        {t('promoterLinktree.officialPartner')}
      </span>
    </div>
  );
}

function getWeekendDates(): string[] {
  const dates: string[] = [];
  const now = new Date();
  for (let offset = 0; offset <= 7; offset++) {
    const d = new Date(now);
    d.setDate(now.getDate() + offset);
    const dow = d.getDay();
    if (dow === 5 || dow === 6 || dow === 0) {
      dates.push(d.toISOString().split('T')[0]);
    }
    if (dates.length >= 3) break;
  }
  return dates;
}

function LinktreeFilters({
  allGenres,
  dayFilter, setDayFilter,
  genreFilter, setGenreFilter,
  priceFilter, setPriceFilter,
}: {
  allGenres: string[];
  dayFilter: DayFilter; setDayFilter: (v: DayFilter) => void;
  genreFilter: string | null; setGenreFilter: (v: string | null) => void;
  priceFilter: PriceFilter; setPriceFilter: (v: PriceFilter) => void;
}) {
  const { t } = useLanguage();
  if (allGenres.length === 0) return null;

  const chipStyle = (active: boolean): React.CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    padding: '6px 13px',
    borderRadius: '999px',
    border: active ? '1px solid #E8192C' : '1px solid rgba(255,255,255,0.10)',
    background: active ? 'rgba(232,25,44,0.12)' : 'rgba(255,255,255,0.04)',
    color: active ? '#E8192C' : '#9A9A9A',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: '0.10em',
    textTransform: 'uppercase' as const,
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
    flexShrink: 0,
    transition: 'all 150ms ease',
    userSelect: 'none' as const,
  });

  return (
    <div style={{ padding: '16px 20px 0', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ display: 'flex', gap: '7px', overflowX: 'auto', paddingBottom: '4px' }} role="group" aria-label={t('promoterLinktree.filterByDay')}>
        {(['today', 'tomorrow', 'weekend'] as const).map((d) => (
          <button key={d} onClick={() => setDayFilter(dayFilter === d ? null : d)} style={chipStyle(dayFilter === d)}>
            {d === 'today' ? t('promoterLinktree.today') : d === 'tomorrow' ? t('promoterLinktree.tomorrow') : t('promoterLinktree.thisWeekend')}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '7px', overflowX: 'auto', paddingBottom: '4px' }} role="group" aria-label={t('promoterLinktree.filterByGenrePrice')}>
        <button onClick={() => setPriceFilter(priceFilter === 'free' ? null : 'free')} style={chipStyle(priceFilter === 'free')}>{t('promoterLinktree.free')}</button>
        <button onClick={() => setPriceFilter(priceFilter === 'paid' ? null : 'paid')} style={chipStyle(priceFilter === 'paid')}>{t('promoterLinktree.paid')}</button>
        {allGenres.slice(0, 5).map((g) => (
          <button key={g} onClick={() => setGenreFilter(genreFilter === g ? null : g)} style={chipStyle(genreFilter === g)}>{g}</button>
        ))}
      </div>
    </div>
  );
}

function IconVerified() {
  const { t } = useLanguage();
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-label={t('promoterLinktree.verified')} role="img">
      <circle cx="12" cy="12" r="11" fill="#E8192C"/>
      <path d="M7 12.5l3.5 3.5 6.5-7" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Trust Slider
// ─────────────────────────────────────────────────────────────────────────────

function TrustSlider({ stats }: { stats: TrustStat[] }) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (stats.length <= 1) return;
    const id = setInterval(() => setActive((p) => (p + 1) % stats.length), 3000);
    return () => clearInterval(id);
  }, [stats.length]);

  if (stats.length === 0) return null;

  const stat = stats[active];

  return (
    <div
      style={{
        margin: '0 20px',
        borderRadius: '12px',
        border: '1px solid rgba(232,25,44,0.18)',
        background: 'rgba(232,25,44,0.05)',
        padding: '16px 20px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '6px',
      }}
    >
      <div
        key={active}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '4px',
          animation: 'fadeSlide 0.4s ease',
        }}
      >
        <span
          style={{
            fontFamily: "'Space Grotesk', 'Helvetica Neue', Arial, sans-serif",
            fontSize: 'clamp(28px, 7.5vw, 34px)',
            fontWeight: 700,
            color: '#E8192C',
            letterSpacing: '-0.02em',
            lineHeight: 1,
          }}
        >
          {stat.value}
        </span>
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 'clamp(11px, 3vw, 13px)',
            letterSpacing: '0.12em',
            color: '#9A9A9A',
            textTransform: 'uppercase' as const,
          }}
        >
          {stat.label}
        </span>
      </div>

      {stats.length > 1 && (
        <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
          {stats.map((_, i) => (
            <button
              key={i}
              onClick={() => setActive(i)}
              aria-label={`Stat ${i + 1}`}
              style={{
                width: i === active ? '18px' : '6px',
                height: '6px',
                borderRadius: '999px',
                background: i === active ? '#E8192C' : 'rgba(255,255,255,0.15)',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                transition: 'width 300ms ease, background 300ms ease',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Social Button
// ─────────────────────────────────────────────────────────────────────────────

function SocialButton({
  href,
  label,
  icon,
  isWhatsApp,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  isWhatsApp?: boolean;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        padding: 'clamp(10px, 2.6vw, 12px) clamp(16px, 4vw, 20px)',
        borderRadius: '999px',
        border: isWhatsApp ? '1px solid rgba(37,211,102,0.20)' : '1px solid rgba(255,255,255,0.14)',
        background: isWhatsApp ? 'rgba(37,211,102,0.08)' : '#141414',
        color: isWhatsApp ? '#25D366' : '#E5E5E5',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 'clamp(12px, 3vw, 13px)',
        fontWeight: 500,
        letterSpacing: '0.10em',
        textTransform: 'uppercase' as const,
        textDecoration: 'none',
        cursor: 'pointer',
        transition: 'background 200ms ease, border-color 200ms ease',
        whiteSpace: 'nowrap' as const,
      }}
    >
      {icon}
      {label}
    </a>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Event Card
// ─────────────────────────────────────────────────────────────────────────────

function EventCard({
  event,
  affiliateId,
  memberId,
  isOwner,
  onNavigate,
}: {
  event: LinktreeEvent;
  affiliateId: string;
  memberId: string;
  isOwner: boolean;
  onNavigate: () => void;
}) {
  const isSoldOut = event.is_sold_out;
  const isFree = event.is_free;

  const priceLabel = isSoldOut
    ? 'Complet'
    : isFree
    ? 'Gratuit'
    : event.price_from != null
    ? `${event.price_from}€`
    : null;

  const ctaLabel = isSoldOut ? 'Complet' : isFree ? 'Rejoindre' : 'Billets';
  const ctaHref = event.promo_link || (event.external_ticket_url ? event.external_ticket_url : null);

  const handleClick = () => {
    if (isSoldOut) return;
    trackAffiliateClick({
      affiliateId,
      affiliateEventId: event.affiliate_event_id,
      affiliateMemberId: memberId,
      isInternal: isOwner,
    });
    if (ctaHref) {
      window.open(ctaHref, '_blank', 'noopener,noreferrer');
    } else {
      onNavigate();
    }
  };

  // Le hover (lift + bordure) ne s'applique que sur appareils hover-capable,
  // sinon il reste figé après un tap sur tactile.
  const canHover = typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;

  return (
    <div
      onClick={handleClick}
      style={{
        display: 'flex',
        alignItems: 'stretch',
        borderRadius: '10px',
        border: '1px solid rgba(255,255,255,0.08)',
        background: '#141414',
        overflow: 'hidden',
        marginBottom: '10px',
        opacity: isSoldOut ? 0.55 : 1,
        cursor: isSoldOut ? 'default' : 'pointer',
        transition: 'border-color 250ms ease, transform 250ms cubic-bezier(0.16,1,0.3,1)',
      }}
      onMouseEnter={(e) => {
        if (isSoldOut || !canHover) return;
        (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.14)';
        (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(e) => {
        if (!canHover) return;
        (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.08)';
        (e.currentTarget as HTMLElement).style.transform = 'translateY(0)';
      }}
    >
      {/* Flyer image */}
      <div
        style={{
          width: 'clamp(96px, 26vw, 110px)',
          minWidth: 'clamp(96px, 26vw, 110px)',
          position: 'relative',
          overflow: 'hidden',
          background: '#111111',
        }}
      >
        {event.flyer_url ? (
          <img
            src={event.flyer_url}
            alt={event.name}
            style={{ width: '100%', height: '100%', minHeight: '110px', objectFit: 'cover', objectPosition: 'top', display: 'block' }}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              minHeight: '110px',
              background: 'linear-gradient(160deg, #1a0f12 0%, #3a1020 100%)',
            }}
          />
        )}
        {event.promo_link && !isSoldOut && (
          <div
            style={{
              position: 'absolute',
              bottom: '6px',
              left: '50%',
              transform: 'translateX(-50%)',
              whiteSpace: 'nowrap' as const,
              padding: '3px 7px',
              borderRadius: '999px',
              background: 'rgba(232,25,44,0.10)',
              border: '1px solid rgba(232,25,44,0.25)',
              backdropFilter: 'blur(6px)',
              WebkitBackdropFilter: 'blur(6px)',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '8px',
              fontWeight: 700,
              letterSpacing: '0.10em',
              textTransform: 'uppercase' as const,
              color: '#E8192C',
            }}
          >
            Achat direct
          </div>
        )}
        {isSoldOut && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(0,0,0,0.60)',
            }}
          >
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '9px',
                fontWeight: 800,
                letterSpacing: '0.16em',
                color: '#FFFFFF',
                background: 'rgba(232,25,44,0.90)',
                padding: '4px 8px',
                borderRadius: '4px',
                textTransform: 'uppercase' as const,
              }}
            >
              COMPLET
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
        {/* Venue */}
        {event.venue_name && (
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
            }}
          >
            {event.venue_name}
          </p>
        )}

        {/* Event name */}
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
          {event.name}
        </h3>

        {/* Time */}
        {event.start_time && (
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
            {event.start_time.slice(0, 5)}
          </p>
        )}

        {/* Price + CTA */}
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
              fontSize: 'clamp(12px, 3vw, 13px)',
              fontWeight: 700,
              color: isSoldOut ? '#5A5A5E' : '#E8192C',
              letterSpacing: '0.04em',
              textDecoration: isSoldOut ? 'line-through' : 'none',
            }}
          >
            {priceLabel}
          </span>

          {isSoldOut ? (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: 'clamp(7px, 1.8vw, 8px) clamp(13px, 3.3vw, 16px)',
                borderRadius: '999px',
                background: 'rgba(255,255,255,0.06)',
                color: '#5A5A5E',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 'clamp(11px, 2.8vw, 12px)',
                fontWeight: 700,
                letterSpacing: '0.14em',
                textTransform: 'uppercase' as const,
              }}
            >
              {ctaLabel}
            </span>
          ) : (
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
              }}
            >
              {ctaLabel}
              <IconArrow />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Skeletons / états d'erreur
// ─────────────────────────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div style={{ minHeight: '100vh', background: '#0A0A0A' }}>
      <div className="marquee-strip" />
      <div style={{ maxWidth: '480px', margin: '0 auto', padding: '40px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
        <div className="skeleton" style={{ width: '80px', height: '80px', borderRadius: '50%' }} />
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

function NotFoundState() {
  return (
    <div style={{ minHeight: '100vh', background: '#0A0A0A', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', textAlign: 'center' }}>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 800, color: '#E8192C', letterSpacing: '0.16em', fontSize: '18px', marginBottom: '16px' }}>YUNO</span>
      <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", color: '#FFFFFF', fontSize: '24px', fontWeight: 700, margin: '0 0 8px' }}>Page introuvable</h1>
      <p style={{ fontFamily: "'JetBrains Mono', monospace", color: '#5A5A5E', fontSize: '13px', maxWidth: '280px' }}>
        Ce lien promoteur n&apos;existe pas ou n&apos;est pas encore actif.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper : groupe les événements par date
// ─────────────────────────────────────────────────────────────────────────────

function groupByDate(events: LinktreeEvent[], locale: Locale): GroupedDate[] {
  const map = new Map<string, LinktreeEvent[]>();
  for (const ev of events) {
    const key = ev.event_date;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(ev);
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, items]) => {
      const [y, m, d] = date.split('-').map(Number);
      const dateObj = new Date(y, m - 1, d);
      const label = format(dateObj, 'EEEE d MMMM', { locale }).toUpperCase();
      return { date, label, items };
    });
}

function sortAndGroupEvents(events: LinktreeEvent[], mode: SortMode, locale: Locale): GroupedDate[] {
  switch (mode) {
    case 'by_genre': {
      const map = new Map<string, LinktreeEvent[]>();
      for (const ev of events) {
        const genre = ev.genres[0] ?? 'Autre';
        if (!map.has(genre)) map.set(genre, []);
        map.get(genre)!.push(ev);
      }
      return Array.from(map.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([genre, items]) => ({
          date: genre,
          label: genre.toUpperCase(),
          items: items.sort((a, b) => a.event_date.localeCompare(b.event_date)),
        }));
    }
    case 'by_price': {
      const sorted = [...events].sort((a, b) => {
        const pa = a.is_free ? -1 : (a.price_from ?? 9999);
        const pb = b.is_free ? -1 : (b.price_from ?? 9999);
        return pa - pb;
      });
      return [{ date: '__price__', label: 'PAR PRIX', items: sorted }];
    }
    case 'custom':
      return [{ date: '__custom__', label: '', items: events }];
    case 'by_day':
    default:
      return groupByDate(events, locale);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

export default function PromoterLinktree() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { language, t } = useLanguage();
  const { user } = useAuth();
  const [member, setMember] = useState<MemberProfile | null>(null);
  const [events, setEvents] = useState<LinktreeEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const isOwner = !!(user?.id && member?.user_id && user.id === member.user_id);

  useAffiliateVisitorTracking({
    affiliateId: member?.affiliate_id ?? '',
    affiliateMemberId: member?.id,
    isOwner,
  });

  const [dayFilter, setDayFilter] = useState<DayFilter>(null);
  const [genreFilter, setGenreFilter] = useState<string | null>(null);
  const [priceFilter, setPriceFilter] = useState<PriceFilter>(null);

  useEffect(() => {
    if (slug) fetchPage();
  }, [slug]);

  const fetchPage = async () => {
    try {
      setLoading(true);

      const { data: mem, error: memError } = await supabase
        .from('affiliate_members')
        .select('id, user_id, first_name, last_name, linktree_slug, avatar_url, instagram, tiktok, affiliate_id, linktree_sort_mode')
        .eq('linktree_slug', slug!.toLowerCase())
        .eq('is_active', true)
        .maybeSingle();

      if (memError) throw memError;
      if (!mem) { setNotFound(true); setLoading(false); return; }

      const { data: org } = await supabase
        .from('affiliates')
        .select('id, name, city, type, avatar_url, instagram, tiktok, website, whatsapp, trust_stats, promoter_social_mode, allow_promoter_sort, linktree_sort_mode')
        .eq('id', (mem as any).affiliate_id)
        .maybeSingle();

      const memberData: MemberProfile = {
        id: (mem as any).id,
        user_id: (mem as any).user_id ?? null,
        first_name: (mem as any).first_name ?? null,
        last_name: (mem as any).last_name ?? null,
        linktree_slug: (mem as any).linktree_slug ?? null,
        avatar_url: (mem as any).avatar_url ?? null,
        instagram: (mem as any).instagram ?? null,
        tiktok: (mem as any).tiktok ?? null,
        affiliate_id: (mem as any).affiliate_id,
        linktree_sort_mode: (mem as any).linktree_sort_mode ?? null,
        org: org ? {
          id: (org as any).id,
          name: (org as any).name,
          city: (org as any).city ?? null,
          type: (org as any).type ?? 'independent',
          avatar_url: (org as any).avatar_url ?? null,
          instagram: (org as any).instagram ?? null,
          tiktok: (org as any).tiktok ?? null,
          website: (org as any).website ?? null,
          whatsapp: (org as any).whatsapp ?? null,
          trust_stats: Array.isArray((org as any).trust_stats) ? (org as any).trust_stats : [],
          promoter_social_mode: (org as any).promoter_social_mode ?? 'promoter',
          allow_promoter_sort: (org as any).allow_promoter_sort ?? false,
          linktree_sort_mode: (org as any).linktree_sort_mode ?? 'by_day',
        } : null,
      };

      setMember(memberData);

      const today = new Date().toISOString().split('T')[0];
      const { data: linktreeRows, error: linktreeError } = await supabase
        .from('promoter_linktree_events')
        .select('id, affiliate_event_id, promo_link, sort_order, affiliate_events(id, name, slug, event_date, start_time, flyer_url, price_from, is_free, is_sold_out, external_ticket_url, genres, affiliate_venues(name))')
        .eq('member_id', memberData.id)
        .order('sort_order', { ascending: true });

      if (linktreeError) throw linktreeError;

      const mapped: LinktreeEvent[] = (linktreeRows ?? [])
        .filter((row: any) => {
          const ev = row.affiliate_events;
          return ev && ev.event_date >= today;
        })
        .map((row: any) => {
          const ev = row.affiliate_events;
          const venueRaw = ev.affiliate_venues;
          const venue = Array.isArray(venueRaw) ? venueRaw[0] ?? null : venueRaw ?? null;
          return {
            row_id: row.id,
            affiliate_event_id: row.affiliate_event_id,
            promo_link: row.promo_link ?? null,
            sort_order: row.sort_order ?? 0,
            name: ev.name ?? '',
            slug: ev.slug ?? '',
            event_date: ev.event_date ?? '',
            start_time: ev.start_time ?? null,
            flyer_url: ev.flyer_url ?? null,
            price_from: ev.price_from ?? null,
            is_free: ev.is_free ?? false,
            is_sold_out: ev.is_sold_out ?? false,
            external_ticket_url: ev.external_ticket_url ?? null,
            genres: Array.isArray(ev.genres) ? ev.genres : [],
            venue_name: venue?.name ?? null,
          };
        });

      setEvents(mapped);
      setLoading(false);
    } catch (err: any) {
      console.error('[PromoterLinktree] fetchPage error:', err);
      setFetchError(err?.message ?? String(err));
      setLoading(false);
    }
  };

  if (loading) return <LoadingSkeleton />;
  if (fetchError) return (
    <div style={{ minHeight: '100vh', background: '#0A0A0A', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 800, color: '#E8192C', letterSpacing: '0.16em' }}>YUNO</span>
      <p style={{ color: '#ef4444', fontFamily: "'JetBrains Mono', monospace", fontSize: '12px', maxWidth: '320px', textAlign: 'center', wordBreak: 'break-all' }}>{fetchError}</p>
    </div>
  );
  if (notFound) return <NotFoundState />;
  if (!member) return null;

  const org = member.org;
  const isYunoInternal = org?.type === 'yuno_internal';
  const useAgencySocialLinks = org?.promoter_social_mode === 'agency';
  const displayName = [member.first_name, member.last_name].filter(Boolean).join(' ') || 'Promoteur';
  const trustStats: TrustStat[] = org?.trust_stats ?? [];
  const allGenres = Array.from(new Set(events.flatMap(e => e.genres))).sort();
  const todayStr = new Date().toISOString().split('T')[0];
  const tomorrowStr = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const weekendDates = getWeekendDates();

  const filteredEvents = events.filter(ev => {
    if (dayFilter === 'today' && ev.event_date !== todayStr) return false;
    if (dayFilter === 'tomorrow' && ev.event_date !== tomorrowStr) return false;
    if (dayFilter === 'weekend' && !weekendDates.includes(ev.event_date)) return false;
    if (genreFilter && !ev.genres.includes(genreFilter)) return false;
    if (priceFilter === 'free' && !ev.is_free) return false;
    if (priceFilter === 'paid' && ev.is_free) return false;
    return true;
  });

  const effectiveSortMode: SortMode =
    (org?.allow_promoter_sort && member.linktree_sort_mode)
      ? member.linktree_sort_mode
      : (org?.linktree_sort_mode ?? 'by_day');
  const grouped = sortAndGroupEvents(filteredEvents, effectiveSortMode, dateLocale);

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

          {/* ══ HEADER ══════════════════════════════════════════════ */}
          {isYunoInternal ? (
            /* — YUNO Header — */
            <header
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                padding: '40px 24px 32px',
                gap: '20px',
              }}
            >
              {/* Logo + wordmark */}
              <a
                href="https://yunoapp.eu"
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', textDecoration: 'none' }}
                aria-label={org?.name ?? 'Yuno'}
              >
                <img
                  src="/yuno-icon-192.png"
                  alt={org?.name ?? 'Yuno'}
                  style={{
                    width: 'clamp(52px, 14vw, 64px)',
                    height: 'clamp(52px, 14vw, 64px)',
                    borderRadius: '14px',
                    display: 'block',
                    objectFit: 'cover',
                  }}
                />
                <span
                  style={{
                    fontFamily: "'Space Grotesk', 'Helvetica Neue', Arial, sans-serif",
                    fontSize: 'clamp(12px, 3.2vw, 14px)',
                    fontWeight: 700,
                    letterSpacing: '0.22em',
                    color: '#9A9A9A',
                    textTransform: 'uppercase' as const,
                  }}
                >
                  {org?.name ?? 'YUNO'}
                </span>
              </a>

              {/* Social links de l'org YUNO — seulement en mode agence */}
              {useAgencySocialLinks && (org?.instagram || org?.tiktok || org?.website || org?.whatsapp) && (
                <nav
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', width: '100%' }}
                  aria-label={`${t('promoterLinktree.socialOf')} ${org?.name ?? 'Yuno'}`}
                >
                  {(org?.instagram || org?.tiktok) && (
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
                      {org?.instagram && (
                        <SocialButton
                          href={`https://instagram.com/${org.instagram.replace('@', '')}`}
                          label={org.instagram.replace('@', '')}
                          icon={<IconInstagram />}
                        />
                      )}
                      {org?.tiktok && (
                        <SocialButton
                          href={`https://tiktok.com/@${org.tiktok.replace('@', '')}`}
                          label={org.tiktok.replace('@', '')}
                          icon={<IconTikTok />}
                        />
                      )}
                    </div>
                  )}
                  {(org?.website || org?.whatsapp) && (
                    <div style={{ display: 'flex', gap: '8px', width: '100%', justifyContent: 'center' }}>
                      {org?.website && (
                        <SocialButton
                          href={org.website.startsWith('http') ? org.website : `https://${org.website}`}
                          label="Site web"
                          icon={<IconGlobe />}
                        />
                      )}
                      {org?.whatsapp && (
                        <SocialButton
                          href={org.whatsapp.startsWith('http') ? org.whatsapp : `https://wa.me/${org.whatsapp.replace(/[^0-9]/g, '')}`}
                          label={t('promoterLinktree.community')}
                          icon={<IconWhatsApp />}
                          isWhatsApp
                        />
                      )}
                    </div>
                  )}
                </nav>
              )}
            </header>
          ) : (
            /* — Agency Header — */
            <header
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                padding: '40px 24px 32px',
                gap: '20px',
              }}
            >
              {/* Agency logo + name */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                {org?.avatar_url ? (
                  <img
                    src={org.avatar_url}
                    alt={org.name}
                    style={{
                      width: 'clamp(52px, 14vw, 64px)',
                      height: 'clamp(52px, 14vw, 64px)',
                      borderRadius: '14px',
                      objectFit: 'cover',
                      display: 'block',
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: 'clamp(52px, 14vw, 64px)',
                      height: 'clamp(52px, 14vw, 64px)',
                      borderRadius: '14px',
                      background: 'linear-gradient(135deg, #1B1B1E 0%, #222226 100%)',
                      border: '1px solid rgba(255,255,255,0.10)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "'Space Grotesk', sans-serif",
                        fontSize: '22px',
                        fontWeight: 700,
                        color: '#E5E5E5',
                      }}
                    >
                      {(org?.name ?? 'A')[0].toUpperCase()}
                    </span>
                  </div>
                )}
                <span
                  style={{
                    fontFamily: "'Space Grotesk', 'Helvetica Neue', Arial, sans-serif",
                    fontSize: 'clamp(12px, 3.2vw, 14px)',
                    fontWeight: 700,
                    letterSpacing: '0.22em',
                    color: '#9A9A9A',
                    textTransform: 'uppercase' as const,
                    textAlign: 'center' as const,
                  }}
                >
                  {org?.name ?? ''}
                </span>
              </div>

              {/* Social links de l'agence externe — seulement en mode agence */}
              {useAgencySocialLinks && (org?.instagram || org?.tiktok || org?.website || org?.whatsapp) && (
                <nav
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', width: '100%' }}
                  aria-label={`${t('promoterLinktree.socialOf')} ${org?.name ?? ''}`}
                >
                  {(org?.instagram || org?.tiktok) && (
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
                      {org?.instagram && (
                        <SocialButton
                          href={`https://instagram.com/${org.instagram.replace('@', '')}`}
                          label={org.instagram.replace('@', '')}
                          icon={<IconInstagram />}
                        />
                      )}
                      {org?.tiktok && (
                        <SocialButton
                          href={`https://tiktok.com/@${org.tiktok.replace('@', '')}`}
                          label={org.tiktok.replace('@', '')}
                          icon={<IconTikTok />}
                        />
                      )}
                    </div>
                  )}
                  {(org?.website || org?.whatsapp) && (
                    <div style={{ display: 'flex', gap: '8px', width: '100%', justifyContent: 'center' }}>
                      {org?.website && (
                        <SocialButton
                          href={org.website.startsWith('http') ? org.website : `https://${org.website}`}
                          label="Site web"
                          icon={<IconGlobe />}
                        />
                      )}
                      {org?.whatsapp && (
                        <SocialButton
                          href={org.whatsapp.startsWith('http') ? org.whatsapp : `https://wa.me/${org.whatsapp.replace(/[^0-9]/g, '')}`}
                          label={t('promoterLinktree.community')}
                          icon={<IconWhatsApp />}
                          isWhatsApp
                        />
                      )}
                    </div>
                  )}
                </nav>
              )}
            </header>
          )}

          {/* Divider */}
          <div style={{ margin: '0 24px', height: '1px', background: 'rgba(255,255,255,0.08)' }} />

          {/* ══ PROFIL PROMOTEUR ═════════════════════════════════════ */}
          <section
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '14px',
              padding: '32px 24px 28px',
            }}
            aria-label="Profil promoteur"
          >
            {/* Avatar */}
            {member.avatar_url ? (
              <img
                src={member.avatar_url}
                alt={displayName}
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
                  color: '#5A5A5E',
                }}
                aria-hidden="true"
              >
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
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
                  {displayName}
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
                  {isYunoInternal
                    ? `Promoteur ${org?.name ?? 'Yuno'}`
                    : `Promoteur · ${org?.name ?? ''}`}
                </span>
              </div>
            </div>

            <PartnerBadge />

            {/* Liens personnels du promoteur — seulement en mode promoteur */}
            {!useAgencySocialLinks && (member.instagram || member.tiktok) && (
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
                {member.instagram && (
                  <SocialButton
                    href={`https://instagram.com/${member.instagram.replace('@', '')}`}
                    label={member.instagram.replace('@', '')}
                    icon={<IconInstagram />}
                  />
                )}
                {member.tiktok && (
                  <SocialButton
                    href={`https://tiktok.com/@${member.tiktok.replace('@', '')}`}
                    label={member.tiktok.replace('@', '')}
                    icon={<IconTikTok />}
                  />
                )}
              </div>
            )}
          </section>

          {/* ══ TRUST SLIDER ═════════════════════════════════════════ */}
          {trustStats.length > 0 && (
            <div style={{ padding: '0 0 24px' }}>
              <TrustSlider stats={trustStats} />
            </div>
          )}

          {/* Divider (seulement si trust slider ou profil au-dessus) */}
          <div style={{ margin: '0 24px', height: '1px', background: 'rgba(255,255,255,0.08)' }} />

          {/* ══ FILTRES ══════════════════════════════════════════════ */}
          <LinktreeFilters
            allGenres={allGenres}
            dayFilter={dayFilter} setDayFilter={setDayFilter}
            genreFilter={genreFilter} setGenreFilter={setGenreFilter}
            priceFilter={priceFilter} setPriceFilter={setPriceFilter}
          />

          {/* ══ ÉVÉNEMENTS ═══════════════════════════════════════════ */}
          <section style={{ padding: '8px 20px 0' }} aria-label={t('promoterLinktree.events')}>
            {grouped.length === 0 ? (
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
                {(dayFilter || genreFilter || priceFilter)
                  ? t('promoterLinktree.noEventsFilters')
                  : t('promoterLinktree.noEventsYet')}
              </p>
            ) : (
              grouped.map((group) => (
                <div key={group.date}>
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
                      {group.label}
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
                      {group.items.length} EVENT{group.items.length !== 1 ? 'S' : ''}
                    </span>
                  </div>

                  {/* Event cards */}
                  {group.items.map((ev, i) => (
                    <FadeInView key={ev.row_id} index={i < 6 ? i : 0}>
                      <EventCard
                        event={ev}
                        affiliateId={member?.affiliate_id ?? ''}
                        memberId={member?.id ?? ''}
                        isOwner={isOwner}
                        onNavigate={() => navigate(`/affiliate-event/${ev.slug}`)}
                      />
                    </FadeInView>
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
              {t('promoterLinktree.seeMoreEvents')}
              <IconArrow />
            </button>
          </div>

        </main>

        {/* ══ STICKY POWERED BY YUNO ══════════════════════════════ */}
        <a
          href="https://yunoapp.eu"
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('promoterLinktree.poweredBy')}
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
        @keyframes fadeSlide {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </>
  );
}
