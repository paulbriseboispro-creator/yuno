import { useState, useEffect } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { Wine } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

interface BarSelectorProps {
  venueId: string;
  value: string | null;
  onChange: (bar: string) => void;
  label?: string;
  disabled?: boolean;
}

export function BarSelector({ venueId, value, onChange, label, disabled }: BarSelectorProps) {
  const { t } = useLanguage();
  const [barNames, setBarNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (venueId) {
      fetchBars();
    }
  }, [venueId]);

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
    } catch (error) {
      console.error('Error fetching bars:', error);
      setBarNames(['Bar Principal']);
    } finally {
      setLoading(false);
    }
  };

  // Don't show selector if there's only one bar
  if (!loading && barNames.length <= 1) {
    return null;
  }

  return (
    <div className="space-y-2">
      {label && (
        <Label className="flex items-center gap-2">
          <Wine className="h-4 w-4" />
          {label}
        </Label>
      )}
      <Select
        value={value || ''}
        onValueChange={onChange}
        disabled={disabled || loading}
      >
        <SelectTrigger>
          <SelectValue placeholder={t('orders.selectBar')} />
        </SelectTrigger>
        <SelectContent>
          {barNames.map((bar, index) => (
            <SelectItem key={index} value={bar}>
              {bar}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
