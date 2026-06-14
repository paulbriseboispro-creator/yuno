import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
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
  onSelectMixer: (mixer: MixerItem) => void;
  onSkip: () => void;
}

export function MixerSuggestionDialog({
  open,
  onOpenChange,
  spiritName,
  mixers,
  onSelectMixer,
  onSkip,
}: MixerSuggestionDialogProps) {
  const { t } = useLanguage();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-primary/20 bg-card">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5 text-lg">
            <div className="flex items-center justify-center w-7 h-7 rounded-full bg-primary/15">
              <Check className="h-4 w-4 text-primary" />
            </div>
            {spiritName} {t('vipBudget.added')}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t('vipBudget.mixerQuestion')}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2.5 mt-4">
          {mixers.map((mixer) => (
            <button
              key={mixer.id}
              className="flex items-center gap-3 p-3 rounded-xl border border-border/60 bg-card hover:border-primary/60 hover:bg-primary/5 transition-all duration-200 cursor-pointer text-left group"
              onClick={() => onSelectMixer(mixer)}
            >
              {mixer.image_url ? (
                <img
                  src={mixer.image_url}
                  alt={mixer.name}
                  className="w-10 h-10 object-cover rounded-lg flex-shrink-0"
                />
              ) : (
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 group-hover:bg-primary/20 transition-colors">
                  <GlassWater className="w-5 h-5 text-primary/70" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-foreground truncate leading-tight">{mixer.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {mixer.price > 0 ? `+${mixer.price}€` : 'Inclus'}
                </p>
              </div>
            </button>
          ))}
        </div>

        <Button
          variant="outline"
          className="w-full mt-3 border-primary/40 text-primary hover:bg-primary/10 hover:text-primary hover:border-primary/60 transition-all"
          onClick={onSkip}
        >
          {t('vipBudget.noMixer')}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
