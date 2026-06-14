import { useState, useRef, useEffect } from 'react';
import { Search, X, Loader2, MapPin } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';

interface SearchResult {
  place_name: string;
  center: [number, number];
}

interface VenueMapSearchProps {
  onSearch: (center: [number, number], placeName: string) => void;
}

const VenueMapSearch = ({ onSearch }: VenueMapSearchProps) => {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowResults(false);
        setIsFocused(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const searchCity = async (searchQuery: string) => {
    if (searchQuery.length < 2) {
      setResults([]);
      setShowResults(false);
      return;
    }

    setLoading(true);
    try {
      let token = import.meta.env.VITE_MAPBOX_TOKEN;
      if (!token) {
        const { data, error } = await supabase.functions.invoke('get-mapbox-token');
        if (error || !data?.token) throw new Error('Failed to get token');
        token = data.token;
      }

      const response = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(searchQuery)}.json?` +
        `access_token=${token}&types=place,locality,neighborhood&limit=5&language=fr,en,es`
      );

      if (!response.ok) throw new Error('Geocoding failed');

      const geoData = await response.json();
      const mapped: SearchResult[] = geoData.features?.map((f: any) => ({
        place_name: f.place_name,
        center: f.center as [number, number],
      })) || [];
      setResults(mapped);
      setShowResults(mapped.length > 0);
    } catch (err) {
      console.error('Search error:', err);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value) {
      setResults([]);
      setShowResults(false);
      return;
    }
    debounceRef.current = setTimeout(() => searchCity(value), 300);
  };

  const handleSelectResult = (result: SearchResult) => {
    const city = result.place_name.split(',')[0].trim();
    setQuery(city);
    setShowResults(false);
    setIsFocused(false);
    onSearch(result.center, result.place_name);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (results.length > 0) handleSelectResult(results[0]);
  };

  const clearSearch = () => {
    setQuery('');
    setResults([]);
    setShowResults(false);
    inputRef.current?.focus();
  };

  const getPrimaryName = (place_name: string) => place_name.split(',')[0].trim();
  const getSecondaryName = (place_name: string) => {
    const parts = place_name.split(',');
    return parts.length > 1 ? parts.slice(1).join(',').trim() : '';
  };

  return (
    <div ref={searchRef} className="relative flex-1">
      <form onSubmit={handleSubmit}>
        <div
          className={`
            flex items-center gap-2.5 rounded-2xl border px-3.5 h-10
            bg-card/95 backdrop-blur-xl
            transition-all duration-200
            ${isFocused
              ? 'border-primary/50 shadow-glow-sm'
              : 'border-border/50 shadow-soft'
            }
          `}
        >
          {loading ? (
            <Loader2 className="w-4 h-4 shrink-0 text-primary animate-spin" />
          ) : (
            <Search
              className={`w-4 h-4 shrink-0 transition-colors duration-200 ${
                isFocused ? 'text-primary' : 'text-muted-foreground'
              }`}
            />
          )}
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleInputChange(e.target.value)}
            onFocus={() => {
              setIsFocused(true);
              if (results.length > 0) setShowResults(true);
            }}
            placeholder={t('welcome.searchCity') || 'Rechercher une ville...'}
            autoComplete="off"
            className="flex-1 min-w-0 bg-transparent text-sm font-medium text-foreground placeholder:text-muted-foreground placeholder:font-normal outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={clearSearch}
              className="shrink-0 p-1 rounded-full bg-muted hover:bg-muted/80 transition-colors"
            >
              <X className="w-3 h-3 text-muted-foreground" />
            </button>
          )}
        </div>
      </form>

      {/* Results dropdown — rendered above filter chips via parent z-20 context */}
      {showResults && results.length > 0 && (
        <div
          className="absolute top-full left-0 right-0 mt-2 bg-card border border-border/60 rounded-2xl shadow-card-hover overflow-hidden animate-scale-in"
          style={{ transformOrigin: 'top center' }}
        >
          {results.map((result, index) => (
            <button
              key={index}
              type="button"
              onClick={() => handleSelectResult(result)}
              className="w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors duration-150 hover:bg-primary/10 active:bg-primary/20 border-b border-border/20 last:border-b-0"
            >
              <div className="shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                <MapPin className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">
                  {getPrimaryName(result.place_name)}
                </p>
                {getSecondaryName(result.place_name) && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {getSecondaryName(result.place_name)}
                  </p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default VenueMapSearch;
