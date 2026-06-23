import { useRef, useMemo, useCallback, useState, useEffect } from 'react';
import { motion, useMotionValue, useTransform, animate, PanInfo, useDragControls, useReducedMotion } from 'framer-motion';
import { MapPin, Music, ChevronUp, ChevronDown } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { MapVenue } from './VenueMap';
import { calculateDistance } from './VenueMap';

interface VenueMapBottomSheetProps {
  venues: MapVenue[];
  userLocation: { lat: number; lng: number } | null;
  onVenueSelect: (venueId: string) => void;
}

const COLLAPSED_H = 80;
const HALF_RATIO = 0.45;
const EXPANDED_RATIO = 0.82;
const VISIBLE_IN_HALF = 3; // How many clubs fit in half view

type SheetState = 'collapsed' | 'half' | 'expanded';

export default function VenueMapBottomSheet({ venues, userLocation, onVenueSelect }: VenueMapBottomSheetProps) {
  const { t } = useLanguage();
  const reduceMotion = useReducedMotion();
  const sheetState = useRef<SheetState>('collapsed');
  const height = useMotionValue(COLLAPSED_H);
  const dragControls = useDragControls();
  const [currentState, setCurrentState] = useState<SheetState>('collapsed');

  const getHeights = useCallback(() => {
    const vh = window.innerHeight;
    return {
      collapsed: COLLAPSED_H,
      half: Math.round(vh * HALF_RATIO),
      expanded: Math.round(vh * EXPANDED_RATIO),
    };
  }, []);

  const snapTo = useCallback((state: SheetState) => {
    const heights = getHeights();
    sheetState.current = state;
    setCurrentState(state);
    animate(height, heights[state], reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 300, damping: 30 });
  }, [getHeights, height, reduceMotion]);

  // Auto-open to half when venues arrive
  // No auto-open: sheet starts collapsed

  const handleDragEnd = useCallback((_: any, info: PanInfo) => {
    const velocity = info.velocity.y;
    const currentH = height.get();
    const h = getHeights();

    if (velocity > 400) {
      if (sheetState.current === 'expanded') snapTo('half');
      else snapTo('collapsed');
      return;
    }
    if (velocity < -400) {
      if (sheetState.current === 'collapsed') snapTo('half');
      else snapTo('expanded');
      return;
    }

    const midColHalf = (h.collapsed + h.half) / 2;
    const midHalfExp = (h.half + h.expanded) / 2;

    if (currentH < midColHalf) snapTo('collapsed');
    else if (currentH < midHalfExp) snapTo('half');
    else snapTo('expanded');
  }, [getHeights, snapTo, height]);

  const sortedVenues = useMemo(() => {
    if (!userLocation) return venues;
    return venues
      .map((v) => {
        const km = v.latitude && v.longitude
          ? calculateDistance(userLocation.lat, userLocation.lng, v.latitude, v.longitude)
          : Infinity;
        return { v, km };
      })
      .sort((a, b) => a.km - b.km)
      .map(({ v }) => v);
  }, [venues, userLocation]);

  const formatDist = (venue: MapVenue): string | null => {
    if (!userLocation || !venue.latitude || !venue.longitude) return null;
    const km = calculateDistance(userLocation.lat, userLocation.lng, venue.latitude, venue.longitude);
    if (km < 1) return `${Math.round(km * 1000)}m`;
    return `${km.toFixed(1)}km`;
  };

  const h = getHeights();
  const contentOpacity = useTransform(height, [h.collapsed + 10, h.collapsed + 60], [0, 1]);

  const hasMore = sortedVenues.length > VISIBLE_IN_HALF;

  // Header button: collapsed → open half, half/expanded → collapse
  const handleHeaderButton = () => {
    if (currentState === 'collapsed') {
      snapTo('half');
    } else {
      snapTo('collapsed');
    }
  };

  return (
    <motion.div
      className="fixed left-0 right-0 z-30 mx-auto max-w-lg"
      style={{
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 72px)',
        height,
      }}
      drag="y"
      dragListener={false}
      dragControls={dragControls}
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={0}
      onDrag={(_, info) => {
        const delta = -info.delta.y;
        const newH = Math.max(h.collapsed, Math.min(h.expanded, height.get() + delta));
        height.set(newH);
      }}
      onDragEnd={handleDragEnd}
    >
      <div
        className="h-full rounded-2xl overflow-hidden flex flex-col mx-1"
        style={{
          background: 'linear-gradient(180deg, hsl(0 0% 8% / 0.97) 0%, hsl(0 0% 5% / 0.98) 100%)',
          backdropFilter: 'blur(32px)',
          WebkitBackdropFilter: 'blur(32px)',
          borderTop: '1px solid hsl(0 0% 100% / 0.1)',
          borderLeft: '1px solid hsl(0 0% 100% / 0.05)',
          borderRight: '1px solid hsl(0 0% 100% / 0.05)',
          boxShadow: '0 -8px 40px rgba(0,0,0,0.6), inset 0 1px 0 hsl(0 0% 100% / 0.06)',
        }}
      >
        {/* Handle zone */}
        <div
          className="flex flex-col items-center pt-3 pb-1 cursor-grab active:cursor-grabbing touch-none"
          onPointerDown={(e) => dragControls.start(e)}
          onDoubleClick={handleHeaderButton}
        >
          <div className="w-9 h-[3px] rounded-full bg-muted-foreground/40" />
        </div>

        {/* Header */}
        <div
          className="px-4 pb-3 flex items-center justify-between touch-none"
          onPointerDown={(e) => dragControls.start(e)}
        >
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-primary/15">
              <MapPin className="w-3.5 h-3.5 text-primary" />
            </div>
            <span className="text-sm font-bold text-foreground">
              {sortedVenues.length} {sortedVenues.length === 1 ? 'club' : 'clubs'}
            </span>
          </div>
          <button
            className="flex items-center gap-1 text-xs text-primary font-semibold px-3 py-1.5 rounded-full bg-primary/10 active:bg-primary/20 transition-colors"
            onClick={handleHeaderButton}
          >
            {currentState === 'collapsed' ? (
              <>
                {t('welcome.seeAll')}
                <ChevronUp className="w-3 h-3" />
              </>
            ) : (
              <>
                {t('welcome.reduce')}
                <ChevronDown className="w-3 h-3" />
              </>
            )}
          </button>
        </div>

        {/* Scrollable list */}
        <motion.div
          className="flex-1 overflow-y-auto overscroll-contain px-2 pb-4"
          style={{ opacity: contentOpacity }}
        >
          <div className="space-y-0.5">
            {sortedVenues.map((venue, idx) => {
              // In half state, only show first N venues
              if (currentState === 'half' && idx >= VISIBLE_IN_HALF) return null;

              const dist = formatDist(venue);
              return (
                <button
                  key={venue.id}
                  className="w-full flex items-center gap-3 p-3 rounded-xl transition-all hover:bg-muted/15 active:bg-muted/25 active:scale-[0.98] text-left group"
                  onClick={() => onVenueSelect(venue.id)}
                >
                  {venue.logo_url ? (
                    <img
                      src={venue.logo_url}
                      alt={venue.name}
                      className="w-11 h-11 rounded-full object-cover flex-shrink-0 border border-border/40 group-hover:border-primary/30 transition-colors"
                    />
                  ) : (
                    <div className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-primary/80 to-primary text-primary-foreground font-bold text-sm shadow-lg shadow-primary/20">
                      {venue.name.charAt(0)}
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                      {venue.name}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                      <MapPin className="w-3 h-3 flex-shrink-0 text-muted-foreground/60" />
                      <span className="truncate">{venue.city}</span>
                      {dist && (
                        <span className="text-primary/70 font-medium">· {dist}</span>
                      )}
                    </div>
                  </div>

                  {venue.todayEvent && (
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/15 border border-primary/20 flex-shrink-0">
                      <Music className="w-3 h-3 text-primary" />
                      <span className="text-[10px] font-semibold text-primary max-w-[60px] truncate">
                        {t('welcome.tonight')}
                      </span>
                    </div>
                  )}
                </button>
              );
            })}

            {/* "See more" button when in half state and more clubs exist */}
            {currentState === 'half' && hasMore && (
              <button
                onClick={() => snapTo('expanded')}
                className="w-full flex items-center justify-center gap-2 py-3 mt-1 rounded-xl bg-primary/10 hover:bg-primary/15 active:bg-primary/20 transition-colors"
              >
                <span className="text-xs font-semibold text-primary">
                  {t('welcome.seeMore') || `Voir les ${sortedVenues.length - VISIBLE_IN_HALF} autres`}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-primary" />
              </button>
            )}

            {sortedVenues.length === 0 && (
              <div className="text-center py-10 text-muted-foreground text-sm">
                <MapPin className="w-5 h-5 mx-auto mb-2 text-muted-foreground/40" />
                {t('welcome.noClubsVisible')}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
