import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Percent, Gift, Check, Plus } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { useStore } from '@/store/useStore';
import { useToast } from '@/hooks/use-toast';
import { getTranslatedDrinkName } from '@/lib/drinkTranslations';

interface CartRule {
  id: string;
  name: string;
  description: string | null;
  rule_type: string;
  trigger_collection: string | null;
  trigger_min_qty: number;
  discount_percent: number | null;
  reward_collection: string | null;
  reward_drink_id: string | null;
  free_qty: number;
}

interface CartItem {
  drinkId: string;
  qty: number;
  collection?: string;
  unitPrice: number;
  name: string;
}

interface RewardDrink {
  id: string;
  name: string;
  price: number;
  img_url: string;
  collection: string;
}

interface CartOffersBannerProps {
  rules: CartRule[];
  cart: CartItem[];
  venueId: string | null;
  eventId?: string;
  eventTitle?: string;
}

export function CartOffersBanner({ rules, cart, venueId, eventId, eventTitle }: CartOffersBannerProps) {
  const { t, language } = useLanguage();
  const { toast } = useToast();
  const addToCart = useStore(s => s.addToCart);
  const [rewardDrinks, setRewardDrinks] = useState<Record<string, RewardDrink[]>>({});

  const collectionLabel = (col: string | null): string => {
    switch (col) {
      case 'drink': return t('venue.drinks');
      case 'shot': return t('venue.shots');
      case 'soft': return t('venue.softs');
      default: return '';
    }
  };

  const offerStates = useMemo(() => {
    if (!rules.length || !cart.length) return [];

    const getCategoryQty = (col: string | null) => {
      const items = col ? cart.filter(i => i.collection === col) : cart;
      return items.reduce((s, i) => s + i.qty, 0);
    };

    return rules.map(rule => {
      const isCrossCategory = !!rule.reward_collection && rule.reward_collection !== rule.trigger_collection;
      const triggerQty = getCategoryQty(rule.trigger_collection);

      if (isCrossCategory) {
        // Cross-category: only need trigger_min_qty of trigger items
        const isUnlocked = triggerQty >= rule.trigger_min_qty;
        const remaining = Math.max(0, rule.trigger_min_qty - triggerQty);
        // Check if reward item already in cart
        const rewardInCart = cart.some(i => i.collection === rule.reward_collection);
        return { rule, isUnlocked, remaining, isCrossCategory, rewardInCart };
      } else {
        // Same category: need trigger_min_qty + free_qty total items
        const needed = rule.trigger_min_qty + (rule.free_qty || 1);
        const isUnlocked = triggerQty >= needed;
        const remaining = Math.max(0, needed - triggerQty);
        return { rule, isUnlocked, remaining, isCrossCategory, rewardInCart: false };
      }
    }).filter(o => o.remaining <= 3 || o.isUnlocked);
  }, [rules, cart]);

  // Fetch reward drinks for unlocked cross-category offers
  useEffect(() => {
    if (!venueId) return;
    const unlockedCross = offerStates.filter(o => o.isCrossCategory && o.isUnlocked && !o.rewardInCart);
    const collectionsToFetch = [...new Set(unlockedCross.map(o => o.rule.reward_collection!))];
    
    if (collectionsToFetch.length === 0) return;

    const fetchRewards = async () => {
      const results: Record<string, RewardDrink[]> = {};
      for (const col of collectionsToFetch) {
        if (rewardDrinks[col]?.length) continue; // already fetched
        const { data } = await supabase
          .from('drinks')
          .select('id, name, price, img_url, collection')
          .eq('venue_id', venueId)
          .eq('active', true)
          .eq('collection', col)
          .order('position', { ascending: true })
          .limit(10);
        if (data) results[col] = data.map(d => ({ ...d, price: Number(d.price) }));
      }
      if (Object.keys(results).length > 0) {
        setRewardDrinks(prev => ({ ...prev, ...results }));
      }
    };
    fetchRewards();
  }, [venueId, offerStates]);

  const handleAddReward = (drink: RewardDrink) => {
    addToCart(
      {
        id: drink.id,
        name: drink.name,
        price: drink.price,
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
      title: t('upsell.rewardAdded'),
      description: `${getTranslatedDrinkName(drink.name, language)}`,
    });
  };

  if (!offerStates.length) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-2"
    >
      {offerStates.map(({ rule, isUnlocked, remaining, isCrossCategory, rewardInCart }) => {
        const isFree = rule.discount_percent === 100;
        const rewardCol = rule.reward_collection;
        const showPicker = isCrossCategory && isUnlocked && !rewardInCart && rewardCol && rewardDrinks[rewardCol]?.length;

        return (
          <div key={rule.id}>
            <Card
              className={`p-3 border ${isUnlocked
                ? (rewardInCart ? 'border-primary/30 bg-primary/[0.06]' : 'border-amber-500/30 bg-amber-500/[0.06]')
                : 'border-amber-500/20 bg-amber-500/[0.04]'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                  isUnlocked && rewardInCart ? 'bg-primary/15' : 'bg-amber-500/10'
                }`}>
                  {isUnlocked && rewardInCart ? (
                    <Check className="h-4 w-4 text-primary" />
                  ) : isFree ? (
                    <Gift className="h-4 w-4 text-amber-400" />
                  ) : (
                    <Percent className="h-4 w-4 text-amber-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  {isUnlocked && rewardInCart ? (
                    <p className="text-sm font-semibold text-primary">
                      {t('upsell.offerApplied')} — {rule.name}
                    </p>
                  ) : isUnlocked && isCrossCategory ? (
                    <>
                      <p className="text-sm font-semibold text-amber-400">
                        {t('upsell.offerUnlocked')}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t('upsell.pickYourReward').replace('{item}', rewardCol || 'item')}
                      </p>
                    </>
                  ) : isUnlocked ? (
                    <p className="text-sm font-semibold text-primary">
                      {t('upsell.offerApplied')} — {rule.name}
                    </p>
                  ) : (
                    <>
                      <p className="text-sm font-semibold">
                        {t('upsell.offerAddMore')
                          .replace('{count}', String(remaining))
                          .replace('{category}', collectionLabel(rule.trigger_collection))}
                      </p>
                      <p className="text-xs text-muted-foreground">{rule.name}</p>
                    </>
                  )}
                </div>
                {isUnlocked && rewardInCart && (
                  <Badge className="bg-primary/15 text-primary border-0 text-[10px]">
                    {isFree ? t('upsell.summaryFree') : `-${rule.discount_percent}%`}
                  </Badge>
                )}
                {!isUnlocked && (
                  <Badge className="bg-amber-500/15 text-amber-400 border-0 text-[10px]">
                    +{remaining}
                  </Badge>
                )}
              </div>
            </Card>

            {/* Reward picker carousel */}
            {showPicker && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="mt-2 overflow-y-hidden overflow-x-visible"
              >
                <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                  {rewardDrinks[rewardCol!]!.map((drink) => (
                    <Card
                      key={drink.id}
                      className="w-24 p-2 border-amber-500/20 hover:border-amber-500/40 cursor-pointer transition-all group flex-shrink-0"
                      onClick={() => handleAddReward(drink)}
                    >
                      <div className="relative w-full h-14 rounded bg-muted/50 overflow-hidden mb-1">
                        <img src={drink.img_url} alt="" className="w-full h-full object-contain p-1" />
                        <div className="absolute inset-0 bg-amber-500/0 group-hover:bg-amber-500/10 transition-colors flex items-center justify-center">
                          <Plus className="h-4 w-4 text-amber-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </div>
                      <p className="text-[10px] font-medium truncate">{getTranslatedDrinkName(drink.name, language)}</p>
                      <div className="flex items-center gap-1">
                        <p className="text-[10px] font-bold text-foreground">{isFree ? t('upsell.free') : `-${rule.discount_percent}%`}</p>
                        <p className="text-[9px] line-through text-muted-foreground">{drink.price.toFixed(2)}€</p>
                      </div>
                    </Card>
                  ))}
                </div>
              </motion.div>
            )}
          </div>
        );
      })}
    </motion.div>
  );
}
