import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Package, Check, Sparkles } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';

interface DrinkPack {
  id: string;
  name: string;
  description: string | null;
  drink_count: number;
  pack_price: number;
  original_price: number;
  allowed_collections: string[] | null;
}

interface TicketPackSelectorProps {
  venueId: string;
  selectedPackId: string | null;
  onSelect: (pack: DrinkPack | null) => void;
}

export function TicketPackSelector({ venueId, selectedPackId, onSelect }: TicketPackSelectorProps) {
  const { t } = useLanguage();
  const [packs, setPacks] = useState<DrinkPack[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPacks = async () => {
      const { data } = await supabase
        .from('upsell_drink_packs')
        .select('*')
        .eq('venue_id', venueId)
        .eq('is_active', true)
        .order('pack_price', { ascending: true });

      if (data) {
        setPacks(data.map(p => ({
          ...p,
          pack_price: Number(p.pack_price),
          original_price: Number(p.original_price),
        })));
      }
      setLoading(false);
    };
    fetchPacks();
  }, [venueId]);

  if (loading || packs.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.08 }}
      className="mt-5 rounded-xl border border-amber-500/20 bg-gradient-to-br from-amber-500/[0.04] to-transparent p-4"
    >
      {/* Header with accent */}
      <div className="flex items-center gap-2 mb-1">
        <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-amber-500/10">
          <Sparkles className="h-3.5 w-3.5 text-amber-400" />
        </div>
        <h3 className="text-sm font-bold">{t('upsell.addDrinkPack')}</h3>
        <Badge variant="outline" className="ml-auto text-[10px] border-amber-500/30 text-amber-400 bg-amber-500/5">
          {t('upsell.optional') || 'Optionnel'}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground mb-3 ml-9">{t('upsell.packOptionalHint')}</p>

      {/* Pack cards */}
      <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-hide">
        {packs.map((pack, i) => {
          const isSelected = selectedPackId === pack.id;
          const saving = Math.round((1 - pack.pack_price / pack.original_price) * 100);

          return (
            <motion.div
              key={pack.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className="flex-shrink-0"
            >
              <Card
                onClick={() => onSelect(isSelected ? null : pack)}
                className={`w-40 sm:w-48 p-3.5 cursor-pointer transition-all duration-200 border-2 ${
                  isSelected
                    ? 'border-amber-400 bg-amber-500/10 shadow-lg shadow-amber-500/10'
                    : 'border-border/30 hover:border-amber-500/30 hover:bg-amber-500/[0.03]'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <Badge className="text-[10px] bg-primary/15 text-primary border-0 font-bold px-2">
                    -{saving}%
                  </Badge>
                  {isSelected && (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="w-5 h-5 rounded-full bg-amber-400 flex items-center justify-center"
                    >
                      <Check className="h-3 w-3 text-black" />
                    </motion.div>
                  )}
                </div>
                <h4 className="font-bold text-sm mb-0.5">{pack.name}</h4>
                <p className="text-xs text-muted-foreground mb-2">
                  {pack.drink_count} {t('upsell.drinksIncluded')}
                </p>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-lg font-bold text-amber-400">{pack.pack_price}€</span>
                  <span className="text-xs line-through text-muted-foreground">{pack.original_price}€</span>
                </div>
                {pack.description && (
                  <p className="text-[10px] text-muted-foreground mt-1.5">{pack.description}</p>
                )}
              </Card>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}
