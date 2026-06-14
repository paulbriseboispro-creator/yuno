import { useEffect, useRef, useState } from 'react';
import { Loader2, MapPin, Search, X } from 'lucide-react';
import { RED, POS, T1, T2, T3, BORDER, INNER_BG } from '@/components/affiliate/affiliate-ui';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string;

interface GeoResult {
  place_name: string;
  center: [number, number]; // [lng, lat]
}

interface AffiliateAddressSearchProps {
  address: string;
  lat: number | null;
  lng: number | null;
  onSelect: (address: string, lat: number, lng: number) => void;
  onClear: () => void;
}

export function AffiliateAddressSearch({ address, lat, lng, onSelect, onClear }: AffiliateAddressSearchProps) {
  const [query, setQuery] = useState(address);
  const [results, setResults] = useState<GeoResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync query when address prop changes externally (e.g. edit mode init)
  useEffect(() => {
    setQuery(address);
  }, [address]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const search = async (q: string) => {
    if (q.length < 3) { setResults([]); return; }
    setLoading(true);
    try {
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?` +
        `access_token=${MAPBOX_TOKEN}&types=address,poi,place&limit=5&language=fr,es,en`
      );
      if (!res.ok) return;
      const data = await res.json();
      setResults(data.features ?? []);
      setShowResults(true);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), 350);
  };

  const handleSelect = (result: GeoResult) => {
    const [resLng, resLat] = result.center;
    setQuery(result.place_name);
    setResults([]);
    setShowResults(false);
    onSelect(result.place_name, resLat, resLng);
  };

  const handleClear = () => {
    setQuery('');
    setResults([]);
    onClear();
  };

  const staticMapUrl = lat && lng
    ? `https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/` +
      `pin-s+E8192C(${lng},${lat})/${lng},${lat},14/600x200?access_token=${MAPBOX_TOKEN}`
    : null;

  const inputStyle: React.CSSProperties = {
    background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10,
    color: T1, fontSize: 13.5,
  };

  return (
    <div className="space-y-3">
      <p style={{ color: T2, fontSize: 12.5, fontWeight: 600 }}>Adresse et localisation</p>

      {/* Search input */}
      <div ref={containerRef} className="relative">
        <div className="relative flex items-center">
          <Search className="absolute left-3 w-4 h-4 pointer-events-none" style={{ color: T3 }} />
          <input
            type="text"
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            onFocus={() => results.length > 0 && setShowResults(true)}
            placeholder="Rechercher une adresse…"
            className="w-full outline-none transition-colors"
            style={{ ...inputStyle, padding: '10px 36px' }}
            onFocusCapture={(e) => (e.currentTarget.style.borderColor = 'rgba(232,25,44,0.55)')}
            onBlur={(e) => (e.currentTarget.style.borderColor = BORDER)}
          />
          {loading && <Loader2 className="absolute right-3 w-4 h-4 animate-spin" style={{ color: T3 }} />}
          {!loading && query && (
            <button type="button" onClick={handleClear} className="absolute right-3 transition-colors" style={{ color: T3 }}
              onMouseEnter={(e) => (e.currentTarget.style.color = T1)} onMouseLeave={(e) => (e.currentTarget.style.color = T3)}>
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Dropdown */}
        {showResults && results.length > 0 && (
          <div className="absolute top-full left-0 right-0 z-50 mt-1 rounded-xl overflow-hidden"
            style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, boxShadow: '0 18px 40px -20px rgba(0,0,0,.9)' }}>
            {results.map((r, i) => (
              <button key={i} type="button" onClick={() => handleSelect(r)}
                className="w-full flex items-start gap-3 px-4 py-3 text-left transition-colors"
                style={{ borderBottom: `1px solid ${BORDER}` }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                <MapPin className="w-4 h-4 mt-0.5 flex-none" style={{ color: RED }} />
                <span style={{ color: T1, fontSize: 13, lineHeight: 1.4 }}>{r.place_name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Coordinates display */}
      {lat && lng ? (
        <div className="space-y-2">
          <div className="flex items-center gap-3 px-3 py-2 rounded-lg" style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.22)' }}>
            <MapPin className="w-4 h-4 flex-none" style={{ color: POS }} />
            <span className="tabular-nums" style={{ color: POS, fontSize: 11.5, fontFamily: 'monospace' }}>{lat.toFixed(6)}, {lng.toFixed(6)}</span>
            <span style={{ color: T3, fontSize: 11, marginLeft: 'auto' }}>Localisé ✓</span>
          </div>
          {staticMapUrl && (
            <img src={staticMapUrl} alt="Aperçu carte" className="w-full h-36 object-cover rounded-xl" style={{ border: `1px solid ${BORDER}` }} />
          )}
        </div>
      ) : (
        <p style={{ color: T3, fontSize: 11 }}>Recherche une adresse pour afficher le club sur la map Yuno.</p>
      )}
    </div>
  );
}
