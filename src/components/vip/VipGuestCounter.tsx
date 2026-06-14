import { motion, AnimatePresence } from 'framer-motion';
import { Minus, Plus, Users, AlertCircle } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

interface VipGuestCounterProps {
  count: number;
  onChange: (count: number) => void;
  baseCapacity: number;
  maxExtraPersons: number;
  extraPersonPrice: number;
  payAtClubMax?: number;
}

export function VipGuestCounter({
  count,
  onChange,
  baseCapacity,
  maxExtraPersons,
  extraPersonPrice,
  payAtClubMax = 5,
}: VipGuestCounterProps) {
  const { t } = useLanguage();

  const includedMax = baseCapacity + maxExtraPersons;
  const absoluteMax = includedMax + payAtClubMax;
  const extraGuests = Math.max(0, Math.min(count - baseCapacity, maxExtraPersons));
  const payAtClubGuests = Math.max(0, count - includedMax);

  const isInExtra = count > baseCapacity && count <= includedMax;
  const isInPayAtClub = count > includedMax;

  // Segmented bar
  const totalSegments = absoluteMax;
  const basePercent = (baseCapacity / totalSegments) * 100;
  const extraPercent = (maxExtraPersons / totalSegments) * 100;
  const filledPercent = (Math.min(count, totalSegments) / totalSegments) * 100;

  return (
    <div className="rounded-[10px] border border-white/[0.08] bg-[#141414] p-6">
      {/* Label */}
      <div className="flex items-center justify-center gap-2 mb-6">
        <Users className="h-3.5 w-3.5 text-[#5A5A5E]" />
        <span className="font-mono uppercase" style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.14em', color: '#5A5A5E' }}>
          {t('tableCheckout.guestCount')}
        </span>
      </div>

      {/* Counter */}
      <div className="flex items-center justify-center gap-8">
        {/* Minus button */}
        <motion.button
          type="button"
          whileTap={{ scale: 0.9 }}
          onClick={() => onChange(Math.max(1, count - 1))}
          disabled={count <= 1}
          className="h-14 w-14 rounded-full border border-white/[0.10] bg-white/[0.06] flex items-center justify-center text-white disabled:opacity-20 transition-all hover:bg-white/[0.12] active:scale-90"
        >
          <Minus className="h-5 w-5" />
        </motion.button>

        {/* Number */}
        <div className="relative w-24 text-center">
          <AnimatePresence mode="popLayout">
            <motion.span
              key={count}
              initial={{ y: 20, opacity: 0, scale: 0.8 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: -20, opacity: 0, scale: 0.8 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              className="font-display font-bold tabular-nums block"
              style={{ fontSize: '56px', letterSpacing: '-0.04em', lineHeight: 1, color: isInPayAtClub ? '#FBBF24' : '#FFFFFF' }}
            >
              {count}
            </motion.span>
          </AnimatePresence>
          <motion.p
            key={`label-${count}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="font-mono uppercase mt-1.5"
            style={{ fontSize: '9px', letterSpacing: '0.10em', color: '#5A5A5E' }}
          >
            {count === 1 ? 'personne' : 'personnes'}
          </motion.p>
        </div>

        {/* Plus button */}
        <motion.button
          type="button"
          whileTap={{ scale: 0.9 }}
          onClick={() => onChange(Math.min(absoluteMax, count + 1))}
          disabled={count >= absoluteMax}
          className="h-14 w-14 rounded-full flex items-center justify-center text-white disabled:opacity-20 transition-all active:scale-90"
          style={{ backgroundColor: count < absoluteMax ? 'rgba(232,25,44,0.80)' : 'rgba(255,255,255,0.06)' }}
        >
          <Plus className="h-5 w-5" />
        </motion.button>
      </div>

      {/* Segmented capacity bar */}
      <div className="mt-6 px-2">
        <div className="relative h-2 rounded-full bg-white/[0.06] overflow-hidden">
          {/* Base zone */}
          <div
            className="absolute inset-y-0 left-0 bg-primary/20 rounded-l-full"
            style={{ width: `${basePercent}%` }}
          />
          {/* Extra zone */}
          {maxExtraPersons > 0 && (
            <div
              className="absolute inset-y-0 bg-amber-500/15"
              style={{ left: `${basePercent}%`, width: `${extraPercent}%` }}
            />
          )}
          {/* Pay at club zone - dashed pattern via repeating gradient */}
          {payAtClubMax > 0 && (
            <div
              className="absolute inset-y-0 right-0 opacity-30"
              style={{
                left: `${basePercent + extraPercent}%`,
                background: 'repeating-linear-gradient(90deg, #FBBF24 0px, #FBBF24 4px, transparent 4px, transparent 8px)',
              }}
            />
          )}
          {/* Filled indicator */}
          <motion.div
            className={`absolute inset-y-0 left-0 rounded-full ${
              isInPayAtClub
                ? 'bg-amber-400'
                : isInExtra
                  ? 'bg-amber-500'
                  : 'bg-primary'
            }`}
            initial={false}
            animate={{ width: `${filledPercent}%` }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          />
        </div>
        {/* Labels */}
        <div className="flex justify-between mt-2 font-mono uppercase" style={{ fontSize: '9px', letterSpacing: '0.06em', color: '#5A5A5E' }}>
          <span>1</span>
          {maxExtraPersons > 0 && (
            <span style={{ position: 'relative', left: `${basePercent - 50}%` }}>
              {baseCapacity} inclus
            </span>
          )}
          <span>max {absoluteMax}</span>
        </div>
      </div>

      {/* Extra guests pill */}
      <AnimatePresence>
        {isInExtra && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-4 flex items-center justify-center"
          >
            <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 px-3 py-1.5">
              <span className="font-mono text-xs font-medium text-amber-400">
                +{extraGuests} extra · {extraGuests * extraPersonPrice}€
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pay at club banner */}
      <AnimatePresence>
        {isInPayAtClub && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-4"
          >
            {/* Show the charged extras first */}
            {maxExtraPersons > 0 && (
              <div className="flex items-center justify-center mb-2">
                <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 px-3 py-1.5">
                  <span className="font-mono text-xs font-medium text-amber-400">
                    +{maxExtraPersons} extra · {maxExtraPersons * extraPersonPrice}€
                  </span>
                </div>
              </div>
            )}
            {/* Pay at club info */}
            <div className="flex items-start gap-2.5 border border-dashed border-amber-500/30 bg-amber-500/5 px-4 py-3" style={{ borderRadius: 8 }}>
              <AlertCircle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-medium text-amber-400">
                  +{payAtClubGuests} {payAtClubGuests === 1 ? 'personne' : 'personnes'} supplémentaire{payAtClubGuests > 1 ? 's' : ''}
                </p>
                <p className="text-[11px] text-[#9A9A9A] mt-0.5">
                  {t('vipCheckout.extraGuestsAtClub') || 'Supplément à régler directement sur place'}
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
