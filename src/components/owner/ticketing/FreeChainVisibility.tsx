import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Eye } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { ChainVisibility } from '@/lib/freeTicketing';
import { T1, T3, INNER_CARD } from './ticketing-ui';

interface FreeChainVisibilityProps {
  visibility: ChainVisibility;
  onChange: (value: ChainVisibility) => void;
}

// Billetterie libre : ce que voit l'acheteur d'un billet « après un billet »
// (events.free_chain_visibility, lu par ticketPhase sur la page ET au
// checkout). Affiché seulement quand la soirée a au moins un tel billet.
export function FreeChainVisibility({ visibility, onChange }: FreeChainVisibilityProps) {
  const { t } = useLanguage();
  const label = (v: ChainVisibility) => t(`tickets.free.chainVis.${v}`);
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap p-3.5" style={INNER_CARD}>
      <div className="flex items-center gap-3 min-w-0">
        <Eye className="h-4 w-4 flex-shrink-0" style={{ color: T3 }} />
        <div className="min-w-0">
          <p style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{t('tickets.free.chainVis.label')}</p>
          <p style={{ color: T3, fontSize: 11.5, marginTop: 1 }}>{t(`tickets.free.chainVis.${visibility}Hint`)}</p>
        </div>
      </div>
      <Select value={visibility} onValueChange={(value) => onChange(value as ChainVisibility)}>
        <SelectTrigger className="w-[230px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="preview">{label('preview')}</SelectItem>
          <SelectItem value="hidden">{label('hidden')}</SelectItem>
          <SelectItem value="open">{label('open')}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
