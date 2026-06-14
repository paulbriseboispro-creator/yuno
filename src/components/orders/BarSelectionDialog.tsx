import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { supabase } from '@/integrations/supabase/client';
import { Wine, Loader2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

interface BarSelectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  venueId: string;
  onConfirm: (barName: string) => void;
}

export function BarSelectionDialog({ open, onOpenChange, venueId, onConfirm }: BarSelectionDialogProps) {
  const { t } = useLanguage();
  const [barNames, setBarNames] = useState<string[]>([]);
  const [selectedBar, setSelectedBar] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (open && venueId) {
      fetchBars();
    }
  }, [open, venueId]);

  const fetchBars = async () => {
    try {
      const { data, error } = await supabase
        .from('venues')
        .select('bar_names')
        .eq('id', venueId)
        .single();

      if (error) throw error;

      const bars = (data?.bar_names as string[]) || ['Bar Principal'];
      setBarNames(bars);
      if (bars.length > 0 && !selectedBar) {
        setSelectedBar(bars[0]);
      }
    } catch (error) {
      console.error('Error fetching bars:', error);
      setBarNames(['Bar Principal']);
      setSelectedBar('Bar Principal');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = () => {
    onConfirm(selectedBar);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wine className="h-5 w-5 text-primary" />
            {t('orders.chooseBar')}
          </DialogTitle>
          <DialogDescription>
            {t('orders.whichBar')}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <RadioGroup value={selectedBar} onValueChange={setSelectedBar} className="space-y-3">
            {barNames.map((bar, index) => (
              <div
                key={index}
                className={`flex items-center space-x-3 p-4 rounded-lg border transition-colors cursor-pointer ${
                  selectedBar === bar
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-muted/50'
                }`}
                onClick={() => setSelectedBar(bar)}
              >
                <RadioGroupItem value={bar} id={`bar-${index}`} />
                <Label htmlFor={`bar-${index}`} className="flex-1 cursor-pointer font-medium">
                  {bar}
                </Label>
              </div>
            ))}
          </RadioGroup>
        )}

        <DialogFooter className="flex gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button onClick={handleConfirm} disabled={!selectedBar}>
            Confirmer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
