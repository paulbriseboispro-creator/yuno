import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Ticket } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { T1, T3, INNER_CARD } from './ticketing-ui';

type RoundsVisibility = 'sequential' | 'preview_upcoming' | 'all_open';

interface EventRoundsVisibilityProps {
  visibility: RoundsVisibility;
  onChange: (value: RoundsVisibility) => void;
}

// Per-event rounds-visibility picker (rounds mode only). The persistence (supabase update +
// optimistic state) lives in the parent callback so behavior stays identical.
export function EventRoundsVisibility({ visibility, onChange }: EventRoundsVisibilityProps) {
  const { t } = useLanguage();
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap p-3.5" style={INNER_CARD}>
      <div className="flex items-center gap-3 min-w-0">
        <Ticket className="h-4 w-4 flex-shrink-0" style={{ color: T3 }} />
        <div className="min-w-0">
          <p style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{t('tickets.roundsVisibilityLabel')}</p>
          <p className="truncate" style={{ color: T3, fontSize: 11.5, marginTop: 1 }}>
            {visibility === 'sequential' && t('tickets.roundsVisibilitySequential')}
            {visibility === 'preview_upcoming' && t('tickets.roundsVisibilityPreview')}
            {visibility === 'all_open' && t('tickets.roundsVisibilityAll')}
          </p>
        </div>
      </div>
      <Select
        value={visibility}
        onValueChange={(value) => onChange(value as RoundsVisibility)}
      >
        <SelectTrigger className="w-[180px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="sequential">{t('tickets.roundsVisibilitySequential')}</SelectItem>
          <SelectItem value="preview_upcoming">{t('tickets.roundsVisibilityPreview')}</SelectItem>
          <SelectItem value="all_open">{t('tickets.roundsVisibilityAll')}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
