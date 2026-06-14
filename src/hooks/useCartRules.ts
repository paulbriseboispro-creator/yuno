import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';

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

interface DiscountInfo {
  ruleId: string;
  drinkId: string;
  discountAmount: number;
  discountPercent: number;
  isFree: boolean;
}

export function useCartRules(venueId: string | null, cart: CartItem[]) {
  const [rules, setRules] = useState<CartRule[]>([]);

  useEffect(() => {
    if (!venueId) { setRules([]); return; }
    const fetch = async () => {
      const { data } = await supabase
        .from('upsell_cart_rules')
        .select('id, name, description, rule_type, trigger_collection, trigger_min_qty, discount_percent, reward_collection, reward_drink_id, free_qty')
        .eq('venue_id', venueId)
        .eq('is_active', true)
        .eq('rule_type', 'percentage_discount')
        .order('priority', { ascending: true });
      if (data) {
        setRules(data.map((r: any) => ({
          ...r,
          discount_percent: r.discount_percent ? Number(r.discount_percent) : null,
          free_qty: r.free_qty ?? 1,
        })));
      }
    };
    fetch();
  }, [venueId]);

  const { activeDiscount, totalDiscount, discountedItems } = useMemo(() => {
    if (!rules.length || !cart.length) return { activeDiscount: null, totalDiscount: 0, discountedItems: [] as DiscountInfo[] };

    for (const rule of rules) {
      const triggerCol = rule.trigger_collection;
      const rewardCol = rule.reward_collection || triggerCol;
      const matchingTrigger = triggerCol
        ? cart.filter(i => i.collection === triggerCol)
        : cart;
      const triggerQty = matchingTrigger.reduce((s, i) => s + i.qty, 0);
      
      // For qty_discount (same category): need trigger_min_qty + free_qty items
      // For cross-category: need trigger_min_qty of trigger + free_qty of reward in cart
      const isSameCategory = !rule.reward_collection || rule.reward_collection === triggerCol;
      
      if (isSameCategory) {
        const needed = rule.trigger_min_qty + (rule.free_qty || 1);
        if (triggerQty < needed) continue;
        
        // Find cheapest item(s) to discount
        const unitPrices: { drinkId: string; price: number; name: string }[] = [];
        matchingTrigger.forEach(item => {
          for (let i = 0; i < item.qty; i++) unitPrices.push({ drinkId: item.drinkId, price: item.unitPrice, name: item.name });
        });
        unitPrices.sort((a, b) => a.price - b.price);
        
        const discounts: DiscountInfo[] = [];
        let totalDisc = 0;
        for (let i = 0; i < Math.min(rule.free_qty || 1, unitPrices.length); i++) {
          const disc = unitPrices[i].price * ((rule.discount_percent || 0) / 100);
          totalDisc += disc;
          discounts.push({
            ruleId: rule.id,
            drinkId: unitPrices[i].drinkId,
            discountAmount: disc,
            discountPercent: rule.discount_percent || 0,
            isFree: rule.discount_percent === 100,
          });
        }
        return { activeDiscount: rule, totalDiscount: totalDisc, discountedItems: discounts };
      } else {
        // Cross-category: trigger_min_qty of trigger category, reward from reward category
        if (triggerQty < rule.trigger_min_qty) continue;
        
        const rewardItems = cart.filter(i => i.collection === rewardCol);
        const rewardQty = rewardItems.reduce((s, i) => s + i.qty, 0);
        // If no reward item in cart yet, the offer is unlocked but no discount to apply yet
        if (rewardQty < 1) continue;
        
        // Discount cheapest reward item(s)
        const rewardPrices: { drinkId: string; price: number }[] = [];
        rewardItems.forEach(item => {
          for (let i = 0; i < item.qty; i++) rewardPrices.push({ drinkId: item.drinkId, price: item.unitPrice });
        });
        rewardPrices.sort((a, b) => a.price - b.price);
        
        const discounts: DiscountInfo[] = [];
        let totalDisc = 0;
        for (let i = 0; i < Math.min(rule.free_qty || 1, rewardPrices.length); i++) {
          const disc = rewardPrices[i].price * ((rule.discount_percent || 0) / 100);
          totalDisc += disc;
          discounts.push({
            ruleId: rule.id,
            drinkId: rewardPrices[i].drinkId,
            discountAmount: disc,
            discountPercent: rule.discount_percent || 0,
            isFree: rule.discount_percent === 100,
          });
        }
        return { activeDiscount: rule, totalDiscount: totalDisc, discountedItems: discounts };
      }
    }

    return { activeDiscount: null, totalDiscount: 0, discountedItems: [] as DiscountInfo[] };
  }, [rules, cart]);

  return { rules, activeDiscount, totalDiscount, discountedItems };
}
