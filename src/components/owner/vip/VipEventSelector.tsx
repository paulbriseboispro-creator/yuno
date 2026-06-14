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

  return (
    <div className="flex items-center gap-2.5">
      <Calendar className="h-4 w-4 shrink-0" style={{ color: T3 }} />
      <VipSelect value={selectedEventId} onChange={onSelect} className="w-full max-w-sm">
        <option value="all" style={{ background: '#0a0a0c' }}>{t('vipOwner.allEvents')}</option>
        {events.map(e => (
          <option key={e.id} value={e.id} style={{ background: '#0a0a0c' }}>
            {e.title} — {format(new Date(e.startAt), 'dd MMM yyyy', { locale })}
          </option>
        ))}
      </VipSelect>
    </div>
  );
}
