// Mode Live — carte boisson à DOUBLE CTA : « Ajouter » (panier) ou « Payer »
// (checkout direct de cet article seul). Design premium calé sur le DS public
// (cartes #141414, accent rouge, mono). Cible tactile ≥ 44 px, feedback press.
import { memo } from 'react';
import { motion } from 'framer-motion';
import { Plus, Zap, Loader2 } from 'lucide-react';
import { getOptimizedImageUrl } from '@/lib/imageOptimization';
import { getTranslatedDrinkName } from '@/lib/drinkTranslations';
import { FavoriteButton } from '@/components/FavoriteButton';
import { useLanguage } from '@/contexts/LanguageContext';
import { Drink } from '@/types';
import { transitions } from '@/lib/motion';

interface Props {
  drink: Drink;
  isFavorite?: boolean;
  paying?: boolean;
  onAdd: (drink: Drink) => void;
  onPay: (drink: Drink) => void;
}

function priceOf(drink: Drink): { price: number; original?: number } {
  if (drink.presaleActive && drink.presalePrice) {
    return { price: drink.presalePrice, original: drink.price };
  }
  if (drink.promoPrice) return { price: drink.promoPrice, original: drink.price };
  return { price: drink.price };
}

function LiveDrinkCardBase({ drink, isFavorite, paying, onAdd, onPay }: Props) {
  const { language, t } = useLanguage();
  const name = getTranslatedDrinkName(drink.name, language);
  const { price, original } = priceOf(drink);
  const isOut = !!drink.outOfStock;

  return (
    <div
      className={`flex flex-col overflow-hidden ${isOut ? 'pointer-events-none opacity-50 grayscale relative' : ''}`}
      style={{
        background: '#141414',
        // Favori : liseré rouge discret (renforce « en tête = ton goût »).
        border: isFavorite ? '1px solid rgba(232,25,44,0.45)' : '1px solid rgba(255,255,255,0.08)',
        borderRadius: 10,
      }}
    >
      {/* Visuel — carré, object-contain (jamais crop) */}
      <div
        className="relative w-full"
        style={{ aspectRatio: '1 / 1', background: 'linear-gradient(180deg, rgba(255,255,255,0.05), rgba(0,0,0,0.4))' }}
      >
        <img
          src={getOptimizedImageUrl(drink.imgUrl, { width: 300, height: 300, quality: 75, resize: 'contain' })}
          alt={name}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-contain p-2.5 drop-shadow-[0_6px_14px_rgba(0,0,0,0.5)]"
        />
        {/* Promo en haut à gauche */}
        {original && original > price && (
          <span
            className="absolute left-2 top-2 rounded px-1.5 py-0.5 font-mono font-bold uppercase"
            style={{ fontSize: 8, letterSpacing: '0.06em', color: '#fff', background: '#E8192C' }}
          >
            -{Math.round((1 - price / original) * 100)}%
          </span>
        )}
        {/* Bouton favori en haut à droite (toggle cœur, cible 40 px) */}
        <FavoriteButton
          type="drink"
          id={drink.id}
          size="icon"
          className="absolute right-1.5 top-1.5 h-10 w-10 rounded-full bg-black/50 backdrop-blur-sm hover:bg-black/70"
          iconClassName="h-4 w-4"
        />
        {isOut && (
          <span
            className="absolute inset-x-0 bottom-2 mx-auto w-fit rounded-full px-2.5 py-1 font-bold uppercase"
            style={{ fontSize: 9, letterSpacing: '0.08em', color: '#fff', background: 'rgba(0,0,0,0.75)', border: '1px solid rgba(255,255,255,0.2)' }}
          >
            {t('drink.outOfStock')}
          </span>
        )}
      </div>

      {/* Nom + prix */}
      <div className="flex flex-1 flex-col px-3 pt-2.5">
        <h3
          className="font-display font-bold uppercase leading-tight text-white line-clamp-2"
          style={{ fontSize: 12.5, letterSpacing: '-0.005em' }}
        >
          {name}
        </h3>
        <div className="mt-1 flex items-baseline gap-1.5">
          <span className="font-mono font-bold text-white" style={{ fontSize: 14 }}>
            {price.toFixed(2)}€
          </span>
          {original && original > price && (
            <span className="font-mono line-through" style={{ fontSize: 10, color: '#5A5A5E' }}>
              {original.toFixed(2)}€
            </span>
          )}
        </div>
      </div>

      {/* Double CTA — cibles ≥ 44 px, 8 px de gap */}
      <div className="mt-2.5 grid grid-cols-[1fr_auto] gap-1.5 p-2.5 pt-0">
        <motion.button
          type="button"
          onClick={() => onAdd(drink)}
          disabled={paying}
          whileTap={{ scale: 0.97 }}
          transition={transitions.pressFeedback}
          className="flex min-h-[44px] items-center justify-center gap-1.5 rounded font-mono font-bold uppercase outline-none disabled:opacity-40"
          style={{
            fontSize: 10.5,
            letterSpacing: '0.06em',
            color: '#fff',
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.12)',
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          {t('live.addToCart')}
        </motion.button>
        <motion.button
          type="button"
          onClick={() => onPay(drink)}
          disabled={paying}
          whileTap={{ scale: 0.97 }}
          transition={transitions.pressFeedback}
          aria-label={t('live.payNow')}
          className="flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded px-3 font-mono font-bold uppercase text-white outline-none disabled:opacity-60"
          style={{
            fontSize: 10.5,
            letterSpacing: '0.06em',
            background: '#E8192C',
            boxShadow: '0 4px 14px rgba(232,25,44,0.3)',
          }}
        >
          {paying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
          {!paying && t('live.payNow')}
        </motion.button>
      </div>
    </div>
  );
}

export const LiveDrinkCard = memo(LiveDrinkCardBase);
