import { useState } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useLanguage } from '@/contexts/LanguageContext';
import { CheckCircle2, Wine, X, Clock } from 'lucide-react';

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
      const isServed = Array.isArray((item as any).servedUnits) 
        ? (item as any).servedUnits[i] === true 
        : item.served === true;
      const isInPrep = Array.isArray((item as any).prepUnits)
        ? (item as any).prepUnits[i] === true
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
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 overflow-hidden"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-2xl w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden relative shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button 
          onClick={onClose}
          className="absolute top-3 right-3 z-10 p-2 rounded-full bg-black/10 text-gray-700 hover:bg-black/20 transition-colors"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Header */}
        <div className="p-5 pb-3 text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Wine className="h-5 w-5 text-primary" />
            <h3 className="text-lg font-bold text-gray-900">{title}</h3>
          </div>
          <p className="text-sm text-gray-500">{subtitle}</p>
          {(servedCount > 0 || prepCount > 0) && (
            <div className="flex items-center justify-center gap-2 mt-2">
              {servedCount > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {t('drinkSelection.servedProgress').replace('{served}', String(servedCount)).replace('{total}', String(totalCount))}
                </Badge>
              )}
              {prepCount > 0 && (
                <Badge className="bg-blue-100 text-blue-700 text-xs">
                  <Clock className="h-2.5 w-2.5 mr-0.5 inline" />
                  {prepCount} {t('drinkSelection.inPrep')}
                </Badge>
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

              return (
                <div
                  key={groupIdx}
                  className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                    allUnavailable 
                      ? 'bg-gray-100 border-gray-200 opacity-60' 
                      : selectedQty > 0
                        ? 'bg-primary/5 border-primary shadow-sm' 
                        : 'bg-white border-gray-200'
                  }`}
                >
                  {group.imgUrl && (
                    <img 
                      src={group.imgUrl} 
                      alt={group.name}
                      className={`w-10 h-10 rounded-lg object-cover flex-shrink-0 ${allUnavailable ? 'grayscale' : ''}`}
                    />
                  )}

                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium truncate ${allUnavailable ? 'line-through text-gray-400' : 'text-gray-900'}`}>
                      {group.name}
                    </p>
                    <p className="text-xs text-gray-400">
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
                        <Clock className="h-5 w-5 text-blue-500" />
                      ) : (
                        <CheckCircle2 className="h-5 w-5 text-green-500" />
                      )
                    ) : (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => toggleGroupUnit(groupIdx, -1)}
                          disabled={selectedQty === 0}
                          className="w-7 h-7 rounded-full border border-gray-300 flex items-center justify-center text-gray-600 disabled:opacity-30 hover:bg-gray-100 transition-colors"
                        >
                          −
                        </button>
                        <span className="text-sm font-bold w-5 text-center text-gray-900">{selectedQty}</span>
                        <button
                          onClick={() => toggleGroupUnit(groupIdx, 1)}
                          disabled={selectedQty >= available}
                          className="w-7 h-7 rounded-full border border-primary bg-primary/10 flex items-center justify-center text-primary disabled:opacity-30 hover:bg-primary/20 transition-colors"
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
        <div className="p-4 pt-3 border-t border-gray-200 bg-white space-y-2 flex-shrink-0">
          <Button
            onClick={handleConfirm}
            disabled={selectedCount === 0}
            className="w-full h-11 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
          >
            {confirmText} ({selectedCount})
          </Button>
          <Button 
            variant="outline" 
            className="w-full h-11 border-gray-300 text-gray-700 hover:bg-gray-50 font-medium"
            onClick={onClose}
          >
            {t('common.close')}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
