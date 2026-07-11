import { useRef } from 'react';
import { motion } from 'framer-motion';
import { Plus, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Drink } from '@/types';
import { useLanguage } from '@/contexts/LanguageContext';
import { getOptimizedImageUrl } from '@/lib/imageOptimization';
import { FavoriteButton } from '@/components/FavoriteButton';
import { getTranslatedDrinkName } from '@/lib/drinkTranslations';

interface DrinkCardProps {
  drink: Drink;
  onAdd: (drink: Drink) => void;
  isFavorite?: boolean;
  variant?: 'compact' | 'standard' | 'mini';
}

const COMPACT_COLLECTIONS = ['shots', 'soft', 'beers', 'wines'];

/**
 * Gate central « Épuisé » : couvre les trois variantes (mini/compact/standard)
 * sans toucher leur rendu. Le produit reste visible, grisé, non cliquable.
 */
export function DrinkCard(props: DrinkCardProps) {
  const { t } = useLanguage();
  if (!props.drink.outOfStock) return <DrinkCardInner {...props} />;
  return (
    <div className="relative pointer-events-none opacity-50 grayscale">
      <DrinkCardInner {...props} onAdd={() => {}} />
      <div className="absolute inset-0 z-10 flex items-center justify-center">
        <span
          style={{
            background: 'rgba(0,0,0,0.75)',
            border: '1px solid rgba(255,255,255,0.2)',
            color: '#FFFFFF',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            padding: '4px 10px',
            borderRadius: 999,
          }}
        >
          {t('drink.outOfStock')}
        </span>
      </div>
    </div>
  );
}

function DrinkCardInner({ drink, onAdd, isFavorite: isFavoriteProp, variant }: DrinkCardProps) {
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const cardVariant = variant ?? (COMPACT_COLLECTIONS.includes(drink.collection?.toLowerCase() || '') ? 'compact' : 'standard');
  const isMini = cardVariant === 'mini';
  const isCompact = cardVariant === 'compact' || isMini;
  const { t, language } = useLanguage();
  
  const translatedName = getTranslatedDrinkName(drink.name, language);
  const hasPresale = drink.presaleActive && drink.presalePrice && drink.presalePrice < drink.price;

  const handlePointerDown = (e: React.PointerEvent) => {
    touchStart.current = { x: e.clientX, y: e.clientY };
  };

  const handleCardClick = (e: React.MouseEvent) => {
    if (!touchStart.current) { onAdd(drink); return; }
    const dx = Math.abs(e.clientX - touchStart.current.x);
    const dy = Math.abs(e.clientY - touchStart.current.y);
    touchStart.current = null;
    if (dx < 10 && dy < 10) onAdd(drink);
  };

  const renderPrice = () => {
    if (hasPresale) {
      return (
        <>
          <span className="text-[10px] text-muted-foreground line-through">{drink.price.toFixed(2)}€</span>
          <span className={`${isMini ? 'text-xs' : 'text-sm'} font-bold text-primary`}>{drink.presalePrice!.toFixed(2)}€</span>
        </>
      );
    }
    if (drink.promoPrice) {
      return (
        <>
          <span className="text-[10px] text-muted-foreground line-through">{drink.price.toFixed(2)}€</span>
          <span className={`${isMini ? 'text-xs' : 'text-sm'} font-bold text-primary`}>{drink.promoPrice.toFixed(2)}€</span>
        </>
      );
    }
    return <span className={`${isMini ? 'text-xs' : 'text-sm'} font-bold text-foreground`}>{drink.price.toFixed(2)}€</span>;
  };

  // ===== MINI VARIANT — Yuno DA =====
  if (isMini) {
    const effectivePrice = hasPresale ? drink.presalePrice! : drink.promoPrice ?? drink.price;
    const hasDiscount = hasPresale || !!drink.promoPrice;

    return (
      <motion.div
        whileTap={{ scale: 0.96 }}
        transition={{ duration: 0.12 }}
        onPointerDown={handlePointerDown}
        onClick={handleCardClick}
        className="cursor-pointer flex-shrink-0"
        style={{ width: 118 }}
      >
        <div
          style={{
            border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: 3,
            background: '#111111',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          {/* Image */}
          <div style={{ position: 'relative', aspectRatio: '1/1', background: '#0A0A0A' }}>
            <img
              src={getOptimizedImageUrl(drink.imgUrl, { width: 160, height: 160, quality: 70, resize: 'contain' })}
              alt={translatedName}
              className="absolute inset-0 w-full h-full object-contain"
              loading="lazy"
              decoding="async"
            />
            <FavoriteButton
              type="drink"
              id={drink.id}
              className="absolute top-1 right-1 h-5 w-5 border-0 bg-transparent shadow-none opacity-60 hover:opacity-100 transition-opacity p-0"
              size="icon"
              iconClassName="h-3 w-3"
            />
            {hasPresale && (
              <div
                className="absolute top-1.5 left-1.5"
                style={{
                  background: '#E8192C',
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: '7px',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  color: '#FFFFFF',
                  padding: '2px 5px',
                  borderRadius: 2,
                }}
              >
                {t('drink.presale')}
              </div>
            )}
          </div>

          {/* Divider */}
          <div style={{ height: '1px', background: 'rgba(255,255,255,0.05)' }} />

          {/* Content */}
          <div style={{ padding: '7px 8px 9px' }}>
            <p
              className="font-display font-bold truncate"
              style={{
                fontSize: '10px',
                color: '#FFFFFF',
                textTransform: 'uppercase',
                letterSpacing: '0.01em',
                lineHeight: 1.2,
                marginBottom: 6,
              }}
            >
              {translatedName}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              {/* Price */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {hasDiscount && (
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '9px', color: '#5A5A5E', textDecoration: 'line-through', lineHeight: 1.2 }}>
                    {drink.price.toFixed(2)}€
                  </span>
                )}
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', fontWeight: 700, color: hasDiscount ? '#E8192C' : '#FFFFFF', lineHeight: 1 }}>
                  {effectivePrice.toFixed(2)}€
                </span>
              </div>

              {/* Add button */}
              <button
                onClick={(e) => { e.stopPropagation(); onAdd(drink); }}
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  border: '1px solid rgba(255,255,255,0.16)',
                  background: 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  cursor: 'pointer',
                }}
              >
                <Plus style={{ width: 10, height: 10, color: 'rgba(255,255,255,0.7)' }} />
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    );
  }

  // ===== STANDARD / COMPACT VARIANT =====
  return (
    <motion.div
      whileTap={{ scale: 0.98 }}
      transition={{ duration: 0.2 }}
      onPointerDown={handlePointerDown}
      onClick={handleCardClick}
      className="cursor-pointer"
    >
      <Card className="overflow-hidden border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm relative group transition-all duration-200 rounded-2xl hover:border-white/[0.12] active:border-primary/40">
        {/* Favorite indicator */}
        {isFavoriteProp && (
          <div className="absolute top-2 left-2 z-10">
            <Badge variant="secondary" className="bg-black/70 backdrop-blur-sm text-primary border border-primary/30 text-[11px] px-1.5 py-0.5 flex items-center gap-0.5">
              <Star className="h-2.5 w-2.5 fill-primary" />
              {t('favorites.yourTaste')}
            </Badge>
          </div>
        )}

        {/* Image — square with contain */}
        <div className="aspect-square overflow-hidden relative rounded-t-2xl bg-black/40">
          <img
            src={getOptimizedImageUrl(drink.imgUrl, { width: 300, height: 300, quality: 75, resize: 'contain' })}
            alt={translatedName}
            width={300}
            height={300}
            className="h-full w-full object-contain transition-transform duration-300 hover:scale-105"
            loading="lazy"
            decoding="async"
          />
          <FavoriteButton 
            type="drink" 
            id={drink.id} 
            className="absolute top-2 right-2 h-7 w-7 bg-background/60 backdrop-blur-sm hover:bg-background/80 opacity-80 hover:opacity-100 transition-opacity"
            size="icon"
          />
          {hasPresale && (
            <Badge className="absolute bottom-2 right-2 bg-primary text-primary-foreground text-[10px]">
              {t('drink.presale')}
            </Badge>
          )}
        </div>

        {/* Content */}
        <div className="p-3">
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <h3 className={`text-sm font-semibold leading-tight flex-1 min-w-0 ${isCompact ? 'line-clamp-1' : 'line-clamp-2'}`}>
              {translatedName}
            </h3>
            <div className="flex flex-col items-end flex-shrink-0">
              {renderPrice()}
            </div>
          </div>

          <p className="text-xs text-muted-foreground mb-2.5">
            {drink.alcPct ? `${drink.alcPct}% vol` : '\u00A0'}
          </p>

          <Button
            onClick={(e) => { e.stopPropagation(); onAdd(drink); }}
            variant="ghost"
            className="h-7 w-full rounded-full text-muted-foreground text-xs font-medium hover:bg-white/[0.06] hover:text-foreground transition-all"
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t('drink.add')}
          </Button>
        </div>
      </Card>
    </motion.div>
  );
}