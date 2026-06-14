import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLanguage } from '@/contexts/LanguageContext';

type DateRange = '7d' | '30d' | '90d' | 'all';

interface Props {
  value: DateRange;
  onChange: (v: DateRange) => void;
  eventFilter?: string | null;
  onEventChange?: (v: string | null) => void;
  events?: Array<{ id: string; title: string }>;
}

export function DateRangeFilter({ value, onChange, eventFilter, onEventChange, events }: Props) {
  const { t } = useLanguage();

  return (
    <div className="flex gap-2 flex-wrap">
      <Select value={value} onValueChange={(v) => onChange(v as DateRange)}>
        <SelectTrigger className="w-[140px] h-9 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="7d">{t('promoterProgram.last7d')}</SelectItem>
          <SelectItem value="30d">{t('promoterProgram.last30d')}</SelectItem>
          <SelectItem value="90d">{t('promoterProgram.last90d')}</SelectItem>
          <SelectItem value="all">{t('promoterProgram.allTime')}</SelectItem>
        </SelectContent>
      </Select>
      {events && events.length > 0 && onEventChange && (
        <Select value={eventFilter || 'all'} onValueChange={(v) => onEventChange(v === 'all' ? null : v)}>
          <SelectTrigger className="w-[180px] h-9 text-sm">
            <SelectValue placeholder={t('promoterProgram.allEvents')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('promoterProgram.allEvents')}</SelectItem>
            {events.map(e => (
              <SelectItem key={e.id} value={e.id}>{e.title}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
