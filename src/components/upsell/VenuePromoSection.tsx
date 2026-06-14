import { useRef } from 'react';
import { motion } from 'framer-motion';
import { useLanguage } from '@/contexts/LanguageContext';
import { getTranslatedDrinkName } from '@/lib/drinkTranslations';
import { Drink } from '@/types';

interface VenuePromoSectionProps {
  drinks: Drink[];
  onAdd: (drink: Drink) => void;
}

export function VenuePromoSection({ drinks, onAdd }: VenuePromoSectionProps) {
  const { t, language } = useLanguage();
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    touchStart.current = { x: e.clientX, y: e.clientY };
  };

  const handleClick = (e: React.MouseEvent, drink: Drink) => {
    if (!touchStart.current) { onAdd(drink); return; }
    const dx = Math.abs(e.clientX - touchStart.current.x);
    const dy = Math.abs(e.clientY - touchStart.current.y);
    touchStart.current = null;
    if (dx < 10 && dy < 10) onAdd(drink);
  };
  
  const promoDrinks = drinks.filter(d => d.promoPrice && d.promoPrice < d.price);
  
  if (promoDrinks.length === 0) return null;

  return (
    <div className="mb-8">
      {/* Section header — ruled */}
      <div
        className="flex items-center justify-between px-5"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '8px', marginBottom: '0' }}
      >
        <p className="font-mono uppercase" style={{ fontSize: '10px', letterSpacing: '0.14em', color: '#5A5A5E' }}>
          {t('upsell.promos')}
        </p>
        <span className="font-mono" style={{ fontSize: '10px', color: '#3A3A3E', letterSpacing: '0.08em' }}>
          {promoDrinks.length}
        </span>
      </div>

      <div className="flex gap-2.5 overflow-x-auto pb-2 px-5 pt-3 scrollbar-hide">
        {promoDrinks.map((drink, i) => {
          const saving = Math.round((1 - (drink.promoPrice || 0) / drink.price) * 100);
          return (
            <motion.div
              key={drink.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className="flex-shrink-0 cursor-pointer"
              style={{ width: 118 }}
              onPointerDown={handlePointerDown}
              onClick={(e) => handleClick(e, drink)}
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
                {/* Promo badge */}
                <div
                  className="absolute top-1.5 left-1.5 z-10"
                  style={{
                    background: '#E8192C',
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: '8px',
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    color: '#FFFFFF',
                    padding: '2px 5px',
                    borderRadius: 2,
                  }}
                >
                  -{saving}%
                </div>

                {/* Image */}
                <div style={{ position: 'relative', aspectRatio: '1/1', background: '#0A0A0A' }}>
                  <img
                    src={drink.imgUrl}
                    alt={getTranslatedDrinkName(drink.name, language)}
                    className="absolute inset-0 w-full h-full object-contain"
                  />
                </div>

                {/* Divider */}
                <div style={{ height: '1px', background: 'rgba(255,255,255,0.05)' }} />

                {/* Info */}
                <div style={{ padding: '7px 8px 9px' }}>
                  <p
                    className="font-display font-bold truncate"
                    style={{ fontSize: '10px', color: '#FFFFFF', textTransform: 'uppercase', letterSpacing: '0.01em', lineHeight: 1.2, marginBottom: 6 }}
                  >
                    {getTranslatedDrinkName(drink.name, language)}
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '9px', color: '#5A5A5E', textDecoration: 'line-through', lineHeight: 1.2 }}>
                      {drink.price.toFixed(2)}€
                    </span>
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', fontWeight: 700, color: '#E8192C', lineHeight: 1 }}>
                      {(drink.promoPrice || 0).toFixed(2)}€
                    </span>
                  </div>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
