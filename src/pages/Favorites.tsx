import { useState, useEffect } from 'react';
import { Bell, Calendar, Wine, MapPin, Music, Users, Compass, ChevronRight, Heart } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { useFavorites } from '@/hooks/useFavorites';
import { FavoriteButton } from '@/components/FavoriteButton';
import { supabase } from '@/integrations/supabase/client';
import { formatInTimeZone } from 'date-fns-tz';
import { fr, es, enUS } from 'date-fns/locale';
import { PARIS_TIMEZONE } from '@/lib/timezone';
import { getOptimizedImageUrl } from '@/lib/imageOptimization';
import { BottomNav } from '@/components/BottomNav';
import { FadeInView } from '@/components/motion';
import { PageFade } from '@/components/PageFade';
import { EmptyState as GlobalEmptyState } from '@/components/EmptyState';

/* ── Design tokens (aligned with Yuno DS: index.css variables) ── */
const D = {
  bg:         '#0A0A0A',     // --yuno-black
  surface:    '#141414',     // --yuno-card
  surface2:   '#1B1B1E',     // --yuno-card-2
  elevated:   '#222226',     // --yuno-elev
  input:      '#1F1F22',     // --yuno-input
  line:       'rgba(255,255,255,.08)',   // --border-subtle
  lineStrong: 'rgba(255,255,255,.14)',   // --border-strong
  muted:      '#9A9A9A',     // --yuno-gray-2
  faint:      '#5A5A5E',     // --yuno-gray-3
  red:        '#E8192C',     // --yuno-red
  redHover:   '#FF2438',     // --yuno-red-hover
  redSoft:    'rgba(232,25,44,.14)',     // --yuno-red-soft
  redDim:     'rgba(232,25,44,.10)',     // --yuno-red-dim
  violet:     '#A78BFA',
  violetSoft: 'rgba(167,139,250,.16)',
};

/* Derive a stable hue (0-359) from any string */
function hueFromId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
  return h % 360;
}

/* Coloured glow background — matches design */
function glowStyle(hue: number): React.CSSProperties {
  const h2 = (hue + 38) % 360;
  return {
    backgroundImage: [
      `radial-gradient(115% 85% at 28% 12%, hsl(${hue} 85% 58% / .62), transparent 55%)`,
      `radial-gradient(120% 95% at 88% 92%, hsl(${h2} 80% 48% / .42), transparent 52%)`,
      `repeating-linear-gradient(125deg, rgba(255,255,255,.03) 0 2px, transparent 2px 9px)`,
      `linear-gradient(155deg, #17171c, #0b0b0e)`,
    ].join(','),
  };
}

/* Upcoming-events label, pluralised + interpolated (t() returns the raw string). */
function upcomingNightsLabel(n: number, t: (k: string) => string): string {
  if (n <= 0) return t('favorites.noUpcoming');
  const key = n === 1 ? 'favorites.upcomingNights_one' : 'favorites.upcomingNights_other';
  return t(key).replace('{{count}}', String(n));
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

/* ── Tab pill ── */
function TabPill({
  label, icon: Icon, count, active, onClick,
}: {
  label: string; icon: React.ElementType; count: number;
  active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontFamily: 'var(--yuno-mono, ui-monospace, monospace)',
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        padding: '7px 11px',
        borderRadius: 9,
        transition: 'background-color .18s ease, box-shadow .18s ease, color .18s ease, border-color .18s ease',
        color: active ? '#fff' : D.muted,
        backgroundColor: active ? D.red : D.input,
        border: `1px solid ${active ? 'rgba(232,25,44,.55)' : D.line}`,
        boxShadow: active ? '0 5px 16px -5px rgba(232,25,44,.55)' : 'none',
      }}
    >
      <Icon size={13} strokeWidth={2} />
      {label}
      <span style={{
        fontFamily: 'var(--yuno-mono, ui-monospace, monospace)',
        fontSize: 9,
        fontWeight: 700,
        lineHeight: 1,
        padding: '2px 5px',
        borderRadius: 5,
        color: active ? 'rgba(255,255,255,.85)' : D.faint,
        background: active ? 'rgba(255,255,255,.18)' : D.elevated,
      }}>
        {count}
      </span>
    </button>
  );
}

/* ── Section label ── */
function SecLabel({ children, count }: { children: React.ReactNode; count: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 20px', marginBottom: 14 }}>
      <span style={{
        fontFamily: 'var(--yuno-mono, ui-monospace, monospace)',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '.18em',
        color: D.faint,
        whiteSpace: 'nowrap',
      }}>
        {children}
      </span>
      <span style={{ flex: 1, height: 1, background: D.line }} />
      <span style={{ fontFamily: 'var(--yuno-mono, ui-monospace, monospace)', fontSize: 11, color: D.faint, whiteSpace: 'nowrap' }}>
        {count}
      </span>
    </div>
  );
}

/* ── Club card ── */
function ClubCard({
  venue, upcoming, onClick,
}: {
  venue: FavoriteVenue;
  upcoming?: number;
  onClick: () => void;
}) {
  const { t } = useLanguage();
  const hue = hueFromId(venue.id);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      style={{
        width: '100%',
        textAlign: 'left',
        cursor: 'pointer',
        color: 'inherit',
        display: 'flex',
        alignItems: 'center',
        gap: 15,
        padding: '13px 14px',
        background: `linear-gradient(150deg, ${D.surface2}, ${D.surface})`,
        border: `1px solid ${D.line}`,
        borderRadius: 20,
        boxShadow: '0 14px 30px -22px rgba(0,0,0,.9)',
        outline: 'none',
      }}
    >
      {/* Thumbnail */}
      <div style={{
        position: 'relative',
        width: 59,
        height: 59,
        flex: 'none',
        borderRadius: 14,
        overflow: 'hidden',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.08)',
        ...(venue.logoUrl || venue.coverUrl ? {} : glowStyle(hue)),
      }}>
        {(venue.logoUrl || venue.coverUrl) && (
          <img
            src={getOptimizedImageUrl(venue.logoUrl || venue.coverUrl!, { width: 118, height: 118, ...(venue.logoUrl ? { resize: 'contain' as const } : {}) })}
            alt={venue.name}
            style={{ width: '100%', height: '100%', objectFit: venue.logoUrl ? 'contain' : 'cover', display: 'block', background: venue.logoUrl ? '#141414' : undefined }}
          />
        )}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(160deg, transparent 40%, rgba(8,8,10,.45))' }} />
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
          <span style={{
            fontSize: 17,
            fontWeight: 700,
            letterSpacing: '-.01em',
            lineHeight: 1.15,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {venue.name}
          </span>
          {venue.isAffiliate && (
            <span style={{
              flexShrink: 0,
              fontFamily: 'var(--yuno-mono, ui-monospace, monospace)',
              fontSize: 9,
              fontWeight: 600,
              letterSpacing: '.14em',
              color: D.violet,
              background: D.violetSoft,
              border: `1px solid rgba(167,139,250,.4)`,
              borderRadius: 7,
              padding: '3px 7px',
            }}>
              PARTENAIRE
            </span>
          )}
          {venue.musicGenre && (
            <span style={{
              flexShrink: 0,
              fontFamily: 'var(--yuno-mono, ui-monospace, monospace)',
              fontSize: 9.5,
              fontWeight: 600,
              letterSpacing: '.06em',
              color: D.muted,
              background: D.elevated,
              border: `1px solid ${D.line}`,
              borderRadius: 6,
              padding: '2px 7px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: 110,
            }}>
              {venue.musicGenre}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: D.muted, marginBottom: 4 }}>
          <MapPin size={13} strokeWidth={2} color={D.muted} />
          <span style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{venue.city}</span>
        </div>
        {!venue.isAffiliate && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <Calendar size={12} strokeWidth={2} color={(upcoming ?? 0) > 0 ? D.red : D.faint} />
            <span style={{
              fontFamily: 'var(--yuno-mono, ui-monospace, monospace)',
              fontSize: 11,
              fontWeight: (upcoming ?? 0) > 0 ? 600 : 400,
              color: (upcoming ?? 0) > 0 ? D.red : D.faint,
            }}>
              {upcomingNightsLabel(upcoming ?? 0, t)}
            </span>
          </div>
        )}
      </div>

      <div onClick={(e) => e.stopPropagation()}>
        <FavoriteButton type={venue.isAffiliate ? 'affiliate_venue' : 'club'} id={venue.id} />
      </div>
    </div>
  );
}

/* ── Organizer card ── */
function OrganizerCard({
  org,
  upcoming,
  onClick,
  onUnfollow,
}: {
  org: FollowedOrganizer;
  upcoming?: number;
  onClick: () => void;
  onUnfollow: (e: React.MouseEvent) => void;
}) {
  const { t } = useLanguage();
  const hue = hueFromId(org.id);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      style={{
        width: '100%',
        textAlign: 'left',
        cursor: 'pointer',
        color: 'inherit',
        display: 'flex',
        alignItems: 'center',
        gap: 15,
        padding: '13px 14px',
        background: `linear-gradient(150deg, ${D.surface2}, ${D.surface})`,
        border: `1px solid ${D.line}`,
        borderRadius: 20,
        boxShadow: '0 14px 30px -22px rgba(0,0,0,.9)',
        outline: 'none',
      }}
    >
      {/* Thumbnail — same treatment as ClubCard (rounded square + overlay) */}
      <div style={{
        position: 'relative',
        width: 59,
        height: 59,
        flex: 'none',
        borderRadius: 14,
        overflow: 'hidden',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.08)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...(org.logoUrl ? {} : glowStyle(hue)),
      }}>
        {org.logoUrl ? (
          <img
            src={getOptimizedImageUrl(org.logoUrl, { width: 118, height: 118, resize: 'contain' })}
            alt={org.name}
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', background: '#141414' }}
          />
        ) : (
          <Users size={26} color="rgba(255,255,255,.7)" strokeWidth={1.8} />
        )}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(160deg, transparent 40%, rgba(8,8,10,.45))' }} />
      </div>

      {/* Info — mirrors ClubCard: name, then city, then upcoming nights. */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-.01em', lineHeight: 1.15, marginBottom: 5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {org.name}
        </div>
        {org.city && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: D.muted, marginBottom: 4 }}>
            <MapPin size={13} strokeWidth={2} color={D.muted} />
            <span style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{org.city}</span>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <Calendar size={12} strokeWidth={2} color={(upcoming ?? 0) > 0 ? D.red : D.faint} />
          <span style={{
            fontFamily: 'var(--yuno-mono, ui-monospace, monospace)',
            fontSize: 11,
            fontWeight: (upcoming ?? 0) > 0 ? 600 : 400,
            color: (upcoming ?? 0) > 0 ? D.red : D.faint,
          }}>
            {upcomingNightsLabel(upcoming ?? 0, t)}
          </span>
        </div>
      </div>

      {/* Subscribed bell — mirrors FavoriteButton's active state used by ClubCard:
          ghost (transparent) button with a red-filled bell, not a solid red disc. */}
      <button
        onClick={onUnfollow}
        aria-label={t('subscribe.active')}
        style={{
          width: 40,
          height: 40,
          flexShrink: 0,
          borderRadius: 10,
          display: 'grid',
          placeItems: 'center',
          cursor: 'pointer',
          background: 'transparent',
          border: 'none',
          padding: 0,
        }}
      >
        <Bell size={16} strokeWidth={2} fill={D.red} color={D.red} />
      </button>
    </div>
  );
}

/* ── Event card ── */
function EventCard({
  event,
  formatDate,
  formatTime,
  onClick,
}: {
  event: FavoriteEvent;
  formatDate: (s: string) => string;
  formatTime: (s: string) => string;
  onClick: () => void;
}) {
  const hue = hueFromId(event.id);
  const dateStr = formatDate(event.startAt);
  // e.g. "sam. 7 juin" → extract day number & month for the visual badge
  const parts = dateStr.split(' ');
  const dayNum = parts.find((p) => /^\d+$/.test(p)) ?? '';
  const monthAbbr = (parts.find((p) => /^[a-zéûàâäôùè]{3,4}/i.test(p) && !/sam|dim|lun|mar|mer|jeu|ven|fri|sat|sun|mon|tue|wed|thu/.test(p.toLowerCase())) ?? '').toUpperCase().slice(0, 3);
  const genres = event.musicGenres?.filter(Boolean) ?? [];

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      style={{
        width: '100%',
        textAlign: 'left',
        cursor: 'pointer',
        color: 'inherit',
        display: 'flex',
        alignItems: 'stretch',
        overflow: 'hidden',
        background: D.surface,
        border: `1px solid ${D.line}`,
        borderRadius: 20,
        boxShadow: '0 14px 30px -22px rgba(0,0,0,.9)',
        outline: 'none',
      }}
    >
      {/* Left visual + date badge — square 1:1 poster */}
      <div style={{ position: 'relative', width: 120, aspectRatio: '1 / 1', alignSelf: 'flex-start', flexShrink: 0, overflow: 'hidden', ...glowStyle(hue) }}>
        {event.posterUrl && (
          <img
            src={getOptimizedImageUrl(event.posterUrl, { width: 240, height: 240 })}
            alt={event.title}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        )}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(120deg, rgba(8,8,10,.15), rgba(8,8,10,.7))' }} />
        <div style={{
          position: 'absolute',
          top: 10,
          left: 10,
          textAlign: 'center',
          background: 'rgba(8,8,10,.55)',
          backdropFilter: 'blur(6px)',
          borderRadius: 11,
          padding: '6px 9px',
          border: '1px solid rgba(255,255,255,.14)',
        }}>
          <div style={{ fontSize: 19, fontWeight: 700, lineHeight: 1 }}>{dayNum}</div>
          <div style={{ fontFamily: 'var(--yuno-mono, ui-monospace, monospace)', fontSize: 9, letterSpacing: '.1em', color: D.muted, marginTop: 2 }}>
            {monthAbbr}
          </div>
        </div>
      </div>

      {/* Right info */}
      <div style={{ flex: 1, minWidth: 0, padding: '12px 14px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 5 }}>
        {/* Affiliate badge */}
        {event.isAffiliate && (
          <span style={{
            display: 'inline-block',
            width: 'fit-content',
            fontFamily: 'var(--yuno-mono, ui-monospace, monospace)',
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: '.14em',
            color: D.violet,
            background: D.violetSoft,
            border: `1px solid rgba(167,139,250,.4)`,
            borderRadius: 7,
            padding: '3px 7px',
          }}>
            PARTENAIRE
          </span>
        )}

        {/* Title */}
        <div style={{ fontSize: 15.5, fontWeight: 700, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {event.title}
        </div>

        {/* Date — single line, no time */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <Calendar size={11} strokeWidth={2} color={D.muted} />
          <span style={{ fontFamily: 'var(--yuno-mono, ui-monospace, monospace)', fontSize: 11, color: D.muted, whiteSpace: 'nowrap' }}>
            {dateStr.toUpperCase()}
          </span>
        </div>

        {/* Club / host name */}
        {event.venueName && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
            <MapPin size={11} strokeWidth={2} color={D.muted} />
            <span style={{ fontFamily: 'var(--yuno-mono, ui-monospace, monospace)', fontSize: 11, color: D.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {event.venueName.toUpperCase()}
            </span>
          </div>
        )}

        {/* Genre tags */}
        {genres.length > 0 && (
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {genres.slice(0, 3).map((g) => (
              <span key={g} style={{
                fontFamily: 'var(--yuno-mono, ui-monospace, monospace)',
                fontSize: 9.5,
                fontWeight: 600,
                color: D.faint,
                background: D.elevated,
                border: `1px solid ${D.line}`,
                borderRadius: 6,
                padding: '2px 7px',
              }}>
                {g}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Fav button */}
      <div style={{ display: 'flex', alignItems: 'center', paddingRight: 12 }} onClick={(e) => e.stopPropagation()}>
        <FavoriteButton type={event.isAffiliate ? 'affiliate_event' : 'event'} id={event.id} />
      </div>
    </div>
  );
}

/* ── DJ card ── */
function DJCard({ dj, onClick }: { dj: FavoriteDJ; onClick: () => void }) {
  const { t } = useLanguage();
  const hue = hueFromId(dj.id);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      style={{
        width: '100%',
        textAlign: 'left',
        cursor: 'pointer',
        color: 'inherit',
        display: 'flex',
        alignItems: 'center',
        gap: 15,
        padding: '13px 14px',
        background: `linear-gradient(150deg, ${D.surface2}, ${D.surface})`,
        border: `1px solid ${D.line}`,
        borderRadius: 20,
        boxShadow: '0 14px 30px -22px rgba(0,0,0,.9)',
        outline: 'none',
      }}
    >
      <div style={{
        position: 'relative',
        width: 64,
        height: 64,
        flexShrink: 0,
        borderRadius: 16,
        overflow: 'hidden',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.1)',
        ...(dj.profileImageUrl ? {} : glowStyle(hue)),
      }}>
        {dj.profileImageUrl && (
          <img
            src={dj.profileImageUrl}
            alt={dj.stageName}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-.01em', lineHeight: 1.15, marginBottom: 5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {dj.stageName}
        </div>
        {dj.musicGenres.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7, flexWrap: 'wrap' }}>
            {dj.musicGenres.slice(0, 3).map((g) => (
              <span key={g} style={{
                fontFamily: 'var(--yuno-mono, ui-monospace, monospace)',
                fontSize: 10,
                fontWeight: 500,
                color: D.muted,
                border: `1px solid ${D.lineStrong}`,
                borderRadius: 6,
                padding: '2px 7px',
              }}>
                {g}
              </span>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--yuno-mono, ui-monospace, monospace)', fontSize: 11, color: D.faint }}>
          <Bell size={12} strokeWidth={2} color={D.faint} />
          {t('subscribe.active')}
        </div>
      </div>

      <div onClick={(e) => e.stopPropagation()}>
        <FavoriteButton type="dj" id={dj.id} />
      </div>
    </div>
  );
}

/* ── Drink card ── */
function DrinkCard({ drink, onClick }: { drink: FavoriteDrink; onClick?: () => void }) {
  const hue = hueFromId(drink.id);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => onClick && e.key === 'Enter' && onClick()}
      style={{
        width: '100%',
        textAlign: 'left',
        cursor: onClick ? 'pointer' : 'default',
        color: 'inherit',
        display: 'flex',
        alignItems: 'center',
        gap: 15,
        padding: '13px 14px',
        background: `linear-gradient(150deg, ${D.surface2}, ${D.surface})`,
        border: `1px solid ${D.line}`,
        borderRadius: 20,
        boxShadow: '0 14px 30px -22px rgba(0,0,0,.9)',
        outline: 'none',
      }}
    >
      <div style={{
        position: 'relative',
        width: 64,
        height: 64,
        flexShrink: 0,
        borderRadius: 16,
        overflow: 'hidden',
        display: 'grid',
        placeItems: 'center',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.08)',
        ...glowStyle(hue),
        ...(drink.imgUrl ? {} : {}),
      }}>
        {drink.imgUrl ? (
          <img
            src={getOptimizedImageUrl(drink.imgUrl, { width: 128, height: 128, resize: 'contain' })}
            alt={drink.name}
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', background: '#0A0A0A' }}
          />
        ) : (
          <Wine size={26} strokeWidth={1.8} color="rgba(255,255,255,.85)" />
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-.01em', lineHeight: 1.15, marginBottom: 5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {drink.name}
        </div>
        {drink.venueName && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: D.faint, marginTop: 2 }}>
            <MapPin size={12} strokeWidth={2} color={D.faint} />
            <span style={{ fontFamily: 'var(--yuno-mono, ui-monospace, monospace)', fontSize: 11 }}>{drink.venueName}</span>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 9 }}>
        <span style={{ fontFamily: 'var(--yuno-mono, ui-monospace, monospace)', fontSize: 14, fontWeight: 700, color: D.red }}>
          {drink.price.toFixed(2)} €
        </span>
        <div onClick={(e) => e.stopPropagation()}>
          <FavoriteButton type="drink" id={drink.id} />
        </div>
      </div>
    </div>
  );
}

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
      <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700, letterSpacing: '-.01em' }}>{title}</h3>
      <p style={{ margin: 0, fontFamily: 'var(--yuno-mono, ui-monospace, monospace)', fontSize: 12.5, color: D.muted, maxWidth: 240, lineHeight: 1.6 }}>
        {description}
      </p>
    </div>
  );
}

/* ── Discover CTA — fills the sparse list with a clear next action ── */
function DiscoverCTA({
  title, desc, onClick,
}: {
  title: string; desc: string; onClick: () => void;
}) {
  return (
    <div style={{ padding: '0 18px' }}>
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
          border: `1px solid rgba(232,25,44,.22)`,
          borderRadius: 20,
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
          border: `1px solid rgba(232,25,44,.3)`,
        }}>
          <Compass size={22} strokeWidth={2} color={D.red} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-.01em', lineHeight: 1.2, marginBottom: 3 }}>
            {title}
          </div>
          <div style={{ fontFamily: 'var(--yuno-mono, ui-monospace, monospace)', fontSize: 11.5, color: D.muted, lineHeight: 1.45 }}>
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

/* ── Spinner ── */
function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}>
      <div style={{
        width: 32,
        height: 32,
        borderRadius: 999,
        border: `2px solid ${D.line}`,
        borderTopColor: D.red,
        animation: 'spin 0.7s linear infinite',
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
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

  // Single screen, flat tabs (clubs / soirées / DJs / boissons). The favori vs
  // abonnement distinction lives in the cards (cœur for soirées+boissons, cloche
  // "abonné" for clubs+orgas+DJs) and the count wording — not in the layout.
  const [activeTab, setActiveTab] = useState<'clubs' | 'events' | 'djs' | 'drinks'>('clubs');
  const [venues, setVenues] = useState<FavoriteVenue[]>([]);
  const [events, setEvents] = useState<FavoriteEvent[]>([]);
  const [drinks, setDrinks] = useState<FavoriteDrink[]>([]);
  const [djs, setDJs] = useState<FavoriteDJ[]>([]);
  const [followedOrganizers, setFollowedOrganizers] = useState<FollowedOrganizer[]>([]);
  // Upcoming-events count per club id / organizer user id (keys never collide — both UUIDs).
  const [upcomingByEntity, setUpcomingByEntity] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const locale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  const clubFavoriteCount = favorites.filter(f => f.favoriteType === 'club' || f.favoriteType === 'affiliate_venue').length;
  const eventFavoriteCount = favorites.filter(f => f.favoriteType === 'event' || f.favoriteType === 'affiliate_event').length;
  const drinkFavoriteCount = favorites.filter(f => f.favoriteType === 'drink').length;
  const djFavoriteCount = favorites.filter(f => f.favoriteType === 'dj').length;

  const totalCount = clubFavoriteCount + eventFavoriteCount + drinkFavoriteCount + djFavoriteCount + followedOrganizers.length;

  useEffect(() => {
    const fetchFavoriteData = async () => {
      if (favLoading) return;
      setLoading(true);

      const clubFavs = favorites.filter(f => f.favoriteType === 'club');
      const affiliateVenueFavs = favorites.filter(f => f.favoriteType === 'affiliate_venue');
      const eventFavs = favorites.filter(f => f.favoriteType === 'event');
      const affiliateEventFavs = favorites.filter(f => f.favoriteType === 'affiliate_event');
      const drinkFavs = favorites.filter(f => f.favoriteType === 'drink');

      try {
        const [venueResult, affiliateVenueResult] = await Promise.all([
          clubFavs.length > 0
            ? supabase.from('venues').select('id, name, city, logo_url, cover_url, music_genre').in('id', clubFavs.map(f => f.venueId).filter(Boolean) as string[])
            : Promise.resolve({ data: [] }),
          affiliateVenueFavs.length > 0
            ? supabase.from('affiliate_venues').select('id, name, city, cover_image_url, slug').in('id', affiliateVenueFavs.map(f => f.affiliateVenueId).filter(Boolean) as string[])
            : Promise.resolve({ data: [] }),
        ]);

        const regularVenues = (venueResult.data || []).map((v: any) => ({
          id: v.id, name: v.name, city: v.city || '',
          logoUrl: v.logo_url || undefined, coverUrl: v.cover_url || undefined, isAffiliate: false,
          musicGenre: v.music_genre || undefined,
        }));
        const affiliateVenues = (affiliateVenueResult.data || []).map((v: any) => ({
          id: v.id, name: v.name, city: v.city || '',
          coverUrl: v.cover_image_url || undefined, isAffiliate: true, slug: v.slug,
        }));
        setVenues([...regularVenues, ...affiliateVenues]);

        const [eventResult, affiliateEventResult] = await Promise.all([
          eventFavs.length > 0
            ? supabase.from('events').select('id, title, start_at, end_at, poster_url, venue_id, partner_venue_id, organizer_user_id, music_genres').in('id', eventFavs.map(f => f.eventId).filter(Boolean) as string[])
            : Promise.resolve({ data: [], error: null }),
          affiliateEventFavs.length > 0
            ? supabase.from('affiliate_events').select('id, name, event_date, start_time, flyer_url, slug, genres, affiliate_venues(name)').in('id', affiliateEventFavs.map(f => f.affiliateEventId).filter(Boolean) as string[])
            : Promise.resolve({ data: [], error: null }),
        ]);

        if ((eventResult as any).error) throw (eventResult as any).error;

        // Resolve each event's club/host name: venue_id or partner_venue_id → venues.name,
        // falling back to the organizer's name for organizer-led events without a club.
        const eventRows = (eventResult.data || []) as any[];
        const hostVenueIds = [...new Set(eventRows.flatMap((e) => [e.venue_id, e.partner_venue_id]).filter(Boolean))] as string[];
        const hostOrgIds = [...new Set(eventRows.map((e) => e.organizer_user_id).filter(Boolean))] as string[];
        const [hostVenuesRes, hostOrgsRes] = await Promise.all([
          hostVenueIds.length > 0 ? supabase.from('venues').select('id, name').in('id', hostVenueIds) : Promise.resolve({ data: [] }),
          hostOrgIds.length > 0 ? supabase.from('organizer_profiles').select('user_id, display_name').in('user_id', hostOrgIds) : Promise.resolve({ data: [] }),
        ]);
        const hostVenueName = new Map((hostVenuesRes.data || []).map((v: any) => [v.id, v.name]));
        const hostOrgName = new Map((hostOrgsRes.data || []).map((o: any) => [o.user_id, o.display_name]));

        const regularEvents = eventRows.map((e: any) => ({
          id: e.id, title: e.title, startAt: e.start_at, endAt: e.end_at,
          posterUrl: e.poster_url || undefined,
          venueId: e.venue_id, isAffiliate: false,
          venueName: hostVenueName.get(e.venue_id) || hostVenueName.get(e.partner_venue_id) || hostOrgName.get(e.organizer_user_id) || undefined,
          musicGenres: e.music_genres || [],
        }));
        const affiliateEvents = (affiliateEventResult.data || []).map((e: any) => ({
          id: e.id, title: e.name,
          startAt: `${e.event_date}T${(e.start_time ?? '22:00').slice(0, 5)}:00`,
          posterUrl: e.flyer_url || undefined, venueName: e.affiliate_venues?.name,
          isAffiliate: true, affiliateSlug: e.slug,
          musicGenres: e.genres || [],
        }));
        setEvents([...regularEvents, ...affiliateEvents]);

        if (drinkFavs.length > 0) {
          const drinkIds = drinkFavs.map(f => f.drinkId).filter(Boolean) as string[];
          const { data, error } = await supabase.from('drinks').select('id, name, price, img_url, venue_id, collection').in('id', drinkIds);
          if (error) throw error;
          setDrinks((data || []).map((d: any) => ({
            id: d.id, name: d.name, price: Number(d.price),
            imgUrl: d.img_url, venueId: d.venue_id, venueName: undefined, collection: d.collection,
          })));
        } else {
          setDrinks([]);
        }

        const djFavs = favorites.filter(f => f.favoriteType === 'dj');
        if (djFavs.length > 0) {
          const djIds = djFavs.map(f => f.djId).filter(Boolean) as string[];
          // djs_public (vue definer, anon-safe) expose le handle propre -> lien /dj/<handle>.
          const { data } = await supabase.from('djs_public').select('id, stage_name, first_name, last_name, profile_image_url, music_genres, slug, handle').in('id', djIds);
          setDJs((data || []).map((d: any) => ({
            id: d.id,
            stageName: d.stage_name || `${d.first_name} ${d.last_name}`,
            profileImageUrl: d.profile_image_url || undefined,
            musicGenres: d.music_genres || [],
            slug: d.slug || undefined,
            handle: d.handle || undefined,
          })));
        } else {
          setDJs([]);
        }

        let orgUserIds: string[] = [];
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: followedData } = await supabase.from('organizer_profile_followers').select('organizer_user_id').eq('user_id', user.id);
          if (followedData && followedData.length > 0) {
            orgUserIds = followedData.map((f: any) => f.organizer_user_id);
            const { data: orgData } = await supabase.from('organizer_profiles').select('user_id, display_name, avatar_url, slug, city').in('user_id', orgUserIds);
            setFollowedOrganizers((orgData || []).map((o: any) => ({
              id: o.user_id, name: o.display_name, logoUrl: o.avatar_url || undefined,
              slug: o.slug || undefined, musicGenres: [],
              city: o.city || undefined,
            })));
          } else {
            setFollowedOrganizers([]);
          }
        }

        // Upcoming-events count for the clubs tab cards. Mirrors the public pages:
        // VenuePage (venue + partner-hosted co-events, is_active, not yet ended) and
        // OrganizerPublicProfile (public + is_active). Affiliate venues live in a
        // separate table and are intentionally left without a count.
        const nowIso = new Date().toISOString();
        const counts: Record<string, number> = {};
        const clubIds = regularVenues.map(v => v.id);

        const [clubEventsRes, orgEventsRes] = await Promise.all([
          clubIds.length > 0
            ? supabase
                .from('events')
                .select('venue_id, partner_venue_id')
                .or(`venue_id.in.(${clubIds.join(',')}),partner_venue_id.in.(${clubIds.join(',')})`)
                .eq('is_active', true)
                .gte('end_at', nowIso)
            : Promise.resolve({ data: [] }),
          orgUserIds.length > 0
            ? supabase
                .from('events')
                .select('organizer_user_id')
                .in('organizer_user_id', orgUserIds)
                .eq('visibility', 'public')
                .eq('is_active', true)
                .gte('end_at', nowIso)
            : Promise.resolve({ data: [] }),
        ]);

        const clubIdSet = new Set(clubIds);
        (clubEventsRes.data || []).forEach((e: any) => {
          if (e.venue_id && clubIdSet.has(e.venue_id)) counts[e.venue_id] = (counts[e.venue_id] || 0) + 1;
          if (e.partner_venue_id && clubIdSet.has(e.partner_venue_id)) counts[e.partner_venue_id] = (counts[e.partner_venue_id] || 0) + 1;
        });
        (orgEventsRes.data || []).forEach((e: any) => {
          if (e.organizer_user_id) counts[e.organizer_user_id] = (counts[e.organizer_user_id] || 0) + 1;
        });
        setUpcomingByEntity(counts);
      } catch (error) {
        console.error('Error fetching favorite data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchFavoriteData();
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

  const formatEventTime = (startAt: string) => {
    try {
      const d = new Date(startAt);
      if (isNaN(d.getTime())) return startAt.slice(11, 16);
      return formatInTimeZone(d, PARIS_TIMEZONE, 'HH:mm', { locale });
    } catch {
      return startAt.slice(11, 16);
    }
  };

  const tabs = [
    { id: 'clubs' as const,  label: t('favorites.clubs'),      icon: MapPin,    count: clubFavoriteCount + followedOrganizers.length },
    { id: 'events' as const, label: t('favorites.tabParties'), icon: Calendar,  count: eventFavoriteCount },
    { id: 'djs' as const,    label: 'DJs',                     icon: Music,     count: djFavoriteCount },
    { id: 'drinks' as const, label: t('favorites.drinks'),     icon: Wine,      count: drinkFavoriteCount },
  ];

  const isLoading = loading || favLoading;
  // Aucun favori ni abonnement du tout → état vide global unifié à la place des onglets
  const totallyEmpty = !isLoading && totalCount === 0;

  return (
    <div style={{ minHeight: '100vh', background: D.bg, paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + var(--live-banner-offset, 0px) + 128px)' }}>
      {/* ── Sticky header ── */}
      <header style={{
        position: 'sticky',
        top: 0,
        zIndex: 40,
        paddingTop: 'env(safe-area-inset-top, 0px)',
        background: 'rgba(10,10,10,.92)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: `1px solid rgba(255,255,255,.07)`,
      }}>
        {/* Title row */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '22px 20px 16px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1 }}>
              {t('nav.favorites')}
            </h1>
          </div>
          {totalCount > 0 && (
            <span style={{
              fontFamily: 'var(--yuno-mono, ui-monospace, monospace)',
              fontSize: 11,
              fontWeight: 600,
              color: D.faint,
              background: D.elevated,
              border: `1px solid ${D.line}`,
              padding: '4px 11px',
              borderRadius: 999,
              flexShrink: 0,
            }}>
              {totalCount}
            </span>
          )}
        </div>

        {/* ── Scrollable tabs — même pattern qu'ExploreChipRow ── */}
        <style>{`.fav-hscroll::-webkit-scrollbar{display:none}`}</style>
        <div
          className="fav-hscroll flex gap-2 overflow-x-auto"
          style={{
            scrollbarWidth: 'none' as const,
            msOverflowStyle: 'none',
            WebkitOverflowScrolling: 'touch',
            paddingLeft: 20,
            paddingBottom: 18,
          } as React.CSSProperties}
        >
          {tabs.map((tab) => (
            <TabPill
              key={tab.id}
              label={tab.label}
              icon={tab.icon}
              count={tab.count}
              active={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
            />
          ))}
          <div style={{ width: 20, flexShrink: 0 }} />
        </div>
      </header>

      {/* ── Content ── */}
      <PageFade style={{ maxWidth: 512, margin: '0 auto', padding: '24px 0 0' }}>

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

        {/* CLUBS TAB — abonnements (clubs + organisateurs) */}
        {!totallyEmpty && activeTab === 'clubs' && (
          <>
            {isLoading ? (
              <Spinner />
            ) : clubFavoriteCount === 0 && followedOrganizers.length === 0 ? (
              <EmptyState icon={MapPin} title={t('subscribe.emptyClubs')} description={t('subscribe.emptyClubsDesc')} />
            ) : (
              <>
                {venues.length > 0 && (
                  <>
                    <SecLabel count={`${venues.length} ${t('favorites.unitSubscribers')}`}>{t('favorites.clubs').toUpperCase()}</SecLabel>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '0 18px' }}>
                      {venues.map((venue, i) => (
                        <FadeInView key={venue.id} index={i < 6 ? i : 0}>
                          <ClubCard
                            venue={venue}
                            upcoming={upcomingByEntity[venue.id]}
                            onClick={() => venue.isAffiliate ? navigate(`/affiliate-venue/${venue.slug}`) : navigate(`/club/${venue.id}`)}
                          />
                        </FadeInView>
                      ))}
                    </div>
                  </>
                )}

                {followedOrganizers.length > 0 && (
                  <div style={{ marginTop: venues.length > 0 ? 32 : 0 }}>
                    <SecLabel count={`${followedOrganizers.length} ${t('favorites.unitSubscribers')}`}>{t('favorites.tabOrganizers').toUpperCase()}</SecLabel>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '0 18px' }}>
                      {followedOrganizers.map((org, i) => (
                        <FadeInView key={org.id} index={i < 6 ? i : 0}>
                        <OrganizerCard
                          org={org}
                          upcoming={upcomingByEntity[org.id]}
                          onClick={() => org.slug && navigate(`/o/${org.slug}`)}
                          onUnfollow={async (e) => {
                            e.stopPropagation();
                            const { data: { user } } = await supabase.auth.getUser();
                            if (!user) return;
                            await supabase.from('organizer_profile_followers').delete().eq('organizer_user_id', org.id).eq('user_id', user.id);
                            setFollowedOrganizers(prev => prev.filter(o => o.id !== org.id));
                          }}
                        />
                        </FadeInView>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Discover more — keeps the screen from feeling bare when you follow
                only a club or two, and points to the next useful action. */}
            {!isLoading && (
              <div style={{ marginTop: (clubFavoriteCount === 0 && followedOrganizers.length === 0) ? 8 : 30 }}>
                <DiscoverCTA
                  title={t('favorites.discoverClubsTitle')}
                  desc={t('favorites.discoverClubsDesc')}
                  onClick={() => navigate('/clubs')}
                />
              </div>
            )}
          </>
        )}

        {/* EVENTS TAB — favoris (soirées) */}
        {!totallyEmpty && activeTab === 'events' && (
          <>
            {isLoading ? (
              <Spinner />
            ) : eventFavoriteCount === 0 ? (
              <EmptyState icon={Calendar} title={t('favorites.noEvents')} description={t('favorites.noEventsDesc')} />
            ) : (
              <>
                <SecLabel count={`${events.length} ${t('favorites.unitUpcoming')}`}>{t('favorites.tabParties').toUpperCase()}</SecLabel>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '0 18px' }}>
                  {events.map((event, i) => (
                    <FadeInView key={event.id} index={i < 6 ? i : 0}>
                      <EventCard
                        event={event}
                        formatDate={formatEventDate}
                        formatTime={formatEventTime}
                        onClick={() =>
                          event.isAffiliate
                            ? navigate(`/affiliate-event/${event.affiliateSlug}`)
                            : navigate(`/club/${event.venueId}/event/${event.id}`)
                        }
                      />
                    </FadeInView>
                  ))}
                </div>
              </>
            )}

            {!isLoading && (
              <div style={{ marginTop: eventFavoriteCount === 0 ? 8 : 30 }}>
                <DiscoverCTA
                  title={t('favorites.discoverEventsTitle')}
                  desc={t('favorites.discoverEventsDesc')}
                  onClick={() => navigate('/events')}
                />
              </div>
            )}
          </>
        )}

        {/* DJs TAB — abonnements */}
        {!totallyEmpty && activeTab === 'djs' && (
          <>
            {isLoading ? (
              <Spinner />
            ) : djFavoriteCount === 0 ? (
              <EmptyState icon={Music} title={t('subscribe.emptyDJs')} description={t('subscribe.emptyDJsDesc')} />
            ) : (
              <>
                <SecLabel count={`${djs.length} ${t('favorites.unitSubscribers')}`}>DJS</SecLabel>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '0 18px' }}>
                  {djs.map((dj, i) => (
                    <FadeInView key={dj.id} index={i < 6 ? i : 0}>
                      <DJCard
                        dj={dj}
                        onClick={() => (dj.handle || dj.slug) ? navigate(`/dj/${dj.handle || dj.slug}`) : undefined}
                      />
                    </FadeInView>
                  ))}
                </div>
              </>
            )}

            {!isLoading && (
              <div style={{ marginTop: djFavoriteCount === 0 ? 8 : 30 }}>
                <DiscoverCTA
                  title={t('favorites.discoverDJsTitle')}
                  desc={t('favorites.discoverDJsDesc')}
                  onClick={() => navigate('/djs')}
                />
              </div>
            )}
          </>
        )}

        {/* DRINKS TAB — favoris */}
        {!totallyEmpty && activeTab === 'drinks' && (
          <>
            {isLoading ? (
              <Spinner />
            ) : drinkFavoriteCount === 0 ? (
              <EmptyState icon={Wine} title={t('favorites.noDrinks')} description={t('favorites.noDrinksDesc')} />
            ) : (
              <>
                <SecLabel count={`${drinks.length} ${t('favorites.unitFavorites')}`}>{t('favorites.drinks').toUpperCase()}</SecLabel>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '0 18px' }}>
                  {drinks.map((drink, i) => (
                    <FadeInView key={drink.id} index={i < 6 ? i : 0}>
                      <DrinkCard drink={drink} />
                    </FadeInView>
                  ))}
                </div>
              </>
            )}
          </>
        )}

      </PageFade>

      <BottomNav />
    </div>
  );
}
