// Mode Live — menu full-size du club. Chips de catégories (boissons / shots /
// softs / bouteilles) + grille DrinkCard réutilisée telle quelle. Le cart est
// pré-lié à l'événement de la soirée : aucun EventSelectionDialog, ajout en
// 1 tap. La catégorie Bouteilles (vente solo) ne s'affiche que si le club l'a
// activée (venues.solo_bottle_sale_enabled).
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Search, X } from 'lucide-react';
import { LiveDrinkCard } from '@/components/livemode/LiveDrinkCard';
import { LiveBottleSection } from '@/components/livemode/LiveBottleSection';
import { supabase } from '@/integrations/supabase/client';
import { useStore } from '@/store/useStore';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import { useFavorites } from '@/hooks/useFavorites';
import { useLiveMode } from '@/contexts/LiveModeContext';
import { useLiveInstantCheckout } from '@/hooks/useLiveInstantCheckout';
import { getTranslatedDrinkName } from '@/lib/drinkTranslations';
import { Drink } from '@/types';
import { transitions } from '@/lib/motion';

type LiveCategory = 'drink' | 'shot' | 'soft' | 'bottle';

export function LiveMenu() {
  const { session } = useLiveMode();
  const { t, language } = useLanguage();
  const { toast } = useToast();
  const addToCart = useStore((state) => state.addToCart);
  const { getFavoritesByType } = useFavorites();
  const [drinks, setDrinks] = useState<Drink[]>([]);
  const [category, setCategory] = useState<LiveCategory>('drink');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  const venueId = session?.venueId;
  const showBottles = !!session?.soloBottleSaleEnabled;
  const showMenu = !!session?.menuEnabled;
  const { payNow, payingId } = useLiveInstantCheckout(
    session ? { eventId: session.eventId, venueId: session.venueId } : null
  );

  const favoriteDrinkIds = getFavoritesByType('drink')
    .map((f) => f.drinkId)
    .filter(Boolean) as string[];

  useEffect(() => {
    if (!venueId || !showMenu) {
      setLoading(false);
      return;
    }
    const fetchDrinks = async () => {
      const { data } = await supabase
        .from('drinks')
        .select('*')
        .eq('venue_id', venueId)
        .eq('active', true)
        .order('position', { ascending: true });
      const mapped: Drink[] = (data ?? []).map((drink: Record<string, unknown>) => ({
        id: drink.id as string,
        name: drink.name as string,
        description: (drink.description as string) || '',
        price: Number(drink.price),
        promoPrice: drink.promo_price ? Number(drink.promo_price) : undefined,
        presalePrice: drink.presale_price ? Number(drink.presale_price) : undefined,
        presaleActive: (drink.presale_active as boolean) || false,
        alcPct: drink.alc_pct ? Number(drink.alc_pct) : undefined,
        imgUrl: drink.img_url as string,
        venueId: drink.venue_id as string,
        active: drink.active as boolean,
        position: (drink.position as number) || 0,
        collection: drink.collection as Drink['collection'],
      }));
      setDrinks(mapped);
      setLoading(false);
    };
    fetchDrinks();
  }, [venueId, showMenu]);

  const categories = useMemo(() => {
    const base: { key: LiveCategory; label: string }[] = [];
    if (showMenu) {
      (['drink', 'shot', 'soft'] as const).forEach((key) => {
        if (drinks.some((d) => d.collection === key)) {
          base.push({
            key,
            label:
              key === 'drink' ? t('venue.drinks') : key === 'shot' ? t('venue.shots') : t('venue.softs'),
          });
        }
      });
    }
    if (showBottles) base.push({ key: 'bottle', label: t('live.bottles') });
    return base;
  }, [drinks, showMenu, showBottles, t]);

  // Catégorie courante toujours valide (ex : club sans "drink" mais avec shots).
  useEffect(() => {
    if (categories.length > 0 && !categories.some((c) => c.key === category)) {
      setCategory(categories[0].key);
    }
  }, [categories, category]);

  const handleAdd = (drink: Drink) => {
    if (!session) return;
    addToCart(drink, session.eventId, session.eventTitle, session.eventStartAt);
    toast({ title: t('cart.added'), description: drink.name });
  };

  const handlePay = (drink: Drink) => {
    payNow({
      id: drink.id,
      collection: drink.collection,
      kind: 'drink',
      fallbackAddToCart: () => handleAdd(drink),
    });
  };

  if (!session || (!showMenu && !showBottles)) return null;

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;
  // En recherche : on traverse TOUTES les catégories de boissons (pas les
  // bouteilles) sur le nom (traduit + brut). Sinon, filtre par catégorie active.
  const visibleDrinks = drinks
    .filter((d) => {
      if (searching) {
        return (
          getTranslatedDrinkName(d.name, language).toLowerCase().includes(q) ||
          d.name.toLowerCase().includes(q)
        );
      }
      return d.collection === category;
    })
    .sort((a, b) => {
      const aFav = favoriteDrinkIds.includes(a.id);
      const bFav = favoriteDrinkIds.includes(b.id);
      if (aFav && !bFav) return -1;
      if (!aFav && bFav) return 1;
      return 0;
    });

  return (
    <section className="mt-5">
      <h2
        className="px-4 font-display font-bold uppercase text-white"
        style={{ fontSize: 15, letterSpacing: '-0.005em' }}
      >
        {t('live.menuTitle')}
      </h2>

      {/* Barre de recherche — trouver une boisson en 1 frappe */}
      {showMenu && (
        <div className="mt-3 px-4">
          <div
            className="flex items-center gap-2 rounded px-3"
            style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.1)', height: 44 }}
          >
            <Search className="h-4 w-4 shrink-0" style={{ color: '#5A5A5E' }} />
            <input
              type="text"
              inputMode="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('live.search.placeholder')}
              aria-label={t('live.search.placeholder')}
              className="min-w-0 flex-1 bg-transparent font-mono uppercase text-white outline-none placeholder:normal-case"
              style={{ fontSize: 12, letterSpacing: '0.04em' }}
            />
            {searching && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label={t('common.cancel')}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                style={{ background: 'rgba(255,255,255,0.08)' }}
              >
                <X className="h-3.5 w-3.5 text-white" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Chips catégories — masquées pendant une recherche */}
      {!searching && categories.length > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto px-4 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {categories.map((c) => {
            const active = c.key === category;
            return (
              <motion.button
                key={c.key}
                type="button"
                onClick={() => setCategory(c.key)}
                whileTap={{ scale: 0.96 }}
                transition={transitions.pressFeedback}
                className="shrink-0 rounded-full px-3.5 py-1.5 font-mono font-bold uppercase"
                style={{
                  fontSize: 10,
                  letterSpacing: '0.1em',
                  color: active ? '#FFFFFF' : '#9A9A9A',
                  background: active ? 'rgba(232,25,44,0.16)' : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${active ? '#E8192C' : 'rgba(255,255,255,0.10)'}`,
                }}
              >
                {c.label}
              </motion.button>
            );
          })}
        </div>
      )}

      <div className="px-4 pt-3">
        {!searching && category === 'bottle' ? (
          <LiveBottleSection />
        ) : loading ? (
          <div className="flex justify-center py-10">
            <div className="h-7 w-7 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : visibleDrinks.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground text-sm">
            {searching ? t('live.search.empty') : t('venue.noDrinks')}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {visibleDrinks.map((drink) => (
              <LiveDrinkCard
                key={drink.id}
                drink={drink}
                onAdd={handleAdd}
                onPay={handlePay}
                paying={payingId === drink.id}
                isFavorite={favoriteDrinkIds.includes(drink.id)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
