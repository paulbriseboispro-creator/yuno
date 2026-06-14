import { useState, useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Plus, Heart } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useStore } from '@/store/useStore';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { getTranslatedDrinkName } from '@/lib/drinkTranslations';

interface CartRule {
  id: string;
  name: string;
  description: string | null;
  rule_type: string;
  trigger_collection: string | null;
  trigger_min_qty: number;
  discount_percent: number | null;
  addon_drink_id: string | null;
  addon_fixed_price: number | null;
}

interface OfferRule {
  id: string;
  trigger_collection: string | null;
  trigger_min_qty: number;
  reward_collection: string | null;
  free_qty: number;
  rule_type: string;
}

interface QuickDrink {
  id: string;
  name: string;
  price: number;
  promo_price?: number | null;
  presale_price?: number | null;
  presale_active?: boolean;
  img_url: string;
  collection: string;
  isFavorite?: boolean;
}

interface CartSuggestionsProps {
  venueId: string | null;
  offerRules?: OfferRule[];
}

const SUGGESTION_COUNT = 6;

export function CartSuggestions({ venueId, offerRules = [] }: CartSuggestionsProps) {
  const { t, language } = useLanguage();
  const { toast } = useToast();
  const { user } = useAuth();
  const cart = useStore(s => s.cart);
  const addToCart = useStore(s => s.addToCart);

  const [ruleSuggestions, setRuleSuggestions] = useState<Array<{
    rule: CartRule;
    drink?: QuickDrink;
    displayPrice: number;
    originalPrice: number;
  }>>([]);
  const [quickAdds, setQuickAdds] = useState<QuickDrink[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const cartDrinkIds = useMemo(() => cart.map(i => i.drinkId).sort().join(','), [cart]);
  const totalQty = useMemo(() => cart.reduce((sum, i) => sum + i.qty, 0), [cart]);
  const cartCollectionsKey = useMemo(() => [...new Set(cart.map(i => i.collection).filter(Boolean))].sort().join(','), [cart]);

  // Determine which collections are needed to unlock offers
  const neededCollections = useMemo(() => {
    if (!offerRules.length || !cart.length) return [];

    const getCategoryQty = (col: string | null) => {
      const items = col ? cart.filter(i => i.collection === col) : cart;
      return items.reduce((s, i) => s + i.qty, 0);
    };

    const collections: string[] = [];
    for (const rule of offerRules) {
      const isCrossCategory = !!rule.reward_collection && rule.reward_collection !== rule.trigger_collection;
      const triggerQty = getCategoryQty(rule.trigger_collection);

      if (isCrossCategory) {
        const remaining = Math.max(0, rule.trigger_min_qty - triggerQty);
        if (remaining > 0 && rule.trigger_collection) {
          collections.push(rule.trigger_collection);
        }
      } else {
        const needed = rule.trigger_min_qty + (rule.free_qty || 1);
        const remaining = Math.max(0, needed - triggerQty);
        if (remaining > 0 && rule.trigger_collection) {
          collections.push(rule.trigger_collection);
        }
      }
    }
    return [...new Set(collections)];
  }, [offerRules, cart]);

  useEffect(() => {
    if (!venueId || cart.length === 0) {
      setQuickAdds([]);
      setIsLoading(false);
      return;
    }
    fetchQuickAdds();
  }, [venueId, cartDrinkIds, cartCollectionsKey, neededCollections.join(',')]);

  useEffect(() => {
    if (!venueId || cart.length === 0) {
      setRuleSuggestions([]);
      return;
    }
    fetchRuleSuggestions();
  }, [venueId, cartDrinkIds, totalQty]);

  const fetchRuleSuggestions = async () => {
    if (!venueId) return;

    const { data: rules } = await supabase
      .from('upsell_cart_rules')
      .select('*')
      .eq('venue_id', venueId)
      .eq('is_active', true)
      .order('priority', { ascending: true })
      .limit(5);

    if (!rules || rules.length === 0) { setRuleSuggestions([]); return; }

    const addonIds = rules.filter(r => r.addon_drink_id).map(r => r.addon_drink_id!);
    let addonDrinks: QuickDrink[] = [];
    if (addonIds.length > 0) {
      const { data } = await supabase
        .from('drinks')
        .select('id, name, price, promo_price, presale_price, presale_active, img_url, collection')
        .in('id', addonIds);
      if (data) addonDrinks = data.map(d => ({ ...d, price: Number(d.price), promo_price: d.promo_price ? Number(d.promo_price) : null, presale_price: d.presale_price ? Number(d.presale_price) : null }));
    }

    const currentDrinkIds = new Set(cart.map(i => i.drinkId));

    const matched = rules
      .filter(rule => rule.rule_type === 'fixed_price_addon' && totalQty >= rule.trigger_min_qty)
      .map(rule => {
        if (rule.addon_drink_id) {
          const drink = addonDrinks.find(d => d.id === rule.addon_drink_id);
          if (!drink) return null;
          if (currentDrinkIds.has(drink.id)) return null;
          return {
            rule,
            drink,
            displayPrice: Number(rule.addon_fixed_price) || drink.price,
            originalPrice: drink.price,
          };
        }
        return null;
      })
      .filter(Boolean)
      .slice(0, 3) as typeof ruleSuggestions;

    setRuleSuggestions(matched);
  };

  const fetchQuickAdds = async () => {
    if (!venueId) return;
    setIsLoading(true);

    const currentDrinkIds = cart.map(i => i.drinkId);
    const cartCollections = new Set(cart.map(i => i.collection).filter(Boolean));

    let favoriteIds: string[] = [];
    if (user) {
      const { data: favs } = await supabase
        .from('favorites')
        .select('drink_id')
        .eq('user_id', user.id)
        .eq('favorite_type', 'drink')
        .not('drink_id', 'is', null);
      if (favs) favoriteIds = favs.map(f => f.drink_id!).filter(id => !currentDrinkIds.includes(id));
    }

    let drinks: QuickDrink[] = [];

    // Priority 1: Favorites not already in cart (user asked favorites first)
    if (favoriteIds.length > 0) {
      const { data } = await supabase
        .from('drinks')
        .select('id, name, price, promo_price, presale_price, presale_active, img_url, collection')
        .eq('venue_id', venueId)
        .eq('active', true)
        .in('id', favoriteIds)
        .limit(SUGGESTION_COUNT);
      if (data) drinks = data.map(d => ({ ...d, price: Number(d.price), promo_price: d.promo_price ? Number(d.promo_price) : null, presale_price: d.presale_price ? Number(d.presale_price) : null, isFavorite: true }));
    }

    // Priority 2: Drinks from collections needed to unlock offers
    if (drinks.length < SUGGESTION_COUNT && neededCollections.length > 0) {
      const excludeIds = [...currentDrinkIds, ...drinks.map(d => d.id)];
      const { data } = await supabase
        .from('drinks')
        .select('id, name, price, promo_price, presale_price, presale_active, img_url, collection')
        .eq('venue_id', venueId)
        .eq('active', true)
        .in('collection', neededCollections)
        .not('id', 'in', `(${excludeIds.length > 0 ? excludeIds.join(',') : '00000000-0000-0000-0000-000000000000'})`)
        .order('position', { ascending: true })
        .limit(SUGGESTION_COUNT - drinks.length);
      if (data) {
        const favSet = new Set(favoriteIds);
        drinks = [...drinks, ...data.map(d => ({
          ...d,
          price: Number(d.price),
          promo_price: d.promo_price ? Number(d.promo_price) : null,
          presale_price: d.presale_price ? Number(d.presale_price) : null,
          isFavorite: favSet.has(d.id),
        }))];
      }
    }

    // Priority 3: Complementary collections
    if (drinks.length < SUGGESTION_COUNT) {
      const complementaryCollections: string[] = [];
      if (cartCollections.has('drink')) complementaryCollections.push('shot', 'soft');
      if (cartCollections.has('shot')) complementaryCollections.push('drink', 'soft');
      if (cartCollections.has('soft')) complementaryCollections.push('drink');
      if (complementaryCollections.length === 0) complementaryCollections.push('shot', 'soft', 'drink');

      const excludeIds = [...currentDrinkIds, ...drinks.map(d => d.id)];
      const { data } = await supabase
        .from('drinks')
        .select('id, name, price, promo_price, presale_price, presale_active, img_url, collection')
        .eq('venue_id', venueId)
        .eq('active', true)
        .in('collection', complementaryCollections)
        .not('id', 'in', `(${excludeIds.length > 0 ? excludeIds.join(',') : '00000000-0000-0000-0000-000000000000'})`)
        .order('position', { ascending: true })
        .limit(SUGGESTION_COUNT - drinks.length);
      if (data) drinks = [...drinks, ...data.map(d => ({ ...d, price: Number(d.price), promo_price: d.promo_price ? Number(d.promo_price) : null, presale_price: d.presale_price ? Number(d.presale_price) : null }))];
    }

    // Priority 4: Broader fallback
    if (drinks.length < SUGGESTION_COUNT) {
      const excludeIds = [...currentDrinkIds, ...drinks.map(d => d.id)];
      const { data } = await supabase
        .from('drinks')
        .select('id, name, price, promo_price, presale_price, presale_active, img_url, collection')
        .eq('venue_id', venueId)
        .eq('active', true)
        .not('id', 'in', `(${excludeIds.length > 0 ? excludeIds.join(',') : '00000000-0000-0000-0000-000000000000'})`)
        .order('position', { ascending: true })
        .limit(SUGGESTION_COUNT - drinks.length);
      if (data) drinks = [...drinks, ...data.map(d => ({ ...d, price: Number(d.price), promo_price: d.promo_price ? Number(d.promo_price) : null, presale_price: d.presale_price ? Number(d.presale_price) : null }))];
    }

    setQuickAdds(drinks);
    setIsLoading(false);
    // Reset scroll to start
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollLeft = 0;
    });
  };

  const handleAddDrink = (drink: QuickDrink, customPrice?: number) => {
    const eventId = cart[0]?.eventId;
    const eventTitle = cart[0]?.eventTitle;

    let effectivePrice = drink.price;
    if (drink.presale_active && drink.presale_price) {
      effectivePrice = drink.presale_price;
    } else if (drink.promo_price && drink.promo_price < drink.price) {
      effectivePrice = drink.promo_price;
    }

    const finalPrice = customPrice ?? effectivePrice;

    addToCart(
      {
        id: drink.id,
        name: drink.name,
        price: drink.price,
        promoPrice: drink.promo_price && drink.promo_price < drink.price ? drink.promo_price : undefined,
        presalePrice: drink.presale_price ?? undefined,
        presaleActive: drink.presale_active ?? false,
        imgUrl: drink.img_url,
        venueId: venueId || '',
        active: true,
        position: 0,
        collection: drink.collection as 'drink' | 'shot' | 'soft',
      },
      eventId,
      eventTitle,
    );

    toast({
      title: t('cart.added'),
      description: `${drink.name} — ${finalPrice.toFixed(2)}€`,
    });
  };

  const hasRules = ruleSuggestions.length > 0;
  const hasQuickAdds = quickAdds.length > 0;

  if (!hasRules && !hasQuickAdds && !isLoading) return null;
  if (isLoading) return (
    <div className="mt-6 flex justify-center py-4">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-6 space-y-4"
    >
      {/* Rule-based suggestions */}
      {hasRules && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="h-4 w-4 text-amber-400" />
            <h3 className="text-sm font-semibold">{t('upsell.suggestions')}</h3>
          </div>
          <div className="space-y-2">
            {ruleSuggestions.map((s, i) => (
              <motion.div
                key={s.rule.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.1 }}
              >
                {s.rule.rule_type === 'fixed_price_addon' && s.drink && (
                  <Card className="p-3 border border-amber-500/20 bg-amber-500/[0.04]">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-lg bg-muted overflow-hidden shrink-0">
                        <img src={s.drink.img_url} alt="" className="w-full h-full object-contain p-1" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-medium truncate">{s.rule.name}</h4>
                        <div className="flex items-center gap-2">
                          <span className="text-xs line-through text-muted-foreground">{s.originalPrice.toFixed(2)}€</span>
                          <span className="text-sm font-bold text-amber-400">{s.displayPrice.toFixed(2)}€</span>
                          <Badge className="text-[10px] bg-primary/15 text-primary border-0 font-bold">
                            -{Math.round((1 - s.displayPrice / s.originalPrice) * 100)}%
                          </Badge>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0 h-8 border-amber-500/30 hover:bg-amber-500/10"
                        onClick={() => handleAddDrink(s.drink!, s.displayPrice)}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </Card>
                )}
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* Quick-add suggestions — horizontal scrollable carousel */}
      {hasQuickAdds && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Plus className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-xs font-medium text-muted-foreground">{t('upsell.quickAdd')}</h3>
          </div>
          <div ref={scrollRef} className="flex gap-2.5 overflow-x-auto pb-2 scrollbar-hide snap-x">
            {quickAdds.map((drink, i) => (
              <motion.div
                key={drink.id}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.04 }}
                className="flex-shrink-0 snap-start"
              >
                <Card
                  className="w-[7.5rem] sm:w-36 p-2 border-border/30 hover:border-border/60 cursor-pointer transition-all group"
                  onClick={() => handleAddDrink(drink)}
                >
                  <div className="relative w-full h-24 sm:h-28 rounded bg-black overflow-hidden mb-1.5">
                    <img src={drink.img_url} alt="" className="w-full h-full object-contain p-1" />
                    {drink.isFavorite && (
                      <Heart className="absolute top-1 right-1 h-3 w-3 text-primary fill-primary" />
                    )}
                    <div className="absolute inset-0 bg-primary/0 group-hover:bg-primary/10 transition-colors flex items-center justify-center">
                      <Plus className="h-5 w-5 text-primary opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </div>
                  <p className="text-[11px] font-medium truncate">{getTranslatedDrinkName(drink.name, language)}</p>
                  {(() => {
                    const hasPromo = drink.promo_price && drink.promo_price < drink.price;
                    const hasPresale = drink.presale_active && drink.presale_price && drink.presale_price < drink.price;
                    const displayPrice = hasPresale ? drink.presale_price! : hasPromo ? drink.promo_price! : drink.price;
                    return hasPromo || hasPresale ? (
                      <div className="flex items-center gap-1">
                        <p className="text-[11px] font-bold text-accent">{displayPrice.toFixed(2)}€</p>
                        <p className="text-[9px] line-through text-muted-foreground">{drink.price.toFixed(2)}€</p>
                      </div>
                    ) : (
                      <p className="text-[11px] font-bold text-accent">{drink.price.toFixed(2)}€</p>
                    );
                  })()}
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}
