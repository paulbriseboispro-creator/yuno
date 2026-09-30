import { Button } from '@/components/ui/button';
import { Pencil, Trash2, Ban, RotateCcw, ChevronUp, ChevronDown, Wine, Play, Clock } from 'lucide-react';
import { formatInTimeZone } from 'date-fns-tz';
import { enUS, es, fr } from 'date-fns/locale';
import { useLanguage } from '@/contexts/LanguageContext';
import { TicketRound } from '@/types/ticketing';
import { UNLIMITED_TICKETS, ticketPhase } from '@/lib/freeTicketing';
import { PARIS_TIMEZONE } from '@/lib/timezone';
import { RED, POS, GOLD, T1, T2, T3, TILE, BORDER } from './ticketing-ui';

interface FreeTicketRowProps {
  ticket: TicketRound;
  isFirst: boolean;
  isLast: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggleSoldOut: () => void;
  onOpenSale: () => void;
  onMove: (dir: -1 | 1) => void;
}

const PILL = 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold';

// Une ligne de la billetterie libre : ce que le public voit MAINTENANT
// (ticketPhase), puis ce qui va changer et quand. Une seule couleur par
// statut : vert en vente, or programmé, gris caché / terminé, rouge complet.
export function FreeTicketRow({ ticket, isFirst, isLast, onEdit, onDelete, onToggleSoldOut, onOpenSale, onMove }: FreeTicketRowProps) {
  const { t, language } = useLanguage();
  const locale = language === 'en' ? enUS : language === 'es' ? es : fr;
  const when = (iso: string) => formatInTimeZone(new Date(iso), PARIS_TIMEZONE, 'd MMM HH:mm', { locale });
  const phase = ticketPhase(ticket);
  const capacitySoldOut = ticket.ticketsSold >= ticket.maxTickets;
  const soldOut = ticket.manuallySoldOut || capacitySoldOut;
  const unlimited = ticket.maxTickets >= UNLIMITED_TICKETS;

  const badge = (() => {
    if (soldOut) return { label: ticket.manuallySoldOut ? t('tickets.soldOutManual') : t('tickets.soldOut'), color: RED, bg: 'rgba(232,25,44,0.1)', border: 'rgba(232,25,44,0.3)' };
    if (phase === 'on_sale') return { label: t('tickets.free.phase.onSale'), color: POS, bg: 'rgba(52,211,153,0.1)', border: 'rgba(52,211,153,0.25)' };
    if (phase === 'ended') return { label: t('tickets.free.phase.ended'), color: T3, bg: 'rgb(var(--ink)/0.06)', border: BORDER };
    if (phase === 'upcoming') {
      return ticket.isActive && ticket.saleStartsAt
        ? { label: t('tickets.free.phase.opensAt').replace('{date}', when(ticket.saleStartsAt)), color: GOLD, bg: 'rgba(252,211,153,0.1)', border: 'rgba(252,211,153,0.3)' }
        : { label: t('tickets.free.phase.upcoming'), color: GOLD, bg: 'rgba(252,211,153,0.1)', border: 'rgba(252,211,153,0.3)' };
    }
    return !ticket.hidden && ticket.visibleFrom
      ? { label: t('tickets.free.phase.showsAt').replace('{date}', when(ticket.visibleFrom)), color: GOLD, bg: 'rgba(252,211,153,0.1)', border: 'rgba(252,211,153,0.3)' }
      : { label: t('tickets.free.phase.hidden'), color: T3, bg: 'rgb(var(--ink)/0.06)', border: BORDER };
  })();

  // La suite programmée, quand il y en a une : le pro lit la chronologie du billet.
  const next = !soldOut && phase !== 'ended' && ticket.saleEndsAt
    ? t('tickets.free.phase.until').replace('{date}', when(ticket.saleEndsAt))
    : null;
  const canOpenNow = !soldOut && !ticket.isActive && phase !== 'hidden' && phase !== 'ended';

  return (
    <div className="flex items-center justify-between gap-2 p-3" style={TILE}>
      <div className="flex flex-col flex-none -my-1">
        <button type="button" disabled={isFirst} onClick={() => onMove(-1)} aria-label={t('tickets.free.moveUp')} title={t('tickets.free.moveUp')} className="p-0.5 rounded disabled:opacity-20 hover:bg-white/[0.06]" style={{ color: T3 }}>
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
        <button type="button" disabled={isLast} onClick={() => onMove(1)} aria-label={t('tickets.free.moveDown')} title={t('tickets.free.moveDown')} className="p-0.5 rounded disabled:opacity-20 hover:bg-white/[0.06]" style={{ color: T3 }}>
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="truncate" style={{ color: T1, fontSize: 14, fontWeight: 560 }}>{ticket.name}</span>
          <span className={PILL} style={{ background: badge.bg, border: `1px solid ${badge.border}`, color: badge.color }}>
            {ticket.manuallySoldOut && <Ban className="h-2.5 w-2.5" />}{badge.label}
          </span>
        </div>
        <div className="mt-1.5 tabular-nums flex items-center gap-2 flex-wrap" style={{ color: T3, fontSize: 12.5 }}>
          <span><span style={{ color: T2 }}>{ticket.price}€</span> · {unlimited ? ticket.ticketsSold : `${ticket.ticketsSold}/${ticket.maxTickets}`} {t('tickets.sold')}</span>
          {ticket.includesDrink && <span className="inline-flex items-center gap-1" style={{ color: POS }}><Wine className="h-3 w-3" />{t('tickets.includesDrink')}</span>}
          {ticket.entryDeadline && <span className="inline-flex items-center gap-1" style={{ color: T2 }}><Clock className="h-3 w-3" />{t('tickets.entryBefore')} {ticket.entryDeadline}</span>}
          {next && <span>{next}</span>}
        </div>
      </div>
      <div className="flex items-center gap-1 flex-none">
        {canOpenNow && (
          <Button variant="ghost" size="sm" onClick={onOpenSale} className="h-8 px-2 text-[12px] hover:bg-[rgba(52,211,153,0.12)]" style={{ color: POS }}>
            <Play className="h-3.5 w-3.5 mr-1" />{t('tickets.free.openNow')}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggleSoldOut}
          title={ticket.manuallySoldOut ? t('tickets.soldOutClear') : t('tickets.markSoldOut')}
          className={ticket.manuallySoldOut ? 'hover:bg-[rgba(52,211,153,0.12)]' : 'hover:bg-[rgba(232,25,44,0.12)]'}
          style={{ color: ticket.manuallySoldOut ? POS : RED }}
        >
          {ticket.manuallySoldOut ? <RotateCcw className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onEdit} className="hover:bg-white/[0.06]" style={{ color: T2 }} aria-label={t('tickets.free.editTitle')}>
          <Pencil className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onDelete} className="hover:bg-[rgba(232,25,44,0.12)]" style={{ color: RED }}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
