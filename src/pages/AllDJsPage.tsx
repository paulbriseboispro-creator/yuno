import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin, Music, BadgeCheck } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { BottomNav } from '@/components/BottomNav';
import { getOptimizedImageUrl } from '@/lib/imageOptimization';
import { useLanguage } from '@/contexts/LanguageContext';
import { useUserLocation } from '@/hooks/useUserLocation';
import { cityMatches } from '@/lib/userLocation';

interface DJRow {
  id: string;
  slug: string | null;
  stageName: string;
  city: string | null;
  profileImageUrl: string | null;
  musicGenres: string[];
  isVerified: boolean;
}

export default function AllDJsPage() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { city, hasLocation } = useUserLocation();
  const [djs, setDjs] = useState<DJRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      // Read the security-definer djs_public view (anon-safe), never the djs table.
      const { data } = await supabase
        .from('djs_public')
        .select('id, slug, stage_name, first_name, last_name, profile_image_url, music_genres, city, is_verified, is_active')
        .eq('is_active', true);

      // A DJ can have several scoped rows (one per club/org); the view has no user_id,
      // so dedupe by display name and keep the richest record (photo, then a city).
      const byPerson = new Map<string, any>();
      for (const d of data || []) {
        const name = (d.stage_name || `${d.first_name ?? ''} ${d.last_name ?? ''}`).trim();
        if (!name) continue;
        const key = name.toLowerCase();
        const prev = byPerson.get(key);
        const score = (r: any) => (r.profile_image_url ? 2 : 0) + (r.city ? 1 : 0);
        if (!prev || score(d) > score(prev)) byPerson.set(key, d);
      }

      const rows: DJRow[] = [...byPerson.values()]
        .map((d: any) => ({
          id: d.id,
          slug: d.slug,
          stageName: (d.stage_name || `${d.first_name ?? ''} ${d.last_name ?? ''}`).trim(),
          city: d.city,
          profileImageUrl: d.profile_image_url,
          musicGenres: d.music_genres || [],
          isVerified: !!d.is_verified,
        }))
        .sort((a, b) => a.stageName.localeCompare(b.stageName));

      setDjs(rows);
      setLoading(false);
    })();
  }, []);

  // Connect to the visitor's location. DJs have no coordinates, only a home city, so we scope
  // by city: when we know where the visitor is, show DJs based in that city and hide the rest
  // (and the city-less ones). No city signal → show everyone.
  const visible = useMemo(() => {
    if (!hasLocation) return djs;
    return djs.filter((d) => cityMatches(d.city, city));
  }, [djs, hasLocation, city]);

  const emptyMsg = hasLocation ? t('allDJs.emptyNearby') : t('allDJs.empty');

  return (
    <div style={{ minHeight: '100dvh', background: '#0A0A0A', display: 'flex', flexDirection: 'column' }}>
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
            {hasLocation && city ? city.toUpperCase() : t('allDJs.kicker')}
          </p>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#fff', letterSpacing: '-0.01em', lineHeight: 1, textTransform: 'uppercase', margin: 0 }}>
            {t('allDJs.title')}
          </h1>
        </div>
        {!loading && visible.length > 0 && (
          <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 600, color: '#9A9A9A', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', padding: '4px 11px', borderRadius: 999, flexShrink: 0 }}>
            {visible.length}
          </span>
        )}
      </div>

      {/* ── List ── */}
      <div style={{ flex: 1, width: '100%', maxWidth: 512, margin: '0 auto', padding: '18px 18px 96px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}>
            <div style={{ width: 28, height: 28, border: '3px solid rgba(255,255,255,0.15)', borderTopColor: '#E8192C', borderRadius: '50%', animation: 'alldjspin 0.7s linear infinite' }} />
            <style>{`@keyframes alldjspin{to{transform:rotate(360deg)}}`}</style>
          </div>
        ) : visible.length === 0 ? (
          <p style={{ textAlign: 'center', color: '#5A5A5E', fontFamily: 'monospace', fontSize: 13, padding: '48px 0' }}>
            {emptyMsg}
          </p>
        ) : (
          visible.map((dj) => (
            <button
              key={dj.id}
              onClick={() => dj.slug && navigate(`/dj/${dj.slug}`)}
              disabled={!dj.slug}
              style={{
                width: '100%',
                textAlign: 'left',
                cursor: dj.slug ? 'pointer' : 'default',
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
                {dj.profileImageUrl ? (
                  <img src={getOptimizedImageUrl(dj.profileImageUrl, { width: 120, height: 120 })} alt={dj.stageName} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top', display: 'block' }} />
                ) : (
                  <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center' }}>
                    <Music size={22} strokeWidth={2} color="#5A5A5E" />
                  </div>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 16, fontWeight: 700, color: '#fff', letterSpacing: '-0.01em', textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {dj.stageName}
                  </span>
                  {dj.isVerified && <BadgeCheck size={15} className="text-primary" style={{ flexShrink: 0 }} />}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4, fontFamily: 'monospace', fontSize: 11, color: '#9A9A9A', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {dj.city && (
                    <>
                      <MapPin size={12} strokeWidth={2} />
                      {dj.city.toUpperCase()}
                    </>
                  )}
                  {dj.musicGenres.length > 0 && (
                    <span style={{ color: '#5A5A5E' }}>
                      {dj.city ? ' · ' : ''}
                      {dj.musicGenres.slice(0, 2).join(' · ').toUpperCase()}
                    </span>
                  )}
                </div>
              </div>
              <span style={{ color: '#5A5A5E', fontSize: 18, flexShrink: 0 }}>→</span>
            </button>
          ))
        )}
      </div>

      <BottomNav />
    </div>
  );
}
