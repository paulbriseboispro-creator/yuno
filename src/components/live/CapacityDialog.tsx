import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  venueId: string;
  capacity: number | null;
  onSaved: () => void;
}

export function CapacityDialog({ open, onOpenChange, venueId, capacity, onSaved }: Props) {
  const { t } = useLanguage();
  const [value, setValue] = useState<string>(capacity ? String(capacity) : '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const parsed = parseInt(value, 10);
    if (!parsed || parsed <= 0) return;
    setSaving(true);
    const { error } = await supabase
      .from('venue_hype_baseline')
      .upsert({ venue_id: venueId, capacity: parsed }, { onConflict: 'venue_id' });
    setSaving(false);
    if (error) {
      toast.error(t('liveops.capacity.saveError'));
      return;
    }
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('liveops.capacity.title')}</DialogTitle>
          <DialogDescription>{t('liveops.capacity.desc')}</DialogDescription>
        </DialogHeader>
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder={t('liveops.capacity.placeholder')}
          autoFocus
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('liveops.capacity.cancel')}</Button>
          <Button onClick={save} disabled={saving || !parseInt(value, 10)}>
            {t('liveops.capacity.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
