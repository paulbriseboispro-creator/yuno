import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Sparkles, ArrowDown, X, Wine, ChevronDown, ChevronUp, ArrowRight } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { TableZone, TablePack } from '@/types/ticketing';

/** Table du plan cliquée hors du périmètre courant (autre zone ou autre formule). */
export type UpsellTargetTable = {
  id: string;
  name: string;
  zoneId?: string;
  zoneName?: string;
  zoneColor?: string;
  packId?: string;
  capacity?: number;
  maxExtraPersons?: number;
};

interface ZoneUpsellSheetProps {
  open: boolean;
  onClose: () => void;
  currentZoneId: string;
  currentPackPrice: number;
  currentPackName?: string;
  currentPackId?: string;
  zones: TableZone[];
  packsByZone: Record<string, TablePack[]>;
  guestCount: number;
  onSelectZone: (zoneId: string, packId: string) => void;
  /**
   * Mode « table ciblée » : la feuille ne parle que de cette table et demande
   * une confirmation avant de basculer le checkout sur sa zone / sa formule.
   */
  targetTable?: UpsellTargetTable | null;
  onSelectTable?: (tableId: string, zoneId: string, packId: string) => void;
}

export function ZoneUpsellSheet({
  open,
  onClose,
  currentZoneId,
  currentPackPrice,
  currentPackName,
  currentPackId,
  zones,
  packsByZone,
  guestCount,
  onSelectZone,
  targetTable,
  onSelectTable,
}: ZoneUpsellSheetProps) {
  const { t } = useLanguage();
  const [expandedZone, setExpandedZone] = useState<string | null>(null);
  const [showAllZones, setShowAllZones] = useState(false);
  const [pickedPackId, setPickedPackId] = useState<string | null>(null);
  const focusedTable = targetTable && !showAllZones ? targetTable : null;
  const persWord = t('vip.pers') || 'pers.';
  const fmtDiff = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(Math.round(n))}€`;

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

  const allPacks = Object.values(packsByZone).flat();
  const packFits = (pack: TablePack) => guestCount <= pack.baseCapacity + pack.maxExtraPersons;

  // Formules candidates pour la table ciblée : la formule fixée si elle en a
  // une, sinon les formules actives de sa zone (les plus petites d'abord).
  const targetZone = focusedTable ? zones.find((z) => z.id === focusedTable.zoneId) : undefined;
  const boundPack = focusedTable?.packId ? allPacks.find((p) => p.id === focusedTable.packId) : undefined;
  const candidatePacks: TablePack[] = focusedTable
    ? boundPack
      ? [boundPack]
      : getActivePacks(focusedTable.zoneId || boundPack?.zoneId || '')
    : [];
  const targetZoneId = focusedTable?.zoneId || boundPack?.zoneId || '';
  const targetZoneName = targetZone?.name || focusedTable?.zoneName || '';
  const targetZoneColor = targetZone?.color || focusedTable?.zoneColor || '#E8192C';
  const activePack: TablePack | undefined =
    candidatePacks.length === 1
      ? candidatePacks[0]
      : candidatePacks.find((p) => p.id === pickedPackId) || (candidatePacks.filter(packFits).length === 1 ? candidatePacks.find(packFits) : undefined);
  const activeDiff = activePack ? getPackPrice(activePack) - currentPackPrice : 0;
  const activeIsUpgrade = activeDiff > 0;
  const activeIsDowngrade = activeDiff < 0;
  const canConfirm = !!activePack && packFits(activePack) && !!onSelectTable;

  const handleClose = () => {
    setShowAllZones(false);
    setPickedPackId(null);
    onClose();
  };

  const confirmTable = () => {
    if (!focusedTable || !activePack || !onSelectTable) return;
    onSelectTable(focusedTable.id, activePack.zoneId || targetZoneId, activePack.id);
    setShowAllZones(false);
    setPickedPackId(null);
  };

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
            onClick={handleClose}
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
              {focusedTable ? (
                <>
                  {/* Header — table ciblée */}
                  <div className="flex items-start justify-between gap-3 mb-5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 font-mono uppercase" style={{ fontSize: '9px', letterSpacing: '0.08em', color: '#9A9A9A' }}>
                        <span>{focusedTable.name}</span>
                        {targetZoneName && (
                          <>
                            <span className="text-[#6A6A6A]">·</span>
                            <span className="inline-flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full" style={{ background: targetZoneColor }} />
                              {targetZoneName}
                            </span>
                          </>
                        )}
                      </div>
                      <h3 className="font-display font-bold uppercase text-white mt-1" style={{ fontSize: '22px', letterSpacing: '-0.01em', lineHeight: 1 }}>
                        {boundPack
                          ? (t('vipCheckout.switchPackTitle') || 'Changer de formule ?')
                          : (t('vipCheckout.upsellTitle') || 'Changer de zone ?')}
                      </h3>
                      <p className="text-[12px] text-[#9A9A9A] mt-2 leading-relaxed">
                        {boundPack
                          ? (t('vipCheckout.upsellPackDesc') || 'La table {table} se réserve avec la formule {pack}.').replace('{table}', focusedTable.name).replace('{pack}', boundPack.name)
                          : (t('vipCheckout.upsellDesc') || 'La table {table} est dans la zone {zone}.').replace('{table}', focusedTable.name).replace('{zone}', targetZoneName)}
                      </p>
                    </div>
                    <button
                      onClick={handleClose}
                      aria-label={t('common.close') || 'Fermer'}
                      className="h-8 w-8 shrink-0 rounded-full bg-white/[0.06] hover:bg-white/[0.10] flex items-center justify-center transition-colors"
                    >
                      <X className="h-4 w-4 text-white" />
                    </button>
                  </div>

                  {/* Actuel → nouveau */}
                  <div className="flex items-center gap-2 mb-3 font-mono uppercase" style={{ fontSize: '9px', letterSpacing: '0.06em' }}>
                    <span className="text-[#9A9A9A]">{t('vipCheckout.currentPack') || 'Actuellement'}</span>
                    <span className="text-[#E5E5E5] truncate min-w-0">{currentPackName}</span>
                    <span className="text-white font-bold shrink-0">{Math.round(currentPackPrice)}€</span>
                    <ArrowRight className="h-3 w-3 text-[#6A6A6A] shrink-0" />
                    {activePack ? (
                      <span
                        className={`inline-flex items-center gap-0.5 font-bold px-2 py-0.5 rounded-full shrink-0 ${
                          activeIsUpgrade ? 'bg-amber-500/15 text-amber-400' : activeIsDowngrade ? 'bg-emerald-500/15 text-emerald-400' : 'bg-white/[0.06] text-[#E5E5E5]'
                        }`}
                      >
                        {activeIsUpgrade && <Sparkles className="h-3 w-3" />}
                        {activeIsDowngrade && <ArrowDown className="h-3 w-3" />}
                        {activeDiff === 0 ? (t('vipCheckout.samePrice') || 'Même prix') : fmtDiff(activeDiff)}
                      </span>
                    ) : (
                      <span className="text-[#9A9A9A]">{t('vipCheckout.upsellPickPack') || 'Choisissez la formule de cette table'}</span>
                    )}
                  </div>

                  {/* Formule(s) de la table */}
                  <div className="space-y-2">
                    {candidatePacks.map((pack) => {
                      const packPrice = getPackPrice(pack);
                      const packDiff = packPrice - currentPackPrice;
                      const fits = packFits(pack);
                      const isActive = activePack?.id === pack.id;
                      const selectable = candidatePacks.length > 1;
                      return (
                        <div
                          key={pack.id}
                          role={selectable ? 'radio' : undefined}
                          aria-checked={selectable ? isActive : undefined}
                          aria-disabled={!fits || undefined}
                          tabIndex={selectable && fits ? 0 : undefined}
                          onClick={selectable && fits ? () => setPickedPackId(pack.id) : undefined}
                          onKeyDown={selectable && fits ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPickedPackId(pack.id); } } : undefined}
                          className={`flex items-start gap-3 p-4 border transition-colors ${selectable && fits ? 'cursor-pointer' : ''} ${!fits ? 'opacity-50' : ''}`}
                          style={isActive
                            ? { borderColor: 'rgba(232,25,44,0.55)', background: 'rgba(232,25,44,0.06)', borderRadius: 12 }
                            : { borderColor: 'rgba(255,255,255,0.08)', background: '#141414', borderRadius: 12 }}
                        >
                          {selectable && (
                            <span
                              className="mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 flex items-center justify-center"
                              style={{ borderColor: isActive ? '#E8192C' : 'rgba(255,255,255,0.25)' }}
                            >
                              {isActive && <span className="h-2 w-2 rounded-full" style={{ background: '#E8192C' }} />}
                            </span>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="font-display font-bold uppercase text-white truncate" style={{ fontSize: '14px', letterSpacing: '-0.005em' }}>{pack.name}</p>
                            <p className="font-mono uppercase mt-1" style={{ fontSize: '9px', letterSpacing: '0.04em', color: fits ? '#9A9A9A' : '#f59e0b' }}>
                              {fits
                                ? <>{pack.baseCapacity} {persWord}{pack.maxExtraPersons > 0 && ` · +${pack.maxExtraPersons} max`}</>
                                : (t('vipCheckout.packTooSmallFor') || 'Trop petite pour {n} pers.').replace('{n}', String(guestCount))}
                            </p>
                            {pack.includedItems && (
                              <div className="flex items-start gap-1.5 mt-2">
                                <Wine className="h-3 w-3 text-[#5A5A5E] mt-0.5 shrink-0" />
                                <p className="text-[11px] text-[#9A9A9A] leading-relaxed line-clamp-3">{pack.includedItems}</p>
                              </div>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <span className="font-mono font-bold text-white" style={{ fontSize: '15px' }}>{Math.round(packPrice)}€</span>
                            {guestCount > pack.baseCapacity && (
                              <span className="font-mono" style={{ fontSize: '9px', letterSpacing: '0.04em', color: '#9A9A9A' }}>
                                {guestCount} {persWord}
                              </span>
                            )}
                            {packDiff !== 0 && (
                              <span className={`font-mono text-[10px] font-bold ${packDiff > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>{fmtDiff(packDiff)}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {candidatePacks.length === 0 && (
                      <p className="text-[12px] text-[#9A9A9A] py-4 text-center">{t('vipCheckout.noPackForTable') || 'Aucune formule disponible pour cette table.'}</p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="mt-5 space-y-2">
                    <button
                      onClick={confirmTable}
                      disabled={!canConfirm}
                      className="w-full h-12 rounded-full flex items-center justify-center gap-2 font-mono uppercase text-[11px] font-bold tracking-[0.10em] transition-all active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100"
                      style={activeIsUpgrade
                        ? { background: '#FBBF24', color: '#0A0A0A', boxShadow: '0 10px 28px rgba(251,191,36,0.28)' }
                        : { background: '#E8192C', color: '#FFFFFF', boxShadow: '0 10px 28px rgba(232,25,44,0.32)' }}
                    >
                      {activeIsUpgrade && <Sparkles className="h-4 w-4" />}
                      {t('vipCheckout.upsellConfirm') || 'Sélectionner cette table'}
                      {activePack && <span className="opacity-80">· {Math.round(getPackPrice(activePack))}€</span>}
                    </button>
                    <button
                      onClick={handleClose}
                      className="w-full h-11 rounded-full flex items-center justify-center font-mono uppercase text-[10px] font-bold tracking-[0.10em] text-[#E5E5E5] bg-white/[0.06] hover:bg-white/[0.10] transition-colors"
                    >
                      {t('vipCheckout.keepCurrent') || 'Garder ma sélection'}
                    </button>
                    {zones.length > 1 && (
                      <button
                        onClick={() => setShowAllZones(true)}
                        className="w-full h-9 flex items-center justify-center font-mono uppercase text-[9px] tracking-[0.10em] text-[#9A9A9A] hover:text-white transition-colors"
                      >
                        {t('vipCheckout.seeAllZones') || 'Voir toutes les zones'}
                      </button>
                    )}
                  </div>
                </>
              ) : (
              <>
              {/* Header */}
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="font-display font-bold uppercase text-white" style={{ fontSize: '20px', letterSpacing: '-0.01em' }}>{t('vipCheckout.changeZone') || 'Changer de zone'}</h3>
                  <p className="font-mono uppercase mt-1" style={{ fontSize: '10px', letterSpacing: '0.06em', color: '#9A9A9A' }}>
                    {guestCount} {persWord}
                  </p>
                </div>
                <button
                  onClick={handleClose}
                  aria-label={t('common.close') || 'Fermer'}
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
                          {hasMultiplePacks && (
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
                        {hasMultiplePacks && expandedZone === zone.id && (
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
                                const isCurrentPack = isCurrent && !!currentPackId && pack.id === currentPackId;

                                return (
                                  <div
                                    key={pack.id}
                                    role={isCurrentPack ? undefined : 'button'}
                                    tabIndex={isCurrentPack ? undefined : 0}
                                    className={`flex items-center justify-between border px-3 py-2.5 transition-all ${isCurrentPack ? 'bg-white/[0.02] border-white/[0.04]' : 'bg-white/[0.03] border-white/[0.06] cursor-pointer hover:bg-white/[0.06] active:scale-[0.98]'}`}
                                    style={{ borderRadius: 8 }}
                                    onClick={isCurrentPack ? undefined : () => onSelectZone(zone.id, pack.id)}
                                    onKeyDown={isCurrentPack ? undefined : (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectZone(zone.id, pack.id); } }}
                                  >
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2 min-w-0">
                                        <p className="text-sm font-bold truncate text-white">{pack.name}</p>
                                        {isCurrentPack && (
                                          <span className="font-mono uppercase inline-flex items-center text-[9px] font-bold tracking-[0.10em] text-primary px-1.5 py-0.5 rounded-full shrink-0" style={{ background: 'rgba(232,25,44,0.10)' }}>
                                            <Check className="h-2.5 w-2.5 mr-0.5" />
                                            {t('vipCheckout.currentZone') || 'Actuel'}
                                          </span>
                                        )}
                                      </div>
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
                      {!hasMultiplePacks && activePacks[0]?.includedItems && (
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
              </>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
