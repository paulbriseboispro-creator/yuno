import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Clock, Lock } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { TicketSellingMode } from '@/types/ticketing';
import { T1, T2, T3, TILE, INNER_CARD } from './ticketing-ui';

interface EventSellingModeToggleProps {
  sellingMode: TicketSellingMode;
  locked: boolean;
  onChangeMode: (mode: TicketSellingMode) => void;
}

// Per-event selling-mode picker (simple / rounds / timed_entry). Locks once tickets are sold.
export function EventSellingModeToggle({ sellingMode, locked, onChangeMode }: EventSellingModeToggleProps) {
  const { t } = useLanguage();
  return (
    <div className="flex items-center justify-between gap-3 p-3.5" style={INNER_CARD}>
      <div className="flex items-center gap-3">
        <Clock className="h-4 w-4 flex-none" style={{ color: T3 }} />
        <div>
          <p style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{t('tickets.sellingMode')}</p>
          <p style={{ color: T3, fontSize: 11.5, marginTop: 1 }}>
            {sellingMode === 'simple'
              ? t('tickets.sellingModeSimpleDesc')
              : sellingMode === 'timed_entry'
                ? t('tickets.sellingModeTimedDesc')
                : t('tickets.sellingModeRoundsDesc')}
          </p>
        </div>
      </div>
      {locked ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-2 px-3 py-1.5 text-[13px]" style={{ ...TILE, color: T2 }}>
                <Lock className="h-3.5 w-3.5" />
                {sellingMode === 'simple' ? t('tickets.sellingModeSimple') : sellingMode === 'timed_entry' ? t('tickets.sellingModeTimed') : t('tickets.sellingModeRounds')}
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t('tickets.sellingModeLocked')}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        <Select
          value={sellingMode}
          onValueChange={(value) => onChangeMode(value as TicketSellingMode)}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="simple">{t('tickets.sellingModeSimple')}</SelectItem>
            <SelectItem value="rounds">{t('tickets.sellingModeRounds')}</SelectItem>
            <SelectItem value="timed_entry">{t('tickets.sellingModeTimed')}</SelectItem>
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
