import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface VipMenuItem {
  id: string;
  name: string;
  category: 'champagne' | 'vodka' | 'whisky' | 'gin' | 'rum' | 'tequila' | 'cognac' | 'wine' | 'soft' | 'mixer' | 'other';
  price: number;
  description?: string;
  imageUrl?: string;
  isActive: boolean;
  position: number;
}

interface QuickItem {
  id: string;
  name: string;
  item_type: 'bottle' | 'extra' | 'service';
  default_price: number;
}

export function useVipMenuItems(venueId: string | null) {
  const [items, setItems] = useState<VipMenuItem[]>([]);
  const [quickItems, setQuickItems] = useState<QuickItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchItems = useCallback(async () => {
    if (!venueId) {
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('vip_menu_items')
        .select('*')
        .eq('venue_id', venueId)
        .eq('is_active', true)
        .order('position', { ascending: true });

      if (error) throw error;

      const mapped: VipMenuItem[] = (data || []).map((item: any) => ({
        id: item.id,
        name: item.name,
        category: item.category,
        price: item.price,
        description: item.description,
        imageUrl: item.image_url,
        isActive: item.is_active,
        position: item.position || 0,
      }));

      setItems(mapped);

      // Transform to quick items format for VipTableDetail
      const quick: QuickItem[] = mapped.map(item => ({
        id: item.id,
        name: item.name,
        item_type: getCategoryType(item.category),
        default_price: item.price,
      }));

      setQuickItems(quick);
    } catch (error) {
      console.error('Error fetching VIP menu items:', error);
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  return { items, quickItems, loading, refresh: fetchItems };
}

function getCategoryType(category: string): 'bottle' | 'extra' | 'service' {
  const bottleCategories = ['champagne', 'vodka', 'whisky', 'gin', 'rum', 'tequila', 'cognac', 'wine'];
  
  if (bottleCategories.includes(category)) return 'bottle';
  if (category === 'mixer') return 'extra';
  return 'service';
}
