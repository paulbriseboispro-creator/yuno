import { Button } from '@/components/ui/button';
import { Pencil, Trash2, Clock, Ban, RotateCcw } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Event } from '@/types';
import { TicketRound } from '@/types/ticketing';
import { RED, POS, GOLD, T1, T2, T3, TILE } from './ticketing-ui';

interface EventRoundRowProps {
  round: TicketRound;
  event: Event;
  isSimpleMode: boolean;
  isVip: boolean;
  onEdit: (round: TicketRound, event: Event) => void;
  onDelete: (roundId: string, eventId: string) => void;
  onToggleSoldOut?: (round: TicketRound, eventId: string) => void;
}

// Deduplicated row for both the Standard and VIP rounds lists (isVip toggles styling + badge).
export function EventRoundRow({ round, event, isSimpleMode, isVip, onEdit, onDelete, onToggleSoldOut }: EventRoundRowProps) {
  const { t } = useLanguage();
  const capacitySoldOut = round.ticketsSold >= round.maxTickets;
  return (
    <div
      className="flex items-center justify-between gap-2 p-3"
      style={isVip ? { background: 'rgba(252,211,153,0.05)', border: '1px solid rgba(252,211,153,0.18)', borderRadius: 12 } : TILE}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="truncate" style={{ color: T1, fontSize: 14, fontWeight: 560 }}>{round.name}</span>
          {isVip && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-semibold" style={{ background: 'rgba(252,211,153,0.12)', border: '1px solid rgba(252,211,153,0.3)', color: GOLD }}>VIP</span>
          )}
          {round.isActive && !round.manuallySoldOut && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-semibold" style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)', color: POS }}>{t('tickets.active')}</span>
          )}
          {round.manuallySoldOut ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold" style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.3)', color: RED }}>
              <Ban className="h-2.5 w-2.5" />{t('tickets.soldOutManual')}
            </span>
          ) : capacitySoldOut && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-semibold" style={{ background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.3)', color: RED }}>{t('tickets.soldOut')}</span>
          )}
        </div>
        <div className="mt-1.5 tabular-nums" style={{ color: T3, fontSize: 12.5 }}>
          <span style={{ color: T2 }}>{round.price}€</span> · {isSimpleMode ? `${round.ticketsSold}` : `${round.ticketsSold}/${round.maxTickets}`} {t('tickets.sold')}
          {round.entryDeadline && (
            <span className="ml-2" style={{ color: RED }}>
              <Clock className="h-3 w-3 inline mr-0.5" />
              {t('tickets.entryBefore')} {round.entryDeadline}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 flex-none">
        {onToggleSoldOut && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onToggleSoldOut(round, event.id)}
            title={round.manuallySoldOut ? t('tickets.soldOutClear') : t('tickets.markSoldOut')}
            className={round.manuallySoldOut ? 'hover:bg-[rgba(52,211,153,0.12)]' : 'hover:bg-[rgba(232,25,44,0.12)]'}
            style={{ color: round.manuallySoldOut ? POS : RED }}
          >
            {round.manuallySoldOut ? <RotateCcw className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
          </Button>
        )}
        <Button variant="ghost" size="icon-sm" onClick={() => onEdit(round, event)} className="hover:bg-white/[0.06]" style={{ color: T2 }}>
          <Pencil className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={() => onDelete(round.id, event.id)} className="hover:bg-[rgba(232,25,44,0.12)]" style={{ color: RED }}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
