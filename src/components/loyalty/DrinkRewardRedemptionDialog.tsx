import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Wine, Calendar, Check, Loader2, Heart } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useFavorites } from '@/hooks/useFavorites';
import { cn } from '@/lib/utils';

interface Drink {
  id: string;
  name: string;
  img_url: string;
  price: number;
  collection: string;
}

interface Event {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  image_url: string | null;
}

interface DrinkRewardRedemptionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  venueId: string;
  rewardName: string;
  rewardId: string;
  pointsRequired: number;
  allowedCategories?: string[]; // If empty or undefined, all categories allowed
  onConfirm: (drinkId: string, eventId: string, drinkName: string, eventTitle: string) => Promise<void>;
}

type Step = 'drink' | 'event' | 'confirm';
type DrinkCategory = 'all' | 'drink' | 'shot' | 'soft';

// Define category order: drink first, then shot, then soft
const CATEGORY_ORDER: Record<string, number> = {
  drink: 0,
  shot: 1,
  soft: 2,
};

export function DrinkRewardRedemptionDialog({
  open,
  onOpenChange,
  venueId,
  rewardName,
  rewardId,
  pointsRequired,
  allowedCategories = [],
  onConfirm
}: DrinkRewardRedemptionDialogProps) {
  const { t, language } = useLanguage();
  const { getFavoritesByType } = useFavorites();
  const [step, setStep] = useState<Step>('drink');
  const [drinks, setDrinks] = useState<Drink[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [selectedDrink, setSelectedDrink] = useState<Drink | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<DrinkCategory>('all');

  const favoriteDrinkIds = useMemo(() => {
    return getFavoritesByType('drink').map(f => f.drinkId).filter(Boolean) as string[];
  }, [getFavoritesByType]);

  // Get available categories from drinks - sorted in order: drink, shot, soft
  // Filter by allowedCategories if specified
  const availableCategories = useMemo(() => {
    let categories = new Set(drinks.map(d => d.collection));
    
    // If allowedCategories is specified, only show those
    if (allowedCategories && allowedCategories.length > 0) {
      categories = new Set(
        Array.from(categories).filter(c => allowedCategories.includes(c))
      );
    }
    
    const sorted = Array.from(categories).sort((a, b) => {
      const orderA = CATEGORY_ORDER[a] ?? 99;
      const orderB = CATEGORY_ORDER[b] ?? 99;
      return orderA - orderB;
    });
    return ['all', ...sorted] as DrinkCategory[];
  }, [drinks, allowedCategories]);

  // Filter and sort drinks by category, then favorites first
  // In "all" tab: sort by category order (drink > shot > soft), then favorites first within each category
  // Also filter by allowedCategories if specified
  const filteredDrinks = useMemo(() => {
    let filtered = drinks;
    
    // First filter by allowedCategories if specified
    if (allowedCategories && allowedCategories.length > 0) {
      filtered = filtered.filter(d => allowedCategories.includes(d.collection));
    }
    
    // Then filter by selected category tab
    if (selectedCategory !== 'all') {
      filtered = filtered.filter(d => d.collection === selectedCategory);
    }
    
    return [...filtered].sort((a, b) => {
      // First: sort by category order (only in "all" tab)
      if (selectedCategory === 'all') {
        const orderA = CATEGORY_ORDER[a.collection] ?? 99;
        const orderB = CATEGORY_ORDER[b.collection] ?? 99;
        if (orderA !== orderB) return orderA - orderB;
      }
      
      // Then: favorites first within same category
      const aIsFav = favoriteDrinkIds.includes(a.id);
      const bIsFav = favoriteDrinkIds.includes(b.id);
      if (aIsFav && !bIsFav) return -1;
      if (!aIsFav && bIsFav) return 1;
      
      return 0;
    });
  }, [drinks, selectedCategory, favoriteDrinkIds, allowedCategories]);

  useEffect(() => {
    if (open && venueId) {
      fetchData();
    }
  }, [open, venueId]);

  useEffect(() => {
    if (!open) {
      // Reset state when dialog closes
      setStep('drink');
      setSelectedDrink(null);
      setSelectedEvent(null);
      setSelectedCategory('all');
    }
  }, [open]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch drinks
      const { data: drinksData } = await supabase
        .from('drinks')
        .select('id, name, img_url, price, collection')
        .eq('venue_id', venueId)
        .eq('active', true)
        .order('position');

      setDrinks(drinksData || []);

      // Fetch ongoing + upcoming events (end_at >= now means event is still running or in the future).
      // Include both events the venue owns and events where it acts as the partner host (organizer-led co-events),
      // so that drink rewards can be consumed at any soirée taking place at this club.
      const { data: eventsData } = await supabase
        .from('events')
        .select('id, title, start_at, end_at, image_url')
        .or(`venue_id.eq.${venueId},partner_venue_id.eq.${venueId}`)
        .eq('is_active', true)
        .gte('end_at', new Date().toISOString())
        .order('start_at', { ascending: true })
        .limit(20);

      setEvents(eventsData || []);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!selectedDrink || !selectedEvent) return;
    
    setConfirming(true);
    try {
      await onConfirm(selectedDrink.id, selectedEvent.id, selectedDrink.name, selectedEvent.title);
      onOpenChange(false);
    } catch (error) {
      console.error('Error confirming redemption:', error);
    } finally {
      setConfirming(false);
    }
  };

  const formatEventDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(language === 'es' ? 'es-ES' : language === 'fr' ? 'fr-FR' : 'en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getTitle = () => {
    switch (step) {
      case 'drink': return t('drinkRedeem.chooseDrink');
      case 'event': return t('drinkRedeem.chooseEvent');
      case 'confirm': return t('drinkRedeem.confirmChoice');
    }
  };

  const getCategoryLabel = (cat: DrinkCategory) => {
    switch (cat) {
      case 'all': return t('drinkRedeem.all');
      case 'drink': return t('drinkRedeem.drinks');
      case 'shot': return t('drinkRedeem.shots');
      case 'soft': return t('drinkRedeem.softs');
      default: return cat;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 border-b shrink-0">
          <div className="flex items-center gap-3">
            {step !== 'drink' && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => setStep(step === 'confirm' ? 'event' : 'drink')}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <DialogTitle className="flex-1">{getTitle()}</DialogTitle>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-sm text-muted-foreground">{rewardName}</span>
            <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
              {pointsRequired} {t('drinkRedeem.points')}
            </span>
          </div>
        </DialogHeader>

        {/* Category tabs for drink step */}
        {step === 'drink' && availableCategories.length > 1 && (
          <div className="px-5 pt-3 shrink-0">
            <Tabs value={selectedCategory} onValueChange={(v) => setSelectedCategory(v as DrinkCategory)}>
              <TabsList className="w-full grid" style={{ gridTemplateColumns: `repeat(${availableCategories.length}, 1fr)` }}>
                {availableCategories.map(cat => (
                  <TabsTrigger key={cat} value={cat} className="text-xs">
                    {getCategoryLabel(cat)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
          <AnimatePresence mode="wait">
            {step === 'drink' && (
              <motion.div
                key="drink"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-2"
              >
                {loading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
                ) : filteredDrinks.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">{t('drinkRedeem.noDrinks')}</p>
                ) : (
                  filteredDrinks.map(drink => {
                    const isFavorite = favoriteDrinkIds.includes(drink.id);
                    return (
                      <motion.button
                        key={drink.id}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => setSelectedDrink(drink)}
                        className={cn(
                          'w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left',
                          selectedDrink?.id === drink.id
                            ? 'border-primary bg-primary/10'
                            : 'border-border hover:border-primary/50'
                        )}
                      >
                        <img
                          src={drink.img_url}
                          alt={drink.name}
                          className="w-12 h-12 object-cover rounded-lg"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="font-medium truncate">{drink.name}</p>
                            {isFavorite && <Heart className="h-3.5 w-3.5 fill-destructive text-destructive shrink-0" />}
                          </div>
                          <p className="text-sm text-muted-foreground capitalize">{drink.collection}</p>
                        </div>
                        {selectedDrink?.id === drink.id && (
                          <div className="h-6 w-6 rounded-full bg-primary flex items-center justify-center shrink-0">
                            <Check className="h-4 w-4 text-primary-foreground" />
                          </div>
                        )}
                      </motion.button>
                    );
                  })
                )}
              </motion.div>
            )}

            {step === 'event' && (
              <motion.div
                key="event"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-2"
              >
                {events.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">{t('drinkRedeem.noEvents')}</p>
                ) : (
                  events.map(event => {
                    const now = new Date();
                    const isOngoing = new Date(event.start_at) <= now && new Date(event.end_at) >= now;
                    return (
                      <motion.button
                        key={event.id}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => setSelectedEvent(event)}
                        className={cn(
                          'w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left',
                          selectedEvent?.id === event.id
                            ? 'border-primary bg-primary/10'
                            : 'border-border hover:border-primary/50'
                        )}
                      >
                        {event.image_url ? (
                          <img
                            src={event.image_url}
                            alt={event.title}
                            className="w-12 h-12 object-cover rounded-lg"
                          />
                        ) : (
                          <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center">
                            <Calendar className="h-5 w-5 text-muted-foreground" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium truncate">{event.title}</p>
                            {isOngoing && (
                              <span className="shrink-0 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-500">
                                Live
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">{formatEventDate(event.start_at)}</p>
                        </div>
                        {selectedEvent?.id === event.id && (
                          <div className="h-6 w-6 rounded-full bg-primary flex items-center justify-center">
                            <Check className="h-4 w-4 text-primary-foreground" />
                          </div>
                        )}
                      </motion.button>
                    );
                  })
                )}
              </motion.div>
            )}

            {step === 'confirm' && selectedDrink && selectedEvent && (
              <motion.div
                key="confirm"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                {/* Summary Card */}
                <div className="p-4 rounded-xl bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/30">
                  <div className="flex items-center gap-3 mb-4">
                    <Wine className="h-6 w-6 text-primary" />
                    <div>
                      <p className="text-sm text-muted-foreground">{t('drinkRedeem.drink')}</p>
                      <p className="font-semibold">{selectedDrink.name}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Calendar className="h-6 w-6 text-primary" />
                    <div>
                      <p className="text-sm text-muted-foreground">{t('drinkRedeem.event')}</p>
                      <p className="font-semibold">{selectedEvent.title}</p>
                      <p className="text-sm text-muted-foreground">{formatEventDate(selectedEvent.start_at)}</p>
                    </div>
                  </div>
                </div>

                {/* Points to spend */}
                <div className="text-center py-2">
                  <p className="text-2xl font-bold text-primary">-{pointsRequired}</p>
                  <p className="text-sm text-muted-foreground">{t('drinkRedeem.points')}</p>
                </div>

                {/* Info */}
                <p className="text-sm text-center text-muted-foreground">
                  {t('drinkRedeem.willBeSent')}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="p-5 border-t flex gap-3">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => onOpenChange(false)}
          >
            {t('drinkRedeem.cancel')}
          </Button>
          
          {step === 'drink' && (
            <Button
              className="flex-1"
              disabled={!selectedDrink}
              onClick={() => setStep('event')}
            >
              {t('drinkRedeem.next')}
            </Button>
          )}
          
          {step === 'event' && (
            <Button
              className="flex-1"
              disabled={!selectedEvent}
              onClick={() => setStep('confirm')}
            >
              {t('drinkRedeem.next')}
            </Button>
          )}
          
          {step === 'confirm' && (
            <Button
              className="flex-1"
              disabled={confirming}
              onClick={handleConfirm}
            >
              {confirming ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                t('drinkRedeem.confirm')
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
