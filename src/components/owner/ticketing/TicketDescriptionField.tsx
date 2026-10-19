import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useLanguage } from '@/contexts/LanguageContext';
import { TICKET_DESCRIPTION_MAX } from '@/lib/freeTicketing';
import { GOLD, HINT, LABEL, T3 } from './ticketing-ui';

interface TicketDescriptionFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Dans une carte de modèle : micro-libellé, sans phrase d'aide. */
  compact?: boolean;
}

// Description FACULTATIVE d'un billet (ticket_rounds.description), affichée
// sous le billet côté client : page de la soirée et page d'achat. Le même
// champ sert tous les éditeurs de billets ; le plafond est celui du CHECK SQL.
export function TicketDescriptionField({ id, value, onChange, compact = false }: TicketDescriptionFieldProps) {
  const { t } = useLanguage();
  const near = value.length >= TICKET_DESCRIPTION_MAX - 20;
  const counter = (
    <span className="tabular-nums" style={{ color: near ? GOLD : T3, fontSize: 10.5 }} aria-live="polite">
      {value.length}/{TICKET_DESCRIPTION_MAX}
    </span>
  );
  return (
    <div className={compact ? 'space-y-1.5' : undefined}>
      <div className="flex items-baseline justify-between gap-2">
        {compact
          ? <label htmlFor={id} style={{ ...LABEL, fontSize: 10.5 }}>{t('tickets.description')}</label>
          : <Label htmlFor={id}>{t('tickets.description')}</Label>}
        {counter}
      </div>
      <Textarea
        id={id}
        rows={2}
        maxLength={TICKET_DESCRIPTION_MAX}
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, TICKET_DESCRIPTION_MAX))}
        placeholder={t('tickets.descriptionPlaceholder')}
        className={compact ? 'min-h-[56px] resize-none text-[13px]' : 'mt-1 min-h-[60px] resize-none'}
      />
      {!compact && <p style={{ ...HINT, marginTop: 4 }}>{t('tickets.descriptionHint')}</p>}
    </div>
  );
}
