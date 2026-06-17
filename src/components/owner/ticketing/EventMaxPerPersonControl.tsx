import { Input } from '@/components/ui/input';
import { Ticket } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { T1, T3, INNER_CARD } from './ticketing-ui';

interface EventMaxPerPersonControlProps {
  maxTicketsPerPerson: number | null | undefined;
  onUpdate: (val: number | null) => void;
}

// Per-event "max tickets per person" limit input.
export function EventMaxPerPersonControl({ maxTicketsPerPerson, onUpdate }: EventMaxPerPersonControlProps) {
  const { t } = useLanguage();
  return (
    <div className="p-3.5 space-y-2.5" style={INNER_CARD}>
      <div className="flex items-center gap-3">
        <Ticket className="h-4 w-4 flex-none" style={{ color: T3 }} />
        <div>
          <p style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{t('tickets.maxPerPerson')}</p>
          <p style={{ color: T3, fontSize: 11.5, marginTop: 1 }}>{t('tickets.maxPerPersonDesc')}</p>
        </div>
      </div>
      <Input
        type="number"
        min="1"
        placeholder={t('tickets.maxPerPersonPlaceholder')}
        defaultValue={maxTicketsPerPerson ?? ''}
        onBlur={(e) => {
          const raw = e.target.value.trim();
          const val = raw === '' ? null : parseInt(raw, 10);
          const current = maxTicketsPerPerson ?? null;
          const next = val && val > 0 ? val : null;
          if (next !== current) onUpdate(next);
        }}
      />
      <p style={{ color: T3, fontSize: 11 }}>
        {maxTicketsPerPerson
          ? t('tickets.maxPerPersonActive').replace('{count}', String(maxTicketsPerPerson))
          : t('tickets.maxPerPersonNone')}
      </p>
    </div>
  );
}
