import { lazy, Suspense, useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, PanInfo } from 'framer-motion';
import { useNavigate } from 'react-router-dom';

const VenueMap = lazy(() => import('@/components/welcome/VenueMap').then(m => ({ default: m.default })));

interface MapVenue {
  id: string;
  name: string;
  city: string;
  latitude: number | null;
  longitude: number | null;
  logo_url: string | null;
}

interface MapOverlayProps {
  open: boolean;
  onClose: () => void;
  venues: MapVenue[];
}

export function MapOverlay({ open, onClose, venues }: MapOverlayProps) {
  const navigate = useNavigate();
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      navigator.geolocation?.getCurrentPosition(
        pos => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {}
      );
    }
  }, [open]);

  const handleRequestLocation = () => {
    navigator.geolocation?.getCurrentPosition(
      pos => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {}
    );
  };

  const handleDragEnd = (_: any, info: PanInfo) => {
    if (info.offset.y > 100) {
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={containerRef}
          className="fixed inset-0 z-50 bg-background flex flex-col"
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={0.2}
          onDragEnd={handleDragEnd}
        >
          {/* Swipe indicator */}
          <div className="flex justify-center pb-1" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)' }}>
            <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
          </div>

          <Suspense fallback={<div className="flex-1 flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>}>
            <div className="flex-1 min-h-0 relative">
              <div className="absolute inset-0">
                <VenueMap
                  venues={venues}
                  allVenues={venues}
                  onVenueClick={(venueId) => {
                    sessionStorage.setItem('yuno_club_origin', 'map');
                    navigate(`/club/${venueId}`);
                  }}
                  userLocation={userLocation}
                  onRequestLocation={handleRequestLocation}
                  onClose={onClose}
                />
              </div>
            </div>
          </Suspense>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
