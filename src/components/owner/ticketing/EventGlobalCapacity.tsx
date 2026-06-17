import { Input } from '@/components/ui/input';
import { Users } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { T1, T3, INNER_CARD } from './ticketing-ui';

interface EventGlobalCapacityProps {
  maxTickets: number | null | undefined;
  soldTickets: number;
  onUpdate: (val: number) => void;
}

// Per-event global ticket capacity (simple selling mode only).
export function EventGlobalCapacity({ maxTickets, soldTickets, onUpdate }: EventGlobalCapacityProps) {
  const { t } = useLanguage();
  return (
    <div className="p-3.5 space-y-2.5" style={INNER_CARD}>
      <div className="flex items-center gap-3">
        <Users className="h-4 w-4 flex-none" style={{ color: T3 }} />
        <div>
          <p style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{t('tickets.globalCapacity')}</p>
          <p style={{ color: T3, fontSize: 11.5, marginTop: 1 }}>{t('tickets.globalCapacityDesc')}</p>
        </div>
      </div>
      <div className="flex gap-2">
        <Input
          type="number"
          min="1"
          placeholder="200"
          defaultValue={maxTickets || ''}
          onBlur={(e) => {
            const val = parseInt(e.target.value);
            if (val > 0) onUpdate(val);
          }}
        />
      </div>
      {maxTickets && (
        <div style={{ color: T3, fontSize: 11.5 }}>
          {soldTickets} / {maxTickets} {t('tickets.sold')}
        </div>
      )}
    </div>
  );
}
