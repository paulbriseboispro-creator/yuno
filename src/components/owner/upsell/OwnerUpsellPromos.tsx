import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Switch } from '@/components/ui/switch';
import { Info, Percent } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import {
  UInfoBanner, UEmpty, ULoading, UPill,
  CARD_BG, INNER_BG, BORDER, T1, T3, POS,
} from './upsell-ui';

interface DrinkWithPromo {
  id: string;
  name: string;
  price: number;
  promo_price: number | null;
  img_url: string;
  collection: string;
  hasPromo: boolean;
}

export function OwnerUpsellPromos({ venueId }: { venueId: string }) {
  const { t } = useLanguage();
  const [drinks, setDrinks] = useState<DrinkWithPromo[]>([]);
  const [loading, setLoading] = useState(true);
  const [editPrices, setEditPrices] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchDrinks();
  }, [venueId]);

  const fetchDrinks = async () => {
    const { data, error } = await supabase
      .from('drinks')
      .select('id, name, price, promo_price, img_url, collection')
      .eq('venue_id', venueId)
      .eq('active', true)
      .order('name');

    if (!error && data) {
      const mapped = data.map(d => ({
        ...d,
        price: Number(d.price),
        promo_price: d.promo_price ? Number(d.promo_price) : null,
        hasPromo: d.promo_price !== null && d.promo_price !== undefined,
      }));
      setDrinks(mapped);
      // Init edit prices
      const prices: Record<string, string> = {};
      mapped.forEach(d => {
        if (d.promo_price !== null) prices[d.id] = d.promo_price.toString();
      });
      setEditPrices(prices);
    }
    setLoading(false);
  };

  const togglePromo = async (drink: DrinkWithPromo) => {
    if (drink.hasPromo) {
      // Remove promo
      const { error } = await supabase.from('drinks').update({ promo_price: null }).eq('id', drink.id);
      if (error) { toast.error(t('common.error')); return; }
      toast.success(t('upsell.promoRemoved'));
    } else {
      // Set a default promo price (80% of original)
      const defaultPromo = Math.round(drink.price * 0.8 * 100) / 100;
      const { error } = await supabase.from('drinks').update({ promo_price: defaultPromo }).eq('id', drink.id);
      if (error) { toast.error(t('common.error')); return; }
      setEditPrices(prev => ({ ...prev, [drink.id]: defaultPromo.toString() }));
      toast.success(t('upsell.promoAdded'));
    }
    fetchDrinks();
  };

  const savePromoPrice = async (drinkId: string) => {
    const price = parseFloat(editPrices[drinkId]);
    if (isNaN(price) || price <= 0) {
      toast.error(t('upsell.invalidPrice'));
      return;
    }
    const { error } = await supabase.from('drinks').update({ promo_price: price }).eq('id', drinkId);
    if (error) { toast.error(t('common.error')); return; }
    toast.success(t('upsell.promoUpdated'));
    fetchDrinks();
  };

  if (loading) return <ULoading />;

  const promoDrinks = drinks.filter(d => d.hasPromo);
  const otherDrinks = drinks.filter(d => !d.hasPromo);

  return (
    <div className="space-y-5">
      <UInfoBanner icon={Info}>{t('upsell.promosContextInfo')}</UInfoBanner>

      {/* Active promos */}
      {promoDrinks.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Percent className="h-4 w-4" style={{ color: POS }} />
            <h3 className="text-[13px] font-semibold" style={{ color: T1, letterSpacing: '-0.01em' }}>
              {t('upsell.activePromos')}
            </h3>
            <UPill tone="success">{promoDrinks.length}</UPill>
          </div>
          <div className="space-y-2.5">
            {promoDrinks.map((drink, i) => {
              const saving = Math.round((1 - (drink.promo_price || 0) / drink.price) * 100);
              return (
                <motion.div key={drink.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                  <div
                    className="overflow-hidden"
                    style={{ background: CARD_BG, border: '1px solid rgba(52,211,153,0.22)', borderRadius: 14, padding: 12 }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-11 h-11 rounded-xl overflow-hidden shrink-0" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                        <img src={drink.img_url} alt="" className="w-full h-full object-contain" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-[13.5px] font-medium truncate" style={{ color: T1 }}>{drink.name}</h4>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[12px] line-through tabular-nums" style={{ color: T3 }}>{drink.price}€</span>
                          <input
                            type="number"
                            step="0.01"
                            value={editPrices[drink.id] || ''}
                            onChange={e => setEditPrices(prev => ({ ...prev, [drink.id]: e.target.value }))}
                            onBlur={() => savePromoPrice(drink.id)}
                            className="h-7 w-[72px] rounded-lg px-2 text-[12px] tabular-nums outline-none transition-all duration-150"
                            style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T1 }}
                            onFocus={(e) => (e.target.style.borderColor = 'rgba(255,255,255,0.18)')}
                          />
                          <UPill tone="success">-{saving}%</UPill>
                        </div>
                      </div>
                      <Switch checked={true} onCheckedChange={() => togglePromo(drink)} />
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}

      {/* Other drinks */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-[13px] font-semibold" style={{ color: T1, letterSpacing: '-0.01em' }}>
            {t('upsell.catalogDrinks')}
          </h3>
          <UPill tone="muted">{otherDrinks.length}</UPill>
        </div>
        {otherDrinks.length === 0 ? (
          <UEmpty icon={Percent} title={t('upsell.catalogDrinks')} />
        ) : (
          <div className="space-y-2.5">
            {otherDrinks.map(drink => (
              <div
                key={drink.id}
                className="overflow-hidden"
                style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 12 }}
              >
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl overflow-hidden shrink-0" style={{ background: INNER_BG, border: `1px solid ${BORDER}` }}>
                    <img src={drink.img_url} alt="" className="w-full h-full object-contain" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-[13.5px] font-medium truncate" style={{ color: T1 }}>{drink.name}</h4>
                    <span className="text-[12px] tabular-nums" style={{ color: T3 }}>{drink.price}€</span>
                  </div>
                  <Switch checked={false} onCheckedChange={() => togglePromo(drink)} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
