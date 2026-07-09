import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { BottomNav } from '@/components/BottomNav';
import { getOptimizedImageUrl } from '@/lib/imageOptimization';
import { useLanguage } from '@/contexts/LanguageContext';
import { useUserLocation } from '@/hooks/useUserLocation';
import { haversineKm, cityMatches, NEAR_RADIUS_KM } from '@/lib/userLocation';
import { FadeInView } from '@/components/motion';
import { Seo } from '@/components/Seo';
import { PublicPage } from '@/components/PublicPage';

interface ClubRow {
  id: string;
  name: string;
  city: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  musicGenre: string | null;
  lat: number | null;
  lng: number | null;
}

export default function AllClubsPage() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { userLocation, city, hasLocation } = useUserLocation();
  const [clubs, setClubs] = useState<ClubRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('venues')
        .select('id, name, city, logo_url, cover_url, music_genre, latitude, longitude')
        .eq('is_hidden', false)
        .order('name', { ascending: true });
      setClubs(
        (data || []).map((v: any) => ({
          id: v.id,
          name: v.name,
          city: v.city,
          logoUrl: v.logo_url,
          coverUrl: v.cover_url,
          musicGenre: v.music_genre,
          lat: v.latitude,
          lng: v.longitude,
        })),
      );
      setLoading(false);
    })();
  }, []);

  // Connect to the visitor's location: only show clubs near them, hiding far/imprecise ones.
  // No filtering until we actually know where they are (so the page never goes empty blindly).
  const visible = useMemo(() => {
    if (!hasLocation) {
      return clubs.map((c) => ({ ...c, distance: null as number | null }));
    }
    if (userLocation) {
      return clubs
        .map((c) => ({
          ...c,
          distance: c.lat != null && c.lng != null ? haversineKm(userLocation.lat, userLocation.lng, c.lat, c.lng) : null,
        }))
        .filter((c) => c.distance != null && c.distance <= NEAR_RADIUS_KM)
        .sort((a, b) => (a.distance! - b.distance!));
    }
    // City known but no precise coords → match on city, drop the rest (and the city-less).
    return clubs
      .filter((c) => cityMatches(c.city, city))
      .map((c) => ({ ...c, distance: null as number | null }));
  }, [clubs, hasLocation, userLocation, city]);

  const emptyMsg = hasLocation ? t('allClubs.emptyNearby') : t('allClubs.empty');

  return (
    <div style={{ minHeight: '100dvh', background: '#0A0A0A', display: 'flex', flexDirection: 'column' }}>
      <Seo
        title="Nightclubs & Venues — Find Clubs Near You | Yuno"
        description="Browse the best nightclubs and venues near you. See what's on tonight, buy event tickets, book VIP bottle-service tables, and pre-order drinks. Discover clubs on Yuno."
        canonical="/clubs"
      />
      {/* ── Header ── */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 40,
          background: 'rgba(10,10,10,0.92)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          padding: '14px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
        }}
      >
        <button
          onClick={() => navigate(-1)}
          aria-label={t('djPublic.back')}
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.10)',
            borderRadius: '50%',
            width: 36,
            height: 36,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: '#fff',
            flexShrink: 0,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontFamily: 'monospace', fontSize: 10, color: '#5A5A5E', letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {hasLocation && city ? city.toUpperCase() : t('allClubs.kicker')}
          </p>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#fff', letterSpacing: '-0.01em', lineHeight: 1, textTransform: 'uppercase', margin: 0 }}>
            {t('allClubs.title')}
          </h1>
        </div>
        {!loading && visible.length > 0 && (
          <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 600, color: '#9A9A9A', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', padding: '4px 11px', borderRadius: 999, flexShrink: 0 }}>
            {visible.length}
          </span>
        )}
      </div>

      {/* ── List ── */}
      <PublicPage variant="discovery">
      <div style={{ flex: 1, width: '100%', maxWidth: 512, margin: '0 auto', padding: '18px 18px 96px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}>
            <div style={{ width: 28, height: 28, border: '3px solid rgba(255,255,255,0.15)', borderTopColor: '#E8192C', borderRadius: '50%', animation: 'allspin 0.7s linear infinite' }} />
            <style>{`@keyframes allspin{to{transform:rotate(360deg)}}`}</style>
          </div>
        ) : visible.length === 0 ? (
          <p style={{ textAlign: 'center', color: '#5A5A5E', fontFamily: 'monospace', fontSize: 13, padding: '48px 0' }}>
            {emptyMsg}
          </p>
        ) : (
          visible.map((c, i) => {
            const img = c.coverUrl || c.logoUrl;
            return (
              <FadeInView key={c.id} index={i < 6 ? i : 0}>
              <button
                onClick={() => {
                  sessionStorage.setItem('yuno_club_origin', 'explore');
                  navigate(`/club/${c.id}`);
                }}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  cursor: 'pointer',
                  color: 'inherit',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  padding: '12px 14px',
                  background: 'rgba(255,255,255,0.025)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 18,
                }}
              >
                <div style={{ width: 60, height: 60, flexShrink: 0, borderRadius: 14, overflow: 'hidden', background: '#191919', border: '1px solid rgba(255,255,255,0.08)' }}>
                  {img ? (
                    <img src={getOptimizedImageUrl(img, { width: 120, height: 120 })} alt={c.name} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: '#5A5A5E', fontWeight: 700, fontFamily: 'monospace', fontSize: 14 }}>
                      {c.name.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {c.name}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4, fontFamily: 'monospace', fontSize: 11, color: '#9A9A9A', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    <MapPin size={12} strokeWidth={2} />
                    {[
                      c.city ? c.city.toUpperCase() : null,
                      c.distance != null ? `${c.distance < 1 ? '<1' : Math.round(c.distance)} KM` : c.musicGenre ? c.musicGenre.toUpperCase() : null,
                    ].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <span style={{ color: '#5A5A5E', fontSize: 18, flexShrink: 0 }}>→</span>
              </button>
              </FadeInView>
            );
          })
        )}
      </div>
      </PublicPage>

      <BottomNav />
    </div>
  );
}
