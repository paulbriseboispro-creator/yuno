import { useState } from 'react';
import { motion } from 'framer-motion';
import { useLanguage } from '@/contexts/LanguageContext';
import { CheckCircle2, Wine, X, Clock } from 'lucide-react';

/* Palette éditoriale publique (cf. DESIGN_SYSTEM_PUBLIC.md) — mêmes hex que
   TemporalOrders pour que l'étape de sélection colle au QR boissons. */
const RED = '#E8192C';
const CARD = '#141414';
const CARD2 = '#1B1B1E';
const WHITE = '#FFFFFF';
const G1 = '#E5E5E5';
const G2 = '#9A9A9A';
const G3 = '#5A5A5E';
const BORDER = 'rgba(255,255,255,0.08)';
const BORDER_STRONG = 'rgba(255,255,255,0.14)';
const RED_TINT = 'rgba(232,25,44,0.06)';
const RED_SOFT = 'rgba(232,25,44,0.18)';

interface OrderItem {
  id?: string;
  drinkId?: string;
  name: string;
  qty: number;
  unitPrice: number;
  imgUrl?: string;
  served?: boolean;
  servedUnits?: boolean[];
  prepUnits?: boolean[];
}

interface DrinkSelectionStepProps {
  items: OrderItem[];
  onConfirm: (selectedIndices: number[]) => void;
  onClose: () => void;
  mode?: 'qr' | 'prep';
}

export function DrinkSelectionStep({ items, onConfirm, onClose, mode = 'qr' }: DrinkSelectionStepProps) {
  const { t } = useLanguage();

  // Build expanded items (one per unit) for index tracking
  const expandedItems: { originalIndex: number; subIndex: number; item: OrderItem; served: boolean; inPrep: boolean }[] = [];
  items.forEach((item, idx) => {
    for (let i = 0; i < item.qty; i++) {
      const isServed = Array.isArray(item.servedUnits)
        ? item.servedUnits[i] === true
        : item.served === true;
      const isInPrep = Array.isArray(item.prepUnits)
        ? item.prepUnits[i] === true
        : false;
      expandedItems.push({ originalIndex: idx, subIndex: i, item, served: isServed, inPrep: isInPrep });
    }
  });

  // Group by drink name for display
  type GroupedDrink = { name: string; imgUrl?: string; unitPrice: number; expandedIndices: number[]; servedCount: number; prepCount: number; totalCount: number };
  const grouped: GroupedDrink[] = [];
  expandedItems.forEach((entry, expandedIdx) => {
    const existing = grouped.find(g => g.name === entry.item.name);
    if (existing) {
      existing.expandedIndices.push(expandedIdx);
      existing.totalCount++;
      if (entry.served) existing.servedCount++;
      else if (entry.inPrep) existing.prepCount++;
    } else {
      grouped.push({
        name: entry.item.name,
        imgUrl: entry.item.imgUrl,
        unitPrice: entry.item.unitPrice,
        expandedIndices: [expandedIdx],
        servedCount: entry.served ? 1 : 0,
        prepCount: (!entry.served && entry.inPrep) ? 1 : 0,
        totalCount: 1,
      });
    }
  });

  // Selection count per group
  const [groupSelection, setGroupSelection] = useState<Record<number, number>>({});

  const toggleGroupUnit = (groupIdx: number, delta: number) => {
    const group = grouped[groupIdx];
    const available = group.totalCount - group.servedCount - group.prepCount;
    setGroupSelection(prev => {
      const current = prev[groupIdx] || 0;
      const next = Math.max(0, Math.min(available, current + delta));
      return { ...prev, [groupIdx]: next };
    });
  };

  // Convert group selection to expanded indices
  const getSelectedExpandedIndices = (): number[] => {
    const indices: number[] = [];
    grouped.forEach((group, gIdx) => {
      const count = groupSelection[gIdx] || 0;
      let added = 0;
      for (const eIdx of group.expandedIndices) {
        if (added >= count) break;
        if (!expandedItems[eIdx].served && !expandedItems[eIdx].inPrep) {
          indices.push(eIdx);
          added++;
        }
      }
    });
    return indices;
  };

  const selectedCount = Object.values(groupSelection).reduce((a, b) => a + b, 0);
  const servedCount = expandedItems.filter(e => e.served).length;
  const prepCount = expandedItems.filter(e => !e.served && e.inPrep).length;
  const totalCount = expandedItems.length;

  const handleConfirm = () => {
    onConfirm(getSelectedExpandedIndices());
  };

  const title = mode === 'prep' ? t('drinkSelection.prepTitle') : t('drinkSelection.title');
  const subtitle = mode === 'prep' ? t('drinkSelection.prepSubtitle') : t('drinkSelection.subtitle');
  const confirmText = mode === 'prep' ? t('drinkSelection.requestPrep') : t('drinkSelection.generateQR');

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-hidden"
      style={{ background: 'rgba(10,10,10,0.92)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.94, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden relative"
        style={{ background: CARD, border: `1px solid ${BORDER_STRONG}`, borderRadius: 12, boxShadow: '0 32px 70px -20px rgba(0,0,0,.95)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 grid place-items-center cursor-pointer"
          style={{ width: 32, height: 32, borderRadius: 2, background: CARD2, border: `1px solid ${BORDER_STRONG}`, color: '#fff' }}
        >
          <X style={{ width: 15, height: 15 }} strokeWidth={2} />
        </button>

        {/* Header */}
        <div className="px-5 pt-5 pb-3 text-center">
          <div className="flex items-center justify-center gap-2 mb-1.5">
            <Wine style={{ width: 18, height: 18, color: RED }} strokeWidth={1.9} />
            <h3 className="font-display uppercase" style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-.01em', color: WHITE }}>{title}</h3>
          </div>
          <p style={{ fontSize: 12.5, color: G2 }}>{subtitle}</p>
          {(servedCount > 0 || prepCount > 0) && (
            <div className="flex items-center justify-center gap-2 mt-2.5">
              {servedCount > 0 && (
                <span
                  className="font-mono uppercase"
                  style={{ fontSize: 9, fontWeight: 600, letterSpacing: '.08em', color: G2, padding: '4px 9px', borderRadius: 999, background: 'rgba(255,255,255,0.05)', border: `1px solid ${BORDER_STRONG}` }}
                >
                  {t('drinkSelection.servedProgress').replace('{served}', String(servedCount)).replace('{total}', String(totalCount))}
                </span>
              )}
              {prepCount > 0 && (
                <span
                  className="font-mono uppercase inline-flex items-center gap-1"
                  style={{ fontSize: 9, fontWeight: 600, letterSpacing: '.08em', color: '#F5B301', padding: '4px 9px', borderRadius: 999, background: 'rgba(245,179,1,0.10)', border: '1px solid rgba(245,179,1,0.30)' }}
                >
                  <Clock style={{ width: 10, height: 10 }} strokeWidth={2} />
                  {prepCount} {t('drinkSelection.inPrep')}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Scrollable items list */}
        <div className="flex-1 overflow-y-auto px-5 pb-2">
          <div className="space-y-2">
            {grouped.map((group, groupIdx) => {
              const available = group.totalCount - group.servedCount - group.prepCount;
              const selectedQty = groupSelection[groupIdx] || 0;
              const allUnavailable = available === 0;
              const selected = selectedQty > 0;

              return (
                <div
                  key={groupIdx}
                  className="flex items-center gap-3"
                  style={{
                    padding: 11,
                    borderRadius: 10,
                    background: allUnavailable ? 'rgba(255,255,255,0.02)' : selected ? RED_TINT : CARD2,
                    border: `1px solid ${allUnavailable ? BORDER : selected ? RED_SOFT : BORDER_STRONG}`,
                    opacity: allUnavailable ? 0.55 : 1,
                    transition: 'background .18s, border-color .18s',
                  }}
                >
                  {group.imgUrl && (
                    <img
                      src={group.imgUrl}
                      alt={group.name}
                      className={`w-10 h-10 rounded-lg object-cover flex-shrink-0 ${allUnavailable ? 'grayscale' : ''}`}
                    />
                  )}

                  <div className="flex-1 min-w-0">
                    <p
                      className="font-display uppercase truncate"
                      style={{ fontSize: 13, fontWeight: 700, letterSpacing: '-.005em', color: allUnavailable ? G3 : WHITE, textDecoration: allUnavailable ? 'line-through' : 'none' }}
                    >
                      {group.name}
                    </p>
                    <p className="font-mono uppercase truncate" style={{ fontSize: 9.5, letterSpacing: '.04em', color: G3, marginTop: 2 }}>
                      {group.servedCount > 0 && group.prepCount > 0
                        ? `${available} ${t('drinkSelection.available')} · ${group.servedCount} ${t('drinkSelection.collected')} · ${group.prepCount} ${t('drinkSelection.inPrep')}`
                        : group.servedCount >= group.totalCount
                          ? `${group.totalCount} ${t('drinkSelection.served')}`
                          : group.prepCount >= group.totalCount - group.servedCount
                            ? `${group.prepCount} ${t('drinkSelection.inPrep')}`
                            : group.servedCount > 0
                              ? `${available} ${t('drinkSelection.available')} · ${group.servedCount} ${t('drinkSelection.collected')}`
                              : group.prepCount > 0
                                ? `${available} ${t('drinkSelection.available')} · ${group.prepCount} ${t('drinkSelection.inPrep')}`
                                : `${available} ${t('drinkSelection.available')}`
                      }
                    </p>
                  </div>

                  <div className="flex-shrink-0">
                    {allUnavailable ? (
                      group.prepCount > 0 && group.servedCount < group.totalCount ? (
                        <Clock style={{ width: 18, height: 18, color: '#F5B301' }} strokeWidth={2} />
                      ) : (
                        <CheckCircle2 style={{ width: 18, height: 18, color: '#10B981' }} strokeWidth={2} />
                      )
                    ) : (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => toggleGroupUnit(groupIdx, -1)}
                          disabled={selectedQty === 0}
                          className="grid place-items-center cursor-pointer disabled:opacity-30"
                          style={{ width: 28, height: 28, borderRadius: 999, background: 'rgba(255,255,255,0.05)', border: `1px solid ${BORDER_STRONG}`, color: G1, fontSize: 16, lineHeight: 1 }}
                        >
                          −
                        </button>
                        <span className="font-display text-center" style={{ fontSize: 15, fontWeight: 700, width: 20, color: WHITE }}>{selectedQty}</span>
                        <button
                          onClick={() => toggleGroupUnit(groupIdx, 1)}
                          disabled={selectedQty >= available}
                          className="grid place-items-center cursor-pointer disabled:opacity-30"
                          style={{ width: 28, height: 28, borderRadius: 999, background: RED_TINT, border: `1px solid ${RED_SOFT}`, color: RED, fontSize: 16, lineHeight: 1 }}
                        >
                          +
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 pt-3 space-y-2 flex-shrink-0" style={{ borderTop: `1px solid ${BORDER}` }}>
          <button
            onClick={handleConfirm}
            disabled={selectedCount === 0}
            className="w-full flex items-center justify-center gap-2 cursor-pointer font-mono font-bold uppercase disabled:opacity-40"
            style={{ padding: '13px 12px', background: RED, color: '#fff', fontSize: 11, letterSpacing: '.1em', borderRadius: 3, border: 'none', boxShadow: '0 10px 28px -12px rgba(232,25,44,.6)' }}
          >
            {confirmText} ({selectedCount})
          </button>
          <button
            onClick={onClose}
            className="w-full cursor-pointer font-mono uppercase"
            style={{ padding: 12, borderRadius: 999, background: 'rgba(255,255,255,0.06)', border: `1px solid ${BORDER_STRONG}`, color: G1, fontSize: 11, fontWeight: 600, letterSpacing: '.08em' }}
          >
            {t('common.close')}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
