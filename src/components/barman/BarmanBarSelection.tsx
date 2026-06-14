import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Wine, Check, MapPin } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';

interface BarmanBarSelectionProps {
  venueId: string;
  currentBar: string | null;
  onBarSelect: (barName: string) => void;
}

export function BarmanBarSelection({ venueId, currentBar, onBarSelect }: BarmanBarSelectionProps) {
  const { t } = useLanguage();
  const [barNames, setBarNames] = useState<string[]>([]);
  const [selectedBar, setSelectedBar] = useState<string>(currentBar || '');
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetchBars();
  }, [venueId]);

  useEffect(() => {
    // If no bar is currently selected and we have bars, open the dialog
    if (!currentBar && barNames.length > 1) {
      setOpen(true);
    }
  }, [currentBar, barNames]);

  const fetchBars = async () => {
    try {
      const { data, error } = await supabase
        .from('venues')
        .select('bar_names, bar_count')
        .eq('id', venueId)
        .single();

      if (error) throw error;

      const bars = (data?.bar_names as string[]) || ['Bar Principal'];
      setBarNames(bars);
      
      // If only one bar, auto-select it
      if (bars.length === 1) {
        onBarSelect(bars[0]);
      }
    } catch (error) {
      console.error('Error fetching bars:', error);
      setBarNames(['Bar Principal']);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = () => {
    if (selectedBar) {
      onBarSelect(selectedBar);
      setOpen(false);
    }
  };

  const handleChangeBar = () => {
    setOpen(true);
  };

  // If only one bar exists, don't show the selector
  if (barNames.length <= 1) {
    return null;
  }

  return (
    <>
      {/* Current Bar Badge - shown when bar is selected */}
      {currentBar && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex items-center gap-2"
        >
          <button
            onClick={handleChangeBar}
            className="flex items-center justify-center w-9 h-9 rounded-full bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-colors"
            title={currentBar}
          >
            <MapPin className="h-4 w-4" />
          </button>
        </motion.div>
      )}

      {/* Bar Selection Dialog */}
      <Dialog open={open} onOpenChange={(o) => {
        // Only allow closing if a bar is selected
        if (!o && !currentBar) return;
        setOpen(o);
      }}>
        <DialogContent className="sm:max-w-md border-0 bg-surface">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wine className="h-5 w-5 text-primary" />
              {t('barman.selectBar')}
            </DialogTitle>
            <DialogDescription>
              {t('barman.selectBarDesc')}
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : (
            <div className="space-y-4">
              <RadioGroup value={selectedBar} onValueChange={setSelectedBar} className="space-y-3">
                {barNames.map((bar, index) => (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.05 }}
                  >
                    <div
                      className={`flex items-center space-x-3 p-4 rounded-lg border transition-all cursor-pointer ${
                        selectedBar === bar
                          ? 'border-primary bg-primary/10 shadow-md'
                          : 'border-border hover:bg-muted/50 hover:border-primary/30'
                      }`}
                      onClick={() => setSelectedBar(bar)}
                    >
                      <RadioGroupItem value={bar} id={`bar-${index}`} />
                      <Label htmlFor={`bar-${index}`} className="flex-1 cursor-pointer">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Wine className="h-4 w-4 text-primary" />
                            <span className="font-medium">{bar}</span>
                          </div>
                          {selectedBar === bar && (
                            <Check className="h-4 w-4 text-primary" />
                          )}
                        </div>
                      </Label>
                    </div>
                  </motion.div>
                ))}
              </RadioGroup>

              <Button 
                onClick={handleConfirm} 
                disabled={!selectedBar}
                className="w-full"
              >
                {t('barman.confirmBar')}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
