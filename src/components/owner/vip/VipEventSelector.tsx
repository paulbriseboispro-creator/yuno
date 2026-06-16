import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { Calendar } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { VipEvent } from '@/hooks/useOwnerVipData';
import { VipSelect, T3 } from './vip-ui';

interface Props {
  events: VipEvent[];
  selectedEventId: string;
  onSelect: (id: string) => void;
}

export function VipEventSelector({ events, selectedEventId, onSelect }: Props) {
  const { t, language } = useLanguage();
  const locale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const [showPast, setShowPast] = useState(false);

  // Upcoming (or still running tonight) first, soonest at the top. Past events are
  // hidden by default to keep the list short, and revealed via the toggle. An event
  // is "past" once it has ended.
  const { upcoming, past } = useMemo(() => {
    const now = Date.now();
    const up: VipEvent[] = [];
    const old: VipEvent[] = [];
    for (const e of events) {
      const end = new Date(e.endAt).getTime();
      (Number.isFinite(end) && end < now ? old : up).push(e);
    }
    up.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
    old.sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime());
    return { upcoming: up, past: old };
  }, [events]);

  // Always show the past group if the currently-selected event is itself a past one,
  // otherwise the select would render blank.
  const selectedIsPast = past.some(e => e.id === selectedEventId);
  const pastVisible = showPast || selectedIsPast;

  const optionLabel = (e: VipEvent) => `${e.title} — ${format(new Date(e.startAt), 'dd MMM yyyy', { locale })}`;

  return (
    <div className="flex items-center gap-2.5">
      <Calendar className="h-4 w-4 shrink-0" style={{ color: T3 }} />
      <VipSelect value={selectedEventId} onChange={onSelect} className="w-full max-w-sm">
        <option value="all" style={{ background: '#0a0a0c' }}>{t('vipOwner.allEvents')}</option>
        {upcoming.length > 0 && (
          <optgroup label={t('vipOwner.upcomingGroup')} style={{ background: '#0a0a0c' }}>
            {upcoming.map(e => (
              <option key={e.id} value={e.id} style={{ background: '#0a0a0c' }}>{optionLabel(e)}</option>
            ))}
          </optgroup>
        )}
        {pastVisible && past.length > 0 && (
          <optgroup label={t('vipOwner.pastGroup')} style={{ background: '#0a0a0c' }}>
            {past.map(e => (
              <option key={e.id} value={e.id} style={{ background: '#0a0a0c' }}>{optionLabel(e)}</option>
            ))}
          </optgroup>
        )}
      </VipSelect>
      {past.length > 0 && (
        <button
          type="button"
          onClick={() => setShowPast(s => !s)}
          className="shrink-0 whitespace-nowrap text-[11px] font-medium transition-colors hover:text-white/70"
          style={{ color: T3 }}
        >
          {showPast ? t('vipOwner.hidePastEvents') : `${t('vipOwner.showPastEvents')} (${past.length})`}
        </button>
      )}
    </div>
  );
}
