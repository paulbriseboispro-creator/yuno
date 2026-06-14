import { Globe, Calendar } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import type { AnalyticsMode, EventInfo } from '@/hooks/useAnalyticsData';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';

interface Props {
  mode: AnalyticsMode;
  onModeChange: (mode: AnalyticsMode) => void;
  selectedEventId: string | null;
  onEventSelect: (eventId: string | null) => void;
  events: EventInfo[];
}

export function AnalyticsGlobalEventToggle({ mode, onModeChange, selectedEventId, onEventSelect, events }: Props) {
  const { t, language } = useLanguage();
  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  return (
    <div className="space-y-3">
      <div className="flex glass-card rounded-xl p-1 w-full sm:w-auto sm:inline-flex">
        <button
          onClick={() => { onModeChange('global'); onEventSelect(null); }}
          className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
            mode === 'global'
              ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
          }`}
        >
          <Globe className="h-4 w-4" />
          {t('analytics.global')}
        </button>
        <button
          onClick={() => onModeChange('event')}
          className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
            mode === 'event'
              ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
          }`}
        >
          <Calendar className="h-4 w-4" />
          {t('analytics.event')}
        </button>
      </div>

      {mode === 'event' && (
        <Select value={selectedEventId || ''} onValueChange={(v) => onEventSelect(v || null)}>
          <SelectTrigger className="w-full sm:w-80 glass-card rounded-xl h-11 border-border/30">
            <SelectValue placeholder={t('analytics.selectEvent')} />
          </SelectTrigger>
          <SelectContent className="glass-card border-border/30">
            {events.map(event => (
              <SelectItem key={event.id} value={event.id}>
                <div className="flex items-center gap-2">
                  <span className="truncate">{event.title}</span>
                  <Badge variant={event.isUpcoming ? 'default' : 'secondary'} className="text-[10px] px-1.5 py-0">
                    {event.isUpcoming ? t('analytics.upcoming') : format(new Date(event.startAt), 'dd MMM', { locale: dateLocale })}
                  </Badge>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
