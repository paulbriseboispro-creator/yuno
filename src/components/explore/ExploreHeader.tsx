import { useState, useEffect, useRef } from 'react';
import { Search, SlidersHorizontal, ChevronDown, MapPin, Navigation, Loader2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import yunoLogo from '@/assets/yuno-logo-red.png';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { getCurrentPosition } from '@/lib/geolocation';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { Drawer, DrawerContent } from '@/components/ui/drawer';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';

interface ExploreHeaderProps {
  city: string;
  selectedDate: Date | null;
  dateLabel: string;
  dateFilter: 'today' | 'tomorrow' | 'weekend' | 'week';
  onDateSelect: (date: Date | null, preset?: string) => void;
  onSearchFocus: () => void;
  onFiltersOpen: () => void;
  onCityChange: (city: string, coords?: { lat: number; lng: number }) => void;
  activeFiltersCount?: number;
}

export function ExploreHeader({ city, selectedDate, dateLabel, dateFilter, onDateSelect, onSearchFocus, onFiltersOpen, onCityChange, activeFiltersCount = 0 }: ExploreHeaderProps) {
  const { t, language } = useLanguage();
  const calendarLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [cityDialogOpen, setCityDialogOpen] = useState(false);
  const [citySearch, setCitySearch] = useState('');
  const [citySuggestions, setCitySuggestions] = useState<Array<{ name: string; displayName: string; lat: number; lng: number }>>([]);
  const [geoLoading, setGeoLoading] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  const handleDateSelect = (date: Date | undefined) => {
    if (date) {
      onDateSelect(date);
      setCalendarOpen(false);
    }
  };

  const handlePreset = (preset: string) => {
    onDateSelect(null, preset);
    // Don't close calendar so user can see the highlighted days
  };

  // Compute highlighted dates for presets
  const getPresetDates = (): Date[] => {
    if (selectedDate) return [selectedDate];
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (dateFilter === 'today') return [today];
    if (dateFilter === 'tomorrow') {
      const tmr = new Date(today);
      tmr.setDate(tmr.getDate() + 1);
      return [tmr];
    }
    // weekend: Thursday evening → Saturday evening
    const dayOfWeek = today.getDay();
    let daysUntilThu: number;
    if (dayOfWeek === 0) daysUntilThu = 4;
    else if (dayOfWeek <= 3) daysUntilThu = 4 - dayOfWeek;
    else if (dayOfWeek === 4) daysUntilThu = 0;
    else daysUntilThu = 7 - dayOfWeek + 4;
    const thu = new Date(today);
    thu.setDate(thu.getDate() + daysUntilThu);
    const fri = new Date(thu);
    fri.setDate(fri.getDate() + 1);
    const sat = new Date(thu);
    sat.setDate(sat.getDate() + 2);
    return [thu, fri, sat];
  };

  const highlightedDates = getPresetDates();

  const handleUseLocation = () => {
    setGeoLoading(true);
    getCurrentPosition(
      async (pos) => {
        try {
          let cityName = city;
          const token = import.meta.env.VITE_MAPBOX_TOKEN;
          if (token) {
            const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${pos.coords.longitude},${pos.coords.latitude}.json?access_token=${token}&types=place&limit=1`);
            const data = await res.json();
            const feature = data.features?.[0];
            if (feature) cityName = feature.text || feature.place_name || city;
          } else {
            const { data } = await supabase.functions.invoke('geocode-address', {
              body: { lat: pos.coords.latitude, lng: pos.coords.longitude, reverse: true }
            });
            cityName = data?.city || data?.name || city;
          }
          onCityChange(cityName, { lat: pos.coords.latitude, lng: pos.coords.longitude });
        } catch (e) {
          console.error("Geocoding reverse failed:", e);
          onCityChange(city, { lat: pos.coords.latitude, lng: pos.coords.longitude });
        }
        setGeoLoading(false);
        setCityDialogOpen(false);
      },
      (error) => {
        console.error('Geolocation error:', error);
        toast.error(t('explore.locationError') || "Impossible d'obtenir votre position. Vérifiez les permissions de votre navigateur.");
        setGeoLoading(false);
      }
    );
  };

  useEffect(() => {
    if (citySearch.length < 2) {
      setCitySuggestions([]);
      return;
    }
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      try {
        const token = import.meta.env.VITE_MAPBOX_TOKEN;
        if (token) {
          const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(citySearch)}.json?access_token=${token}&types=place&limit=5&autocomplete=true`);
          const data = await res.json();
          if (data.features) {
            setCitySuggestions(data.features.map((f: any) => ({
              name: f.text || f.place_name?.split(',')[0] || 'Unknown',
              displayName: f.place_name || f.text || 'Unknown',
              lat: f.center[1],
              lng: f.center[0],
            })));
          }
        } else {
          const { data } = await supabase.functions.invoke('geocode-address', {
            body: { query: citySearch }
          });
          if (data?.results) {
            setCitySuggestions(data.results.slice(0, 5).map((r: any) => ({
              name: r.city || r.name?.split(',')[0] || 'Unknown',
              displayName: r.name || r.place_name || r.city || 'Unknown',
              lat: r.lat || r.latitude,
              lng: r.lng || r.longitude,
            })));
          }
        }
      } catch (e) {
        console.error("Geocoding search failed:", e);
        setCitySuggestions([]);
      }
    }, 300);
    return () => clearTimeout(searchTimer.current);
  }, [citySearch]);

  return (
    <header
      className="sticky top-0 z-40"
      style={{
        background: 'rgba(10,10,10,0.90)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
      }}
    >
      {/* Top row: logo, city, date */}
      <div className="flex items-center justify-between px-5 py-3">
        {/* Logo Yuno */}
        <div className="flex items-baseline gap-2 shrink-0">
          <span
            className="font-display font-bold"
            style={{ fontSize: '20px', color: '#E8192C', letterSpacing: '-0.025em', lineHeight: 1 }}
          >
            Yuno
          </span>
          <span
            className="font-mono font-bold uppercase"
            style={{
              fontSize: '9px',
              letterSpacing: '0.12em',
              color: '#E8192C',
              background: 'rgba(232,25,44,0.12)',
              border: '1px solid rgba(232,25,44,0.25)',
              padding: '2px 6px',
              borderRadius: '999px',
            }}
          >
            Beta
          </span>
        </div>

        <div className="flex items-center gap-2">
        {/* City pill */}
        <button
          onClick={() => setCityDialogOpen(true)}
          className="flex items-center gap-1.5 font-mono font-medium transition-colors"
          style={{
            fontSize: '11px',
            letterSpacing: '0.04em',
            color: '#E5E5E5',
            padding: '5px 12px',
            borderRadius: '10px',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.10)',
          }}
        >
          <MapPin className="h-3 w-3 shrink-0 text-primary" />
          <span className="truncate max-w-[80px]">{city}</span>
          <ChevronDown className="h-3 w-3 shrink-0" style={{ color: '#5A5A5E' }} />
        </button>

        {/* Date pill */}
        <button
          onClick={() => setCalendarOpen(true)}
          className="flex items-center gap-1.5 font-mono font-medium shrink-0 transition-colors"
          style={{
            fontSize: '11px',
            letterSpacing: '0.04em',
            color: '#E5E5E5',
            padding: '5px 12px',
            borderRadius: '10px',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.10)',
          }}
        >
          {dateLabel}
          <ChevronDown className="h-3 w-3" style={{ color: '#5A5A5E' }} />
        </button>

        {/* Calendar Drawer */}
        <Drawer open={calendarOpen} onOpenChange={setCalendarOpen}>
           <DrawerContent className="border-0 rounded-t-[24px] min-h-[55dvh] max-h-[68dvh] flex flex-col [&>div:first-child]:bg-white/20 [&>div:first-child]:w-10 [&>div:first-child]:h-1 [&>div:first-child]:mt-3 [&>div:first-child]:mb-2 bg-background overflow-hidden" style={{ background: 'linear-gradient(180deg, hsl(0 0% 8%) 0%, hsl(0 0% 3%) 100%)' }}>
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="flex gap-2 px-5 mb-3 pt-3"
            >
              {(['today', 'tomorrow', 'weekend'] as const).map((preset, i) => (
                <motion.button
                  key={preset}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.15 + i * 0.05, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  onClick={() => {
                    handlePreset(preset);
                    setCalendarOpen(false);
                  }}
                  className={cn(
                    'flex-1 rounded-[10px] py-2.5 text-sm font-semibold transition-colors border text-center',
                    (!selectedDate && (
                      (preset === 'today' && dateFilter === 'today') ||
                      (preset === 'tomorrow' && dateFilter === 'tomorrow') ||
                      (preset === 'weekend' && dateFilter === 'weekend')
                    ))
                      ? 'border-primary bg-primary text-primary-foreground shadow-[0_0_12px_hsl(0_100%_56%/0.3)]'
                      : 'border-white/12 bg-white/5 text-white/60 hover:border-white/25 hover:text-white/80'
                  )}
                >
                  {t(`explore.${preset}`)}
                </motion.button>
              ))}
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="flex-1 flex flex-col items-center justify-center w-full px-4 pb-6"
              style={{ paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))' }}
            >
              <Calendar
                mode="single"
                selected={selectedDate || undefined}
                onSelect={handleDateSelect}
                defaultMonth={selectedDate || new Date()}
                weekStartsOn={1}
                locale={calendarLocale}
                className={cn(
                  "p-0 pointer-events-auto w-auto max-w-none",
                  "[&_.rdp-months]:w-auto [&_.rdp-month]:w-auto",
                  "[&_.rdp-table]:border-separate [&_.rdp-table]:border-spacing-x-1.5 [&_.rdp-table]:border-spacing-y-1.5",
                  // Caption
                  "[&_.rdp-caption]:px-2 [&_.rdp-caption]:mb-5",
                  "[&_.rdp-caption_label]:text-white [&_.rdp-caption_label]:font-bold [&_.rdp-caption_label]:text-lg [&_.rdp-caption_label]:capitalize",
                  // Nav arrows — ghost
                  "[&_.rdp-nav_button]:text-white/50 [&_.rdp-nav_button]:border-0 [&_.rdp-nav_button]:bg-transparent [&_.rdp-nav_button]:hover:bg-white/8 [&_.rdp-nav_button]:hover:text-white [&_.rdp-nav_button]:h-9 [&_.rdp-nav_button]:w-9",
                  // Weekday labels
                  "[&_.rdp-head_row]:table-row",
                  "[&_.rdp-head_cell]:text-center [&_.rdp-head_cell]:text-[11px] [&_.rdp-head_cell]:font-medium [&_.rdp-head_cell]:uppercase [&_.rdp-head_cell]:tracking-widest [&_.rdp-head_cell]:text-white/30 [&_.rdp-head_cell]:pb-3 [&_.rdp-head_cell]:w-12",
                  // Rows & cells
                  "[&_.rdp-row]:table-row",
                  "[&_.rdp-cell]:table-cell [&_.rdp-cell]:text-center [&_.rdp-cell]:p-0 [&_.rdp-cell]:align-middle",
                  // Day buttons
                  "[&_.rdp-button]:text-[15px] [&_.rdp-button]:font-medium [&_.rdp-button]:rounded-full [&_.rdp-button]:mx-auto",
                  // Day colors — high contrast on dark
                  "[&_.rdp-day]:text-white/90",
                  "[&_.rdp-day_outside]:text-white/10",
                  "[&_.rdp-day_disabled]:text-white/10 [&_.rdp-day_disabled]:opacity-50",
                  "[&_.rdp-day_today]:bg-transparent [&_.rdp-day_today]:text-primary [&_.rdp-day_today]:ring-2 [&_.rdp-day_today]:ring-primary [&_.rdp-day_today]:ring-inset [&_.rdp-day_today]:!opacity-100 [&_.rdp-day_today]:font-bold",
                  "[&_.rdp-day_selected]:!bg-primary [&_.rdp-day_selected]:!text-primary-foreground [&_.rdp-day_selected]:font-bold [&_.rdp-day_selected]:!opacity-100 [&_.rdp-day_selected]:shadow-[0_0_10px_hsl(0_100%_56%/0.4)]",
                )}
                disabled={(date) => date < new Date(new Date().setHours(0,0,0,0))}
                modifiers={{ highlighted: highlightedDates }}
                modifiersClassNames={{ highlighted: '!bg-primary/90 !text-white rounded-full font-bold !opacity-100' }}
              />
            </motion.div>
          </DrawerContent>
        </Drawer>
        </div>
      </div>

      {/* Search bar + filters button */}
      <div className="flex items-center gap-2 px-5 pb-3">
        <button
          onClick={onSearchFocus}
          className="flex flex-1 min-w-0 items-center gap-2.5 font-mono transition-colors"
          style={{
            fontSize: '13px',
            color: '#5A5A5E',
            padding: '10px 14px',
            borderRadius: '10px',
            background: '#1F1F22',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <Search className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="truncate">{t('explore.searchPlaceholder')}</span>
        </button>
        <button
          onClick={onFiltersOpen}
          className="relative flex items-center justify-center shrink-0 transition-colors"
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '10px',
            background: activeFiltersCount > 0 ? 'rgba(232,25,44,0.12)' : '#1F1F22',
            border: `1px solid ${activeFiltersCount > 0 ? 'rgba(232,25,44,0.4)' : 'rgba(255,255,255,0.08)'}`,
          }}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" style={{ color: activeFiltersCount > 0 ? '#E8192C' : '#9A9A9A' }} />
          {activeFiltersCount > 0 && (
            <span style={{
              position: 'absolute',
              top: -5,
              right: -5,
              width: 17,
              height: 17,
              borderRadius: '50%',
              background: '#E8192C',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '9px',
              fontWeight: 700,
              color: '#fff',
              border: '1.5px solid #0a0a0a',
            }}>
              {activeFiltersCount}
            </span>
          )}
        </button>
      </div>

      {/* City selection dialog */}
      <Dialog open={cityDialogOpen} onOpenChange={setCityDialogOpen}>
        <DialogContent className="max-w-sm bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold uppercase tracking-wider">{t('explore.chooseCity')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {/* Use my location */}
            <button
              onClick={handleUseLocation}
              disabled={geoLoading}
              className="flex w-full items-center gap-3 rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm font-medium text-foreground transition-colors hover:border-primary/30"
            >
              {geoLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              ) : (
                <Navigation className="h-4 w-4 text-primary" />
              )}
              {t('explore.useMyLocation')}
            </button>

            {/* Manual search - same style as map search bar */}
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 z-10 w-4 h-4 text-primary" />
              <Input
                placeholder={t('explore.searchCity')}
                value={citySearch}
                onChange={(e) => setCitySearch(e.target.value)}
                className="pl-10 pr-3 text-sm bg-background/90 backdrop-blur-md border-border/50 focus:border-primary"
              />
            </div>

            {/* Suggestions */}
            {citySuggestions.length > 0 && (
              <div className="space-y-1">
                {citySuggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      onCityChange(s.name, { lat: s.lat, lng: s.lng });
                      setCityDialogOpen(false);
                      setCitySearch('');
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-foreground hover:bg-muted/50 transition-colors text-left"
                  >
                    <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{s.displayName}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </header>
  );
}
