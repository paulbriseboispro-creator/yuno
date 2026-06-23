import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { makeDjT } from '@/i18n/djTranslate';
import { DJFilterBar } from './DJFilterBar';
import { DJMarketplaceCard } from './DJMarketplaceCard';
import { BookingRequestDialog } from './BookingRequestDialog';
import { EMPTY_FILTERS, DEFAULT_BOOKER_RADIUS_KM, type MarketplaceDJ, type MarketplaceFilters, type DiscoveryMode, type ResidentScope } from './types';
import { geocodeCity } from '@/lib/geocode';

const PAGE = 40;

/**
 * Shared DJ discovery surface. mode='fan' on the public /djs page (no rate, no CTA),
 * mode='booker' inside owner/organizer dashboards (price/availability filters + Book CTA).
 * Ranking is server-side (search_djs_marketplace) — the best-kept profiles rise.
 *
 * `initialCity` pre-seeds the city facet (the booker's home city) so a club/organizer
 * first sees local DJs; it stays editable and clearable in the filter bar. `cityReady`
 * holds the very first query until that city is known, so results never flash world
 * then local. Both default to "no home city" for the public fan page.
 */
export function DJDiscovery({
  mode,
  initialCity = null,
  cityReady = true,
}: {
  mode: DiscoveryMode;
  initialCity?: string | null;
  cityReady?: boolean;
}) {
  const { language } = useLanguage();
  const tt = makeDjT(language);

  const [filters, setFilters] = useState<MarketplaceFilters>(EMPTY_FILTERS);
  const [djs, setDjs] = useState<MarketplaceDJ[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [bookTarget, setBookTarget] = useState<MarketplaceDJ | null>(null);
  const [viewTarget, setViewTarget] = useState<MarketplaceDJ | null>(null);
  const reqId = useRef(0);
  const seeded = useRef(false);

  // Seed the city facet (booker's home city) + a default radius once, the moment
  // the home city is known. After this the user owns the filters — clearing the
  // city or changing the radius is never overridden (the one-shot `seeded` guard).
  useEffect(() => {
    if (seeded.current || !cityReady) return;
    seeded.current = true;
    setFilters((f) => ({
      ...f,
      city: initialCity ?? f.city,
      radiusKm: mode === 'booker' ? DEFAULT_BOOKER_RADIUS_KM : f.radiusKm,
    }));
  }, [cityReady, initialCity, mode]);

  const openProfileTab = (dj: MarketplaceDJ) => {
    const target = dj.handle || dj.slug;
    if (target) window.open(`/dj/${target}`, '_blank', 'noopener,noreferrer');
    setViewTarget(null);
  };

  const fetchPage = useCallback(async (offset: number, replace: boolean) => {
    const id = ++reqId.current;
    if (replace) setLoading(true); else setLoadingMore(true);

    // Booker radius mode: geocode the origin (typed city, else the home city) and
    // filter DJs by distance. The exact-city param is dropped — radius supersedes it.
    // "Partout" (radiusKm null) skips geo entirely and falls back to exact city.
    let p_city: string | undefined = filters.city ?? undefined;
    let p_origin_lat: number | undefined;
    let p_origin_lng: number | undefined;
    let p_radius_km: number | undefined;
    if (mode === 'booker' && filters.radiusKm != null) {
      const coords = await geocodeCity(filters.city || initialCity);
      if (id !== reqId.current) return; // superseded while geocoding
      if (coords) {
        p_origin_lat = coords.lat;
        p_origin_lng = coords.lng;
        p_radius_km = filters.radiusKm;
        p_city = undefined;
      }
    }

    const { data, error } = await supabase.rpc('search_djs_marketplace', {
      p_genre: filters.genre ?? undefined,
      p_city,
      p_played_venue: filters.playedVenue ?? undefined,
      p_min_followers: filters.minFollowers ?? undefined,
      p_min_fee: filters.minFee ?? undefined,
      p_max_fee: filters.maxFee ?? undefined,
      p_available_on: filters.availableOn ?? undefined,
      p_booker_mode: mode === 'booker',
      p_origin_lat,
      p_origin_lng,
      p_radius_km,
      p_limit: PAGE,
      p_offset: offset,
    });
    if (id !== reqId.current) return; // a newer query superseded this one
    const rows: MarketplaceDJ[] = (data || []).map((r) => ({
      ...(r as unknown as MarketplaceDJ),
      resident_scopes: ((r as { resident_scopes?: unknown }).resident_scopes as ResidentScope[]) || [],
      music_genres: ((r as { music_genres?: string[] }).music_genres) || [],
    }));
    if (error) console.error('search_djs_marketplace failed', error);
    setHasMore(rows.length === PAGE);
    setDjs((prev) => (replace ? rows : [...prev, ...rows]));
    setLoading(false); setLoadingMore(false);
  }, [filters, mode, initialCity]);

  // Debounced refetch whenever filters change. Hold the first query until the
  // home city is known so we don't fetch the world and then re-fetch local.
  useEffect(() => {
    if (!cityReady) return;
    const h = setTimeout(() => fetchPage(0, true), 250);
    return () => clearTimeout(h);
  }, [fetchPage, cityReady]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <DJFilterBar mode={mode} value={filters} onChange={setFilters} />

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}>
          <div style={{ width: 28, height: 28, border: '3px solid rgba(255,255,255,0.15)', borderTopColor: '#E8192C', borderRadius: '50%', animation: 'djmspin 0.7s linear infinite' }} />
          <style>{`@keyframes djmspin{to{transform:rotate(360deg)}}`}</style>
        </div>
      ) : djs.length === 0 ? (
        <p style={{ textAlign: 'center', color: '#5A5A5E', fontFamily: 'monospace', fontSize: 13, padding: '48px 0' }}>
          {tt('Aucun DJ ne correspond.', 'No DJs match.', 'Ningún DJ coincide.')}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {djs.map((dj) => (
            <DJMarketplaceCard
              key={dj.user_id}
              dj={dj}
              mode={mode}
              showAvailability={!!filters.availableOn}
              onBook={setBookTarget}
              onViewProfile={setViewTarget}
            />
          ))}
          {hasMore && (
            <button
              onClick={() => fetchPage(djs.length, false)}
              disabled={loadingMore}
              style={{ alignSelf: 'center', marginTop: 8, padding: '10px 22px', borderRadius: 999, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              {loadingMore ? tt('Chargement...', 'Loading...', 'Cargando...') : tt('Voir plus', 'Load more', 'Ver más')}
            </button>
          )}
        </div>
      )}

      {mode === 'booker' && (
        <>
          <BookingRequestDialog
            dj={bookTarget}
            open={!!bookTarget}
            onOpenChange={(o) => { if (!o) setBookTarget(null); }}
          />

          {/* Stay on the booking page; offer the profile in a new tab. */}
          <Dialog open={!!viewTarget} onOpenChange={(o) => { if (!o) setViewTarget(null); }}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>{tt('Voir le profil ?', 'View profile?', '¿Ver perfil?')}</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                {tt(
                  `Ouvrir le profil Yuno de ${viewTarget?.stage_name ?? ''} dans un nouvel onglet ? Tu restes sur la page de booking.`,
                  `Open ${viewTarget?.stage_name ?? ''}'s Yuno profile in a new tab? You stay on the booking page.`,
                  `¿Abrir el perfil Yuno de ${viewTarget?.stage_name ?? ''} en una pestaña nueva? Te quedas en la página de reservas.`,
                )}
              </p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                <button
                  onClick={() => setViewTarget(null)}
                  style={{ padding: '9px 16px', borderRadius: 11, background: 'transparent', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.12)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                >
                  {tt('Annuler', 'Cancel', 'Cancelar')}
                </button>
                <button
                  onClick={() => viewTarget && openProfileTab(viewTarget)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 11, background: '#E8192C', color: '#fff', border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                >
                  <ExternalLink size={15} />{tt('Ouvrir', 'Open', 'Abrir')}
                </button>
              </div>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
