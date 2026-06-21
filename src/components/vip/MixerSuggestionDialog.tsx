import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Check, GlassWater } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

interface MixerItem {
  id: string;
  name: string;
  price: number;
  image_url?: string | null;
}

interface MixerSuggestionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spiritName: string;
  mixers: MixerItem[];
  maxMixers: number;
  onConfirm: (selected: MixerItem[]) => void;
}

export function MixerSuggestionDialog({
  open,
  onOpenChange,
  spiritName,
  mixers,
  maxMixers,
  onConfirm,
}: MixerSuggestionDialogProps) {
  const { t } = useLanguage();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const max = Math.max(1, maxMixers);

  // Reset the selection each time the dialog opens for a new bottle.
  useEffect(() => {
    if (open) setSelectedIds([]);
  }, [open, spiritName]);

  const toggle = (id: string) => {
    setSelectedIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (max === 1) return [id]; // single-choice replaces
      if (prev.length >= max) return prev; // already at the cap
      return [...prev, id];
    });
  };

  const selectedMixers = selectedIds
    .map(id => mixers.find(m => m.id === id))
    .filter((m): m is MixerItem => !!m);
  const extraTotal = selectedMixers.reduce((sum, m) => sum + (m.price || 0), 0);
  const canConfirm = selectedIds.length >= 1;
  const atMax = selectedIds.length >= max;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md w-[calc(100%-2rem)] p-0 gap-0 overflow-hidden border-border bg-card sm:rounded-2xl">
        <DialogHeader className="space-y-1.5 px-5 pt-6 pb-4 text-left">
          <DialogTitle className="font-display font-bold text-white uppercase" style={{ fontSize: 21, letterSpacing: '-0.02em', lineHeight: 1.02 }}>
            {t('vipMenu.chooseMixer')}
          </DialogTitle>
          <DialogDescription className="font-mono uppercase truncate" style={{ fontSize: 10.5, letterSpacing: '0.1em', color: '#9A9A9A' }}>
            {spiritName} · {max > 1 ? t('vipMenu.chooseUpTo').replace('{count}', String(max)) : t('vipMenu.chooseOne')}
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[42vh] overflow-y-auto">
          {mixers.map((mixer) => {
            const isSelected = selectedIds.includes(mixer.id);
            const disabled = !isSelected && atMax;
            return (
              <button
                key={mixer.id}
                type="button"
                disabled={disabled}
                onClick={() => toggle(mixer.id)}
                className="relative flex items-center gap-3 p-2.5 rounded-xl text-left outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-white/30 disabled:cursor-not-allowed active:scale-[0.98]"
                style={{
                  background: isSelected ? 'rgba(232,25,44,0.12)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${isSelected ? '#E8192C' : 'rgba(255,255,255,0.10)'}`,
                  boxShadow: isSelected ? '0 8px 24px rgba(232,25,44,0.20)' : 'none',
                  opacity: disabled ? 0.4 : 1,
                }}
              >
                <div className="relative w-12 h-12 shrink-0 overflow-hidden rounded-lg bg-gradient-to-b from-white/[0.06] to-black/40 ring-1 ring-white/5">
                  {mixer.image_url ? (
                    <img src={mixer.image_url} alt={mixer.name} className="w-full h-full object-contain p-1 drop-shadow-[0_3px_8px_rgba(0,0,0,0.45)]" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <GlassWater className="w-5 h-5" style={{ color: 'rgba(232,25,44,0.7)' }} />
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0 pr-5">
                  <p className="font-display font-bold text-white uppercase truncate leading-tight" style={{ fontSize: 13.5, letterSpacing: '-0.005em' }}>
                    {mixer.name}
                  </p>
                  <p className="font-mono uppercase mt-0.5" style={{ fontSize: 10, letterSpacing: '0.06em', color: mixer.price > 0 ? '#E8192C' : '#5A5A5E' }}>
                    {mixer.price > 0 ? `+${mixer.price}€` : t('vipMenu.mixerIncluded')}
                  </p>
                </div>

                {/* Selection indicator */}
                <span
                  className="absolute top-2.5 right-2.5 flex items-center justify-center transition-all duration-200"
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 999,
                    background: isSelected ? '#E8192C' : 'transparent',
                    border: isSelected ? 'none' : '1px solid rgba(255,255,255,0.22)',
                  }}
                >
                  {isSelected && <Check className="h-3 w-3 text-white" />}
                </span>
              </button>
            );
          })}
        </div>

        <div className="px-5 pt-4 pb-5 space-y-1">
          <button
            type="button"
            onClick={() => canConfirm && onConfirm(selectedMixers)}
            disabled={!canConfirm}
            className="btn btn--primary w-full outline-none disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
            style={{ height: 50, borderRadius: 4 }}
          >
            <span className="font-mono font-bold uppercase" style={{ fontSize: 12, letterSpacing: '0.08em' }}>
              {t('vipMenu.addToOrder')}
            </span>
            {extraTotal > 0 && (
              <span className="ml-auto font-mono font-bold" style={{ fontSize: 13 }}>+{extraTotal}€</span>
            )}
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="block w-full text-center font-mono uppercase outline-none py-2.5 transition-colors hover:text-white"
            style={{ fontSize: 10, letterSpacing: '0.1em', color: '#5A5A5E' }}
          >
            {t('common.cancel')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
