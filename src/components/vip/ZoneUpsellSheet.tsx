import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Sparkles, ArrowDown, X, Wine, ChevronDown, ChevronUp } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { TableZone, TablePack } from '@/types/ticketing';

interface ZoneUpsellSheetProps {
  open: boolean;
  onClose: () => void;
  currentZoneId: string;
  currentPackPrice: number;
  zones: TableZone[];
  packsByZone: Record<string, TablePack[]>;
  guestCount: number;
  onSelectZone: (zoneId: string, packId: string) => void;
}

export function ZoneUpsellSheet({
  open,
  onClose,
  currentZoneId,
  currentPackPrice,
  zones,
  packsByZone,
  guestCount,
  onSelectZone,
}: ZoneUpsellSheetProps) {
  const { t } = useLanguage();
  const [expandedZone, setExpandedZone] = useState<string | null>(null);

  const getActivePacks = (zoneId: string): TablePack[] => {
    return (packsByZone[zoneId] || [])
      .filter(p => p.isActive)
      .sort((a, b) => a.basePrice - b.basePrice);
  };

  const getPackPrice = (pack: TablePack) => {
    const baseGuests = pack.baseCapacity;
    const extraGuests = Math.max(0, Math.min(guestCount - baseGuests, pack.maxExtraPersons));
    return pack.basePrice + (extraGuests * pack.extraPersonPrice);
  };

  const getCheapestPrice = (zoneId: string): number => {
    const packs = getActivePacks(zoneId);
    if (packs.length === 0) return 0;
    return Math.min(...packs.map(p => getPackPrice(p)));
  };

  const sortedZones = [...zones].sort((a, b) => {
    return getCheapestPrice(a.id) - getCheapestPrice(b.id);
  });

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />
          {/* Sheet */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-3xl border-t border-white/[0.08] bg-[#0A0A0A]"
          >
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="h-1 w-10 rounded-full bg-white/15" />
            </div>

            <div className="px-5 pb-8">
              {/* Header */}
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="font-display font-bold uppercase text-white" style={{ fontSize: '20px', letterSpacing: '-0.01em' }}>{t('vipCheckout.changeZone') || 'Changer de zone'}</h3>
                  <p className="font-mono uppercase mt-1" style={{ fontSize: '10px', letterSpacing: '0.06em', color: '#9A9A9A' }}>
                    {guestCount} {guestCount === 1 ? 'personne' : 'personnes'}
                  </p>
                </div>
                <button
                  onClick={onClose}
                  className="h-8 w-8 rounded-full bg-white/[0.06] hover:bg-white/[0.10] flex items-center justify-center transition-colors"
                >
                  <X className="h-4 w-4 text-white" />
                </button>
              </div>

              {/* Zone cards */}
              <div className="space-y-3">
                {sortedZones.map((zone) => {
                  const activePacks = getActivePacks(zone.id);
                  if (activePacks.length === 0) return null;

                  const isCurrent = zone.id === currentZoneId;
                  const cheapestPrice = getCheapestPrice(zone.id);
                  const priceDiff = cheapestPrice - currentPackPrice;
                  const isUpgrade = priceDiff > 0;
                  const isDowngrade = priceDiff < 0;
                  const hasMultiplePacks = activePacks.length > 1;
                  const isExpanded = expandedZone === zone.id || (!hasMultiplePacks && !isCurrent);

                  return (
                    <motion.div
                      key={zone.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-4 border transition-all"
                      style={isCurrent
                        ? { borderColor: 'rgba(232,25,44,0.55)', background: 'rgba(232,25,44,0.05)', borderRadius: 10 }
                        : { borderColor: 'rgba(255,255,255,0.08)', background: '#141414', borderRadius: 10 }}
                    >
                      {/* Zone header */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <div
                              className="h-3 w-3 rounded-full ring-2"
                              style={{ backgroundColor: zone.color, '--tw-ring-color': '#0A0A0A' } as React.CSSProperties}
                            />
                            <span className="font-display font-bold uppercase text-white" style={{ fontSize: '14px', letterSpacing: '-0.005em' }}>{zone.name}</span>
                            {isCurrent && (
                              <span className="font-mono uppercase inline-flex items-center text-[9px] font-bold tracking-[0.10em] text-primary px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(232,25,44,0.10)' }}>
                                <Check className="h-2.5 w-2.5 mr-0.5" />
                                {t('vipCheckout.currentZone') || 'Actuel'}
                              </span>
                            )}
                          </div>

                          {/* Price summary */}
                          <p className="font-mono uppercase mt-1" style={{ fontSize: '10px', letterSpacing: '0.04em', color: '#9A9A9A' }}>
                            {t('tables.from')} <span className="font-bold text-white">{activePacks[0].basePrice}€</span>
                            {' '}/ {activePacks[0].baseCapacity} pers.
                          </p>
                        </div>

                        <div className="flex flex-col items-end gap-2 shrink-0">
                          {!isCurrent && priceDiff !== 0 && (
                            <span
                              className={`font-mono inline-flex items-center text-xs font-bold px-2 py-0.5 rounded-full ${
                                isUpgrade
                                  ? 'bg-amber-500/15 text-amber-400'
                                  : 'bg-emerald-500/15 text-emerald-400'
                              }`}
                            >
                              {isUpgrade && <Sparkles className="h-3 w-3 mr-0.5" />}
                              {isDowngrade && <ArrowDown className="h-3 w-3 mr-0.5" />}
                              {priceDiff > 0 ? '+' : ''}{priceDiff}€
                            </span>
                          )}
                          {/* If single pack and not current → direct select button */}
                          {!isCurrent && !hasMultiplePacks && (
                            <button
                              onClick={() => onSelectZone(zone.id, activePacks[0].id)}
                              className="font-mono uppercase text-[10px] font-bold tracking-[0.08em] h-8 px-3.5 rounded-full transition-all active:scale-[0.97]"
                              style={isUpgrade
                                ? { background: '#FBBF24', color: '#0A0A0A' }
                                : { background: 'transparent', color: '#E8192C', border: '1px solid #E8192C' }}
                            >
                              {isUpgrade
                                ? (t('vipCheckout.upgrade') || 'Upgrade')
                                : (t('vipCheckout.select') || 'Sélectionner')}
                            </button>
                          )}
                          {/* If multiple packs → expand/collapse toggle */}
                          {!isCurrent && hasMultiplePacks && (
                            <button
                              onClick={() => setExpandedZone(expandedZone === zone.id ? null : zone.id)}
                              className="font-mono uppercase text-[10px] font-bold tracking-[0.08em] h-8 px-3 rounded-full bg-white/[0.06] hover:bg-white/[0.10] text-[#E5E5E5] inline-flex items-center gap-1 transition-colors"
                            >
                              {activePacks.length} packs
                              {expandedZone === zone.id
                                ? <ChevronUp className="h-3 w-3" />
                                : <ChevronDown className="h-3 w-3" />}
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Expanded packs list */}
                      <AnimatePresence>
                        {!isCurrent && hasMultiplePacks && expandedZone === zone.id && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                          >
                            <div className="mt-3 space-y-2 border-t border-white/[0.06] pt-3">
                              {activePacks.map((pack) => {
                                const packPrice = getPackPrice(pack);
                                const packDiff = packPrice - currentPackPrice;

                                return (
                                  <div
                                    key={pack.id}
                                    className="flex items-center justify-between bg-white/[0.03] border border-white/[0.06] px-3 py-2.5 cursor-pointer hover:bg-white/[0.06] active:scale-[0.98] transition-all"
                                    style={{ borderRadius: 8 }}
                                    onClick={() => onSelectZone(zone.id, pack.id)}
                                  >
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-bold truncate text-white">{pack.name}</p>
                                      <div className="flex items-center gap-2 mt-0.5">
                                        <span className="font-mono uppercase" style={{ fontSize: '9px', letterSpacing: '0.04em', color: '#9A9A9A' }}>
                                          {pack.baseCapacity} pers.
                                          {pack.maxExtraPersons > 0 && ` · +${pack.maxExtraPersons} max`}
                                        </span>
                                      </div>
                                      {pack.includedItems && (
                                        <div className="flex items-start gap-1 mt-1">
                                          <Wine className="h-3 w-3 text-[#5A5A5E] mt-0.5 shrink-0" />
                                          <p className="text-[11px] text-[#9A9A9A] leading-relaxed line-clamp-2">
                                            {pack.includedItems}
                                          </p>
                                        </div>
                                      )}
                                    </div>
                                    <div className="flex flex-col items-end gap-1 shrink-0 ml-3">
                                      <span className="font-mono text-sm font-bold text-white">{packPrice}€</span>
                                      {packDiff !== 0 && (
                                        <span className={`font-mono text-[10px] font-medium ${packDiff > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                                          {packDiff > 0 ? '+' : ''}{packDiff}€
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Single pack menu preview (when not expanded) */}
                      {(isCurrent || !hasMultiplePacks) && activePacks[0]?.includedItems && (
                        <div className="mt-2 flex items-start gap-1.5">
                          <Wine className="h-3 w-3 text-[#5A5A5E] mt-0.5 shrink-0" />
                          <p className="text-[11px] text-[#9A9A9A] leading-relaxed">
                            {activePacks[0].includedItems}
                          </p>
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
