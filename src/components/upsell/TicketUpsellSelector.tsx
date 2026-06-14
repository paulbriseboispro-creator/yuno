import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Check, Sparkles, Package, Tag, Shirt, Percent } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';

interface TicketUpsellOffer {
  id: string;
  offer_type: string;
  name: string;
  name_fr: string | null;
  name_en: string | null;
  name_es: string | null;
  description: string | null;
  description_fr: string | null;
  description_en: string | null;
  description_es: string | null;
  drink_count: number | null;
  pack_price: number | null;
  original_price: number | null;
  discounted_price: number | null;
  regular_price: number | null;
  cloakroom_price: number | null;
  cloakroom_regular_price: number | null;
  combo_qty: number | null;
  combo_discount_percent: number | null;
}

export interface SelectedUpsell {
  offerId: string;
  offerType: string;
  name: string;
  price: number;
  drinkCount?: number;
}

interface TicketUpsellSelectorProps {
  venueId: string;
  selectedUpsells: SelectedUpsell[];
  onToggle: (upsell: SelectedUpsell) => void;
}

export function TicketUpsellSelector({ venueId, selectedUpsells, onToggle }: TicketUpsellSelectorProps) {
  const { t, language } = useLanguage();
  const [offers, setOffers] = useState<TicketUpsellOffer[]>([]);
  const [loading, setLoading] = useState(true);

  // Generate localized name from offer_type + params using i18n templates
  const getLocalizedName = (offer: TicketUpsellOffer): string => {
    // First check DB translated fields
    const langKey = `name_${language}` as keyof TicketUpsellOffer;
    const dbTranslation = offer[langKey] as string;
    if (dbTranslation) return dbTranslation;

    // Auto-generate from i18n templates using offer params
    switch (offer.offer_type) {
      case 'drink_pack':
        return t('upsell.ticketAutoNameDrinkPack')
          .replace('{count}', String(offer.drink_count || 0))
          .replace('{price}', String(Number(offer.pack_price) || 0));
      case 'single_drink_discount':
        return t('upsell.ticketAutoNameDrink')
          .replace('{price}', String(Number(offer.discounted_price) || 0));
      case 'cloakroom':
        return t('upsell.ticketAutoNameCloakroom')
          .replace('{price}', String(Number(offer.cloakroom_price) || 0));
      case 'drink_combo':
        return t('upsell.ticketAutoNameCombo')
          .replace('{count}', String(offer.combo_qty || 0))
          .replace('{percent}', String(Number(offer.combo_discount_percent) || 0));
      default:
        return offer.name;
    }
  };

  const getLocalizedDescription = (offer: TicketUpsellOffer): string | null => {
    const langKey = `description_${language}` as keyof TicketUpsellOffer;
    return (offer[langKey] as string) || offer.description;
  };

  useEffect(() => {
    const fetchOffers = async () => {
      const { data } = await supabase
        .from('ticket_upsell_offers')
        .select('*')
        .eq('venue_id', venueId)
        .eq('is_active', true)
        .order('priority', { ascending: true });

      if (data) setOffers(data as any);
      setLoading(false);
    };
    fetchOffers();
  }, [venueId]);

  if (loading || offers.length === 0) return null;

  const getOfferPrice = (offer: TicketUpsellOffer): number => {
    switch (offer.offer_type) {
      case 'drink_pack': return Number(offer.pack_price) || 0;
      case 'single_drink_discount': return Number(offer.discounted_price) || 0;
      case 'cloakroom': return Number(offer.cloakroom_price) || 0;
      case 'drink_combo': return 0; // Discount applied later
      default: return 0;
    }
  };

  const getOriginalPrice = (offer: TicketUpsellOffer): number | null => {
    switch (offer.offer_type) {
      case 'drink_pack': return Number(offer.original_price) || null;
      case 'single_drink_discount': return Number(offer.regular_price) || null;
      case 'cloakroom': return Number(offer.cloakroom_regular_price) || null;
      default: return null;
    }
  };

  const getSaving = (offer: TicketUpsellOffer): number | null => {
    const price = getOfferPrice(offer);
    const original = getOriginalPrice(offer);
    if (!original || original <= price) return null;
    return Math.round((1 - price / original) * 100);
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'drink_pack': return <Package className="h-3.5 w-3.5 text-amber-400" />;
      case 'single_drink_discount': return <Tag className="h-3.5 w-3.5 text-green-500" />;
      case 'cloakroom': return <Shirt className="h-3.5 w-3.5 text-blue-400" />;
      case 'drink_combo': return <Percent className="h-3.5 w-3.5 text-purple-400" />;
      default: return <Package className="h-3.5 w-3.5" />;
    }
  };

  const getSubtitle = (offer: TicketUpsellOffer): string => {
    switch (offer.offer_type) {
      case 'drink_pack': return (offer.drink_count || 0) > 1
        ? t('upsell.drinksIncludedCount').replace('{count}', String(offer.drink_count))
        : t('upsell.oneDrinkIncluded');
      case 'single_drink_discount': return t('upsell.oneDrinkIncluded');
      case 'cloakroom': return t('upsell.cloakroomIncluded');
      case 'drink_combo': return t('upsell.drinksAtDiscount').replace('{count}', String(offer.combo_qty)).replace('{percent}', String(Number(offer.combo_discount_percent)));
      default: return '';
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.08 }}
      className="mt-6"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span className="font-mono uppercase text-[10.5px] font-semibold tracking-[0.16em] text-[#9A9A9A]">
            {t('upsell.addOptions')}
          </span>
        </div>
        <span className="font-mono uppercase text-[9px] font-semibold tracking-[0.12em] text-[#5A5A5E]">
          {t('upsell.optionalLabel')}
        </span>
      </div>

      <div className="space-y-2">
        {offers.map((offer, i) => {
          const isSelected = selectedUpsells.some(u => u.offerId === offer.id);
          const price = getOfferPrice(offer);
          const originalPrice = getOriginalPrice(offer);
          const saving = getSaving(offer);

          return (
            <motion.div
              key={offer.id}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04 }}
              onClick={() => onToggle({
                offerId: offer.id,
                offerType: offer.offer_type,
                name: getLocalizedName(offer),
                price,
                drinkCount: offer.drink_count || undefined,
              })}
              className="p-3.5 cursor-pointer transition-all duration-200 rounded-[10px] border active:scale-[0.99]"
              style={isSelected
                ? { borderColor: 'rgba(232,25,44,0.45)', background: 'rgba(232,25,44,0.05)' }
                : { borderColor: 'rgba(255,255,255,0.08)', background: '#141414' }}
            >
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-white/[0.04] border border-white/[0.08] shrink-0">
                  {getIcon(offer.offer_type)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="font-bold text-sm truncate text-white">{getLocalizedName(offer)}</h4>
                    {saving && (
                      <span
                        className="font-mono text-[9px] font-bold text-primary px-1.5 py-0.5 rounded-full shrink-0"
                        style={{ background: 'rgba(232,25,44,0.12)' }}
                      >
                        -{saving}%
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#9A9A9A] mt-0.5">{getSubtitle(offer)}</p>
                </div>
                <div className="flex items-center gap-2.5 shrink-0">
                  <div className="text-right">
                    {price > 0 && (
                      <>
                        <span className="font-mono text-sm font-bold text-white">{price}€</span>
                        {originalPrice && originalPrice > price && (
                          <span className="font-mono text-[10px] line-through text-[#5A5A5E] ml-1">{originalPrice}€</span>
                        )}
                      </>
                    )}
                    {offer.offer_type === 'drink_combo' && (
                      <span className="font-mono text-sm font-bold text-primary">-{Number(offer.combo_discount_percent)}%</span>
                    )}
                  </div>
                  {isSelected && (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="w-5 h-5 rounded-full bg-primary flex items-center justify-center"
                    >
                      <Check className="h-3 w-3 text-white" strokeWidth={3} />
                    </motion.div>
                  )}
                </div>
              </div>
              {getLocalizedDescription(offer) && (
                <p className="text-[10px] text-[#5A5A5E] mt-2 ml-12">{getLocalizedDescription(offer)}</p>
              )}
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}
