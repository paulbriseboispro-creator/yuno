import { motion } from 'framer-motion';
import { DrinkCard } from '@/components/DrinkCard';
import { CartButton } from '@/components/CartButton';
import { EventSelectionDialog } from '@/components/EventSelectionDialog';
import { BottomNav } from '@/components/BottomNav';
import { useStore } from '@/store/useStore';
import { Drink, Event } from '@/types';
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { useParams } from 'react-router-dom';
import { usePreviewNavigate } from '@/contexts/OwnerPreviewContext';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useFavorites } from '@/hooks/useFavorites';

type CategoryType = 'drink' | 'shot' | 'soft';

export default function CategoryDrinks() {
  const { slug, category } = useParams<{ slug: string; category: string }>();
  const navigate = usePreviewNavigate();
  const { toast } = useToast();
  const { t } = useLanguage();
  const [drinks, setDrinks] = useState<Drink[]>([]);
  const [venueName, setVenueName] = useState('');
  const [loading, setLoading] = useState(true);
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [selectedDrink, setSelectedDrink] = useState<Drink | null>(null);
  const addToCart = useStore((state) => state.addToCart);
  const { getFavoritesByType } = useFavorites();
  
  const favoriteDrinkIds = getFavoritesByType('drink').map(f => f.drinkId).filter(Boolean) as string[];

  // Check venue plan - redirect if Core
  useEffect(() => {
    if (!slug) return;
    const checkPlan = async () => {
      const { data } = await supabase
        .from('venue_subscriptions')
        .select('subscription_plan')
        .eq('venue_id', slug)
        .in('status', ['active', 'trialing'])
        .maybeSingle();
      if (!data || data.subscription_plan === 'core') {
        navigate(`/club/${slug}`, { replace: true });
        return;
      }
      // Also check if menu is enabled
      const { data: venueData } = await supabase
        .from('venues')
        .select('menu_enabled')
        .eq('id', slug)
        .single();
      if (venueData && venueData.menu_enabled === false) {
        navigate(`/club/${slug}`, { replace: true });
      }
    };
    checkPlan();
  }, [slug, navigate]);

  const getCategoryTitle = (cat: string): string => {
    switch (cat) {
      case 'drink': return t('venue.drinks');
      case 'shot': return t('venue.shots');
      case 'soft': return t('venue.softs');
      default: return cat;
    }
  };

  useEffect(() => {
    if (!slug || !category) return;

    const fetchData = async () => {
      try {
        // Fetch venue name
        const { data: venueData } = await supabase
          .from('venues')
          .select('name')
          .eq('id', slug)
          .single();
        
        if (venueData) {
          setVenueName(venueData.name);
        }

        // Fetch drinks for this category
        const { data, error } = await supabase
          .from('drinks')
          .select('*')
          .eq('venue_id', slug)
          .eq('collection', category)
          .eq('active', true)
          .order('position', { ascending: true });

        if (error) throw error;

        const mappedDrinks: Drink[] = (data || []).map((drink: any) => ({
          id: drink.id,
          name: drink.name,
          description: drink.description || '',
          price: Number(drink.price),
          promoPrice: drink.promo_price ? Number(drink.promo_price) : undefined,
          presalePrice: drink.presale_price ? Number(drink.presale_price) : undefined,
          presaleActive: drink.presale_active || false,
          alcPct: drink.alc_pct ? Number(drink.alc_pct) : undefined,
          imgUrl: drink.img_url,
          venueId: drink.venue_id,
          active: drink.active,
          position: drink.position || 0,
          collection: drink.collection as CategoryType,
        }));

        setDrinks(mappedDrinks);
      } catch (error) {
        console.error('Error fetching drinks:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [slug, category]);

  const handleAddDrink = (drink: Drink) => {
    setSelectedDrink(drink);
    setEventDialogOpen(true);
  };

  const handleEventSelect = (event: Event) => {
    if (selectedDrink) {
      addToCart(selectedDrink, event.id, event.title, event.startAt);
      toast({
        title: t('cart.added'),
        description: `${selectedDrink.name} - ${event.title}`,
      });
      setSelectedDrink(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border/40 bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 sm:h-16 max-w-7xl items-center gap-3 sm:gap-4 px-3 sm:px-4">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => navigate(`/club/${slug}`)}
            className="h-9 w-9 sm:h-10 sm:w-10"
          >
            <ArrowLeft className="h-4 w-4 sm:h-5 sm:w-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-base sm:text-xl font-semibold truncate">
              {getCategoryTitle(category || '')}
            </h1>
            <p className="text-xs text-muted-foreground truncate">{venueName}</p>
          </div>
        </div>
      </header>

      {/* Drinks Grid */}
      <div className="mx-auto max-w-7xl px-3 sm:px-4 py-4 sm:py-8">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="mb-4 sm:mb-6"
        >
          <p className="text-sm text-muted-foreground">
            {drinks.length} {t('venue.available')}
          </p>
        </motion.div>

        {drinks.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">{t('venue.noDrinks')}</p>
          </div>
        ) : (
          <motion.div
            initial="hidden"
            animate="visible"
            variants={{
              hidden: {},
              visible: {
                transition: {
                  staggerChildren: 0.05
                }
              }
            }}
            className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4"
          >
            {[...drinks]
              .sort((a, b) => {
                const aIsFav = favoriteDrinkIds.includes(a.id);
                const bIsFav = favoriteDrinkIds.includes(b.id);
                if (aIsFav && !bIsFav) return -1;
                if (!aIsFav && bIsFav) return 1;
                return 0;
              })
              .map((drink) => (
                <motion.div
                  key={drink.id}
                  variants={{
                    hidden: { opacity: 0, y: 20 },
                    visible: { opacity: 1, y: 0 }
                  }}
                >
                  <DrinkCard 
                    drink={drink} 
                    onAdd={handleAddDrink} 
                    isFavorite={favoriteDrinkIds.includes(drink.id)}
                  />
                </motion.div>
              ))}
          </motion.div>
        )}
      </div>

      <CartButton />
      
      <EventSelectionDialog
        open={eventDialogOpen}
        onOpenChange={setEventDialogOpen}
        onEventSelect={handleEventSelect}
        venueId={slug || ''}
      />

      <BottomNav />
    </div>
  );
}
