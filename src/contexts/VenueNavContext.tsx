import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

interface VenueNavContextType {
  currentVenueSlug: string | null;
  setCurrentVenueSlug: (slug: string | null) => void;
}

const VenueNavContext = createContext<VenueNavContextType>({
  currentVenueSlug: null,
  setCurrentVenueSlug: () => {},
});

export function VenueNavProvider({ children }: { children: ReactNode }) {
  const [currentVenueSlug, setCurrentVenueSlug] = useState<string | null>(null);
  const location = useLocation();

  // Auto-detect venue slug from URL and clear when leaving venue routes
  useEffect(() => {
    const match = location.pathname.match(/^\/club\/([^/]+)/);
    if (match) {
      setCurrentVenueSlug(match[1]);
    } else {
      setCurrentVenueSlug(null);
    }
  }, [location.pathname]);

  return (
    <VenueNavContext.Provider value={{ currentVenueSlug, setCurrentVenueSlug }}>
      {children}
    </VenueNavContext.Provider>
  );
}

export function useVenueNav() {
  return useContext(VenueNavContext);
}
