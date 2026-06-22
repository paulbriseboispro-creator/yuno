import { useNavigate } from 'react-router-dom';
import { MapPin, Music, Users, CalendarCheck, CalendarX } from 'lucide-react';
import { getOptimizedImageUrl } from '@/lib/imageOptimization';
import { useLanguage } from '@/contexts/LanguageContext';
import { makeDjT } from '@/i18n/djTranslate';
import { DJTierBadge } from './DJTierBadge';
import type { MarketplaceDJ, DiscoveryMode } from './types';

/**
 * One DJ in the marketplace grid. Shared between the public fan surface (/djs) and
 * the dashboard booker surface. Booker mode adds followers, a price range and a
 * "Book" CTA + availability pill. Dark editorial styling works on both surfaces.
 */

function formatRate(min: number | null, max: number | null, currency: string | null): string | null {
  const cur = currency || 'EUR';
  const sym = cur === 'EUR' ? '€' : cur === 'USD' ? '$' : `${cur} `;
  const n = (v: number) => (cur === 'EUR' ? `${Math.round(v)}${sym}` : `${sym}${Math.round(v)}`);
  if (min != null && max != null) return min === max ? n(min) : `${n(min)} – ${n(max)}`;
  if (min != null) return `${n(min)}+`;
  if (max != null) return `≤ ${n(max)}`;
  return null;
}

export function DJMarketplaceCard({
  dj,
  mode,
  onBook,
  onViewProfile,
  showAvailability = false,
}: {
  dj: MarketplaceDJ;
  mode: DiscoveryMode;
  onBook?: (dj: MarketplaceDJ) => void;
  /** Booker mode: tapping the card asks before leaving (open profile in a new tab). */
  onViewProfile?: (dj: MarketplaceDJ) => void;
  /** When a booker filtered by date, show the available/busy pill. */
  showAvailability?: boolean;
}) {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const tt = makeDjT(language);

  const target = dj.handle || dj.slug;
  const rate = mode === 'booker' ? formatRate(dj.min_fee, dj.max_fee, dj.currency) : null;

  // Booker stays on the booking page (a confirm popup offers a new tab); fans navigate inline.
  const openProfile = () => {
    if (!target) return;
    if (mode === 'booker' && onViewProfile) onViewProfile(dj);
    else navigate(`/dj/${target}`);
  };

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '12px 14px',
        background: 'rgba(255,255,255,0.025)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 18,
      }}
    >
      {/* Avatar + identity — clicking opens the public profile */}
      <button
        onClick={openProfile}
        disabled={!target}
        style={{
          flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 14,
          background: 'none', border: 'none', padding: 0, textAlign: 'left',
          cursor: target ? 'pointer' : 'default', color: 'inherit',
        }}
      >
        <div style={{ width: 60, height: 60, flexShrink: 0, borderRadius: 14, overflow: 'hidden', background: '#191919', border: '1px solid rgba(255,255,255,0.08)' }}>
          {dj.profile_image_url ? (
            <img src={getOptimizedImageUrl(dj.profile_image_url, { width: 120, height: 120 })} alt={dj.stage_name} loading="lazy"
              style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top', display: 'block' }} />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center' }}>
              <Music size={22} strokeWidth={2} color="#5A5A5E" />
            </div>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#fff', letterSpacing: '-0.01em', textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {dj.stage_name}
            </span>
            <DJTierBadge dj={dj} compact />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4, fontFamily: 'monospace', fontSize: 11, color: '#9A9A9A', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {dj.city && (<><MapPin size={12} strokeWidth={2} />{dj.city.toUpperCase()}</>)}
            {dj.music_genres.length > 0 && (
              <span style={{ color: '#5A5A5E' }}>
                {dj.city ? ' · ' : ''}{dj.music_genres.slice(0, 2).join(' · ').toUpperCase()}
              </span>
            )}
          </div>
          {mode === 'booker' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, fontSize: 11.5, color: '#B8B8BC' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Users size={12} strokeWidth={2} color="#7A7A7E" />
                {dj.followers_count.toLocaleString()}
              </span>
              {rate && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#E8E8EA', fontWeight: 600 }}>
                  {rate}
                </span>
              )}
              {showAvailability && dj.available != null && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: dj.available ? '#34D399' : '#FF5C63', fontWeight: 600 }}>
                  {dj.available
                    ? <><CalendarCheck size={12} strokeWidth={2.2} />{tt('Dispo', 'Free', 'Libre')}</>
                    : <><CalendarX size={12} strokeWidth={2.2} />{tt('Occupé', 'Busy', 'Ocupado')}</>}
                </span>
              )}
            </div>
          )}
        </div>
      </button>

      {/* Booker CTA */}
      {mode === 'booker' ? (
        <button
          onClick={() => onBook?.(dj)}
          style={{
            flexShrink: 0, padding: '9px 16px', borderRadius: 12,
            background: '#E8192C', color: '#fff', border: 'none',
            fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
          }}
        >
          {tt('Réserver', 'Book', 'Reservar')}
        </button>
      ) : (
        <span style={{ color: '#5A5A5E', fontSize: 18, flexShrink: 0 }}>→</span>
      )}
    </div>
  );
}
