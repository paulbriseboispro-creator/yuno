import { useState, useEffect, useRef } from 'react';
import { X, Minus, Plus, Ticket, Crown } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { Slider } from '@/components/ui/slider';
import { motion, AnimatePresence } from 'framer-motion';
import { spring } from '@/lib/animations';

export interface ExploreFilters {
  eventTypes: string[];
  genres: string[];
  priceRange: [number, number];
  priceType: 'tickets' | 'vip' | 'both';
  dateFilter: string;
  timeRange: [number, number]; // stored as 0-24 linear scale, mapped to 18h-6h display
}

const EVENT_TYPES = [
  { id: 'club', label: 'Clubs' },
  { id: 'after_party', label: 'After Parties' },
  { id: 'beach_club', label: 'Beach Clubs' },
];

const MUSIC_GENRES = [
  'House', 'Techno', 'Rap / Hip-Hop', 'Afro / Shatta',
  'Reggaeton / Latino', 'Commercial / Hits', 'Electro / EDM', 'Open Format',
];

const DATE_OPTIONS = [
  { id: 'today', labelKey: 'explore.today' },
  { id: 'tomorrow', labelKey: 'explore.tomorrow' },
  { id: 'weekend', labelKey: 'explore.weekend' },
  { id: 'week', labelKey: 'filter.thisWeek' },
];

export interface FilterDynamicData {
  ticketPriceMin: number;
  ticketPriceMax: number;
  vipPriceMin: number;
  vipPriceMax: number;
  /** Earliest event start hour (0-23) */
  earliestHour: number;
  /** Latest event end hour (0-23) */
  latestHour: number;
}

interface FilterPageProps {
  open: boolean;
  onClose: () => void;
  filters: ExploreFilters;
  onApply: (filters: ExploreFilters) => void;
  dynamicData?: FilterDynamicData;
}

// Map slider value (0-12) to actual hour display (18h-6h)
function sliderToHour(val: number): number {
  return (18 + val) % 24;
}

function hourLabel(val: number): string {
  const h = sliderToHour(val);
  return `${h.toString().padStart(2, '0')}:00`;
}

// Convert real hour (0-23) to slider value (0-12 on 18h-6h scale)
function hourToSlider(hour: number): number {
  if (hour >= 18) return hour - 18;
  if (hour <= 6) return hour + 6;
  return 0; // fallback
}

export function FilterPage({ open, onClose, filters, onApply, dynamicData }: FilterPageProps) {
  const { t } = useLanguage();
  const [localFilters, setLocalFilters] = useState<ExploreFilters>(filters);

  // Sync local filters when filters prop changes (e.g. page reopened)
  useEffect(() => {
    if (open) setLocalFilters(filters);
  }, [open]);

  // Compute dynamic price bounds based on priceType
  const priceMin = dynamicData
    ? localFilters.priceType === 'tickets'
      ? dynamicData.ticketPriceMin
      : localFilters.priceType === 'vip'
        ? dynamicData.vipPriceMin
        : Math.min(dynamicData.ticketPriceMin, dynamicData.vipPriceMin)
    : 0;
  const priceMax = dynamicData
    ? localFilters.priceType === 'tickets'
      ? dynamicData.ticketPriceMax
      : localFilters.priceType === 'vip'
        ? dynamicData.vipPriceMax
        : Math.max(dynamicData.ticketPriceMax, dynamicData.vipPriceMax)
    : 200;

  // Always use full 18h-6h range for time slider (0-12 scale)
  const timeSliderMin = 0;
  const timeSliderMax = 12;

  // When priceType changes, reset price range to new bounds
  const prevPriceType = useRef(localFilters.priceType);
  useEffect(() => {
    if (prevPriceType.current !== localFilters.priceType) {
      prevPriceType.current = localFilters.priceType;
      setLocalFilters(f => ({
        ...f,
        priceRange: [priceMin, priceMax] as [number, number],
      }));
    }
  }, [localFilters.priceType, priceMin, priceMax]);

  const toggleArrayItem = (arr: string[], item: string) =>
    arr.includes(item) ? arr.filter(i => i !== item) : [...arr, item];

  const handleApply = () => {
    onApply(localFilters);
    onClose();
  };

  const handleReset = () => {
    const reset: ExploreFilters = {
      eventTypes: [],
      genres: [],
      priceRange: [priceMin, priceMax],
      priceType: 'both',
      dateFilter: 'today',
      timeRange: [timeSliderMin, timeSliderMax],
    };
    setLocalFilters(reset);
  };

  const sectionVariants = {
    hidden: {},
    visible: { transition: { staggerChildren: 0.07, delayChildren: 0.15 } },
  };

  const sectionItem = {
    hidden: { opacity: 0, y: 16 },
    visible: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 300, damping: 24 } },
  };

  const chipVariants = {
    hidden: { opacity: 0, scale: 0.85, y: 8 },
    visible: { opacity: 1, scale: 1, y: 0, transition: { type: 'spring' as const, stiffness: 400, damping: 25 } },
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] bg-background flex flex-col"
          style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
          initial={{ x: '100%' }}
          animate={{ x: 0, transition: spring.snappy }}
          exit={{ x: '100%', opacity: 0.6, transition: { type: 'spring', stiffness: 300, damping: 30 } }}
        >
          {/* Header */}
          <motion.div
            className="flex items-center justify-between border-b border-border px-4 py-3"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.15, duration: 0.25 }}
          >
            <button onClick={onClose}>
              <X className="h-5 w-5 text-foreground" />
            </button>
            <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
              {t('filter.title')}
            </h2>
            <button onClick={handleReset} className="text-xs font-medium text-primary">
              {t('filter.reset')}
            </button>
          </motion.div>

          {/* Scrollable content */}
          <motion.div
            className="flex-1 overflow-y-auto px-4 py-5 space-y-7"
            variants={sectionVariants}
            initial="hidden"
            animate="visible"
          >
            {/* Event Type */}
            <motion.section className="space-y-3" variants={sectionItem}>
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {t('filter.eventType')}
              </h3>
              <motion.div className="flex flex-wrap gap-2" variants={sectionVariants}>
                {EVENT_TYPES.map(type => {
                  const selected = localFilters.eventTypes.includes(type.id);
                  return (
                    <motion.button
                      key={type.id}
                      variants={chipVariants}
                      whileTap={{ scale: 0.93 }}
                      onClick={() =>
                        setLocalFilters(f => ({ ...f, eventTypes: toggleArrayItem(f.eventTypes, type.id) }))
                      }
                      className={cn(
                        'rounded-[10px] border px-3.5 py-2 text-xs font-medium transition-colors',
                        selected
                          ? 'border-primary bg-primary/15 text-primary'
                          : 'border-border bg-card text-foreground hover:border-primary/30'
                      )}
                    >
                      {type.label}
                    </motion.button>
                  );
                })}
              </motion.div>
            </motion.section>

            {/* Music Genre */}
            <motion.section className="space-y-3" variants={sectionItem}>
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {t('filter.musicGenre')}
              </h3>
              <motion.div className="flex flex-wrap gap-2" variants={sectionVariants}>
                {MUSIC_GENRES.map(genre => {
                  const selected = localFilters.genres.includes(genre);
                  return (
                    <motion.button
                      key={genre}
                      variants={chipVariants}
                      whileTap={{ scale: 0.93 }}
                      onClick={() =>
                        setLocalFilters(f => ({ ...f, genres: toggleArrayItem(f.genres, genre) }))
                      }
                      className={cn(
                        'rounded-[10px] border px-3.5 py-2 text-xs font-medium transition-colors',
                        selected
                          ? 'border-primary bg-primary/15 text-primary'
                          : 'border-border bg-card text-foreground hover:border-primary/30'
                      )}
                    >
                      {genre}
                    </motion.button>
                  );
                })}
              </motion.div>
            </motion.section>

            {/* Date */}
            <motion.section className="space-y-3" variants={sectionItem}>
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {t('filter.date')}
              </h3>
              <motion.div className="flex flex-wrap gap-2" variants={sectionVariants}>
                {DATE_OPTIONS.map(opt => {
                  const selected = localFilters.dateFilter === opt.id;
                  return (
                    <motion.button
                      key={opt.id}
                      variants={chipVariants}
                      whileTap={{ scale: 0.93 }}
                      onClick={() => setLocalFilters(f => ({ ...f, dateFilter: opt.id }))}
                      className={cn(
                        'rounded-[10px] border px-3.5 py-2 text-xs font-medium transition-colors',
                        selected
                          ? 'border-primary bg-primary/15 text-primary'
                          : 'border-border bg-card text-foreground hover:border-primary/30'
                      )}
                    >
                      {t(opt.labelKey)}
                    </motion.button>
                  );
                })}
              </motion.div>
            </motion.section>

            {/* Price Type Toggle */}
            <motion.section className="space-y-3" variants={sectionItem}>
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {t('filter.priceCategory')}
              </h3>
              <motion.div className="flex gap-2" variants={sectionVariants}>
                {([
                  { id: 'tickets' as const, icon: Ticket, label: t('tickets.tickets') },
                  { id: 'vip' as const, icon: Crown, label: t('explore.vipTable') },
                  { id: 'both' as const, icon: null, label: t('filter.all') },
                ]).map(opt => {
                  const selected = localFilters.priceType === opt.id;
                  return (
                    <motion.button
                      key={opt.id}
                      variants={chipVariants}
                      whileTap={{ scale: 0.93 }}
                      onClick={() => setLocalFilters(f => ({ ...f, priceType: opt.id }))}
                      className={cn(
                        'flex items-center gap-1.5 rounded-[10px] border px-3.5 py-2 text-xs font-medium transition-colors',
                        selected
                          ? 'border-primary bg-primary/15 text-primary'
                          : 'border-border bg-card text-foreground hover:border-primary/30'
                      )}
                    >
                      {opt.icon && <opt.icon className="h-3.5 w-3.5" />}
                      {opt.label}
                    </motion.button>
                  );
                })}
              </motion.div>
            </motion.section>

            {/* Price Range */}
            <motion.section className="space-y-3" variants={sectionItem}>
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {t('filter.price')}
                </h3>
                <span className="text-xs font-medium text-foreground">
                  {localFilters.priceRange[0]}€ – {localFilters.priceRange[1]}€
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setLocalFilters(f => ({
                    ...f,
                    priceRange: [Math.max(priceMin, f.priceRange[0] - 5), f.priceRange[1]] as [number, number]
                  }))}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-border bg-card text-foreground"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <Slider
                  value={localFilters.priceRange}
                  onValueChange={(v) => setLocalFilters(f => ({ ...f, priceRange: v as [number, number] }))}
                  min={priceMin}
                  max={priceMax || 200}
                  step={5}
                  className="flex-1 py-2"
                />
                <button
                  onClick={() => setLocalFilters(f => ({
                    ...f,
                    priceRange: [f.priceRange[0], Math.min(priceMax || 200, f.priceRange[1] + 5)] as [number, number]
                  }))}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-border bg-card text-foreground"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </motion.section>

            {/* Time */}
            <motion.section className="space-y-3" variants={sectionItem}>
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {t('filter.timing')}
                </h3>
                <span className="text-xs font-medium text-foreground">
                  {hourLabel(localFilters.timeRange[0])} – {hourLabel(localFilters.timeRange[1])}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setLocalFilters(f => ({
                    ...f,
                    timeRange: [Math.max(timeSliderMin, f.timeRange[0] - 1), f.timeRange[1]] as [number, number]
                  }))}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-border bg-card text-foreground"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <Slider
                  value={localFilters.timeRange}
                  onValueChange={(v) => setLocalFilters(f => ({ ...f, timeRange: v as [number, number] }))}
                  min={timeSliderMin}
                  max={timeSliderMax || 12}
                  step={1}
                  className="flex-1 py-2"
                />
                <button
                  onClick={() => setLocalFilters(f => ({
                    ...f,
                    timeRange: [f.timeRange[0], Math.min(timeSliderMax || 12, f.timeRange[1] + 1)] as [number, number]
                  }))}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-border bg-card text-foreground"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </motion.section>
          </motion.div>

          {/* Apply button */}
          <motion.div
            className="border-t border-border p-4 bg-background"
            style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, ...spring.snappy }}
          >
            <button
              onClick={handleApply}
              className="w-full rounded-[10px] bg-primary py-3.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {t('filter.apply')}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
