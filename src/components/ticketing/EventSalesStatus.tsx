import { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { EventSalesStatus as SalesStatusType, getEventSalesStatus, EventWithTicketing } from '@/types/ticketing';
import { Timer, Lock, CheckCircle2, CalendarX2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface EventSalesStatusProps {
  event: Pick<EventWithTicketing, 'presaleStartAt' | 'publicSaleStartAt' | 'waitlistEnabled'> & { endAt?: string | null };
  allRoundsSoldOut?: boolean;
  hasPresaleAccess?: boolean;
  className?: string;
  showCountdown?: boolean;
}

export function EventSalesStatus({ event, allRoundsSoldOut, hasPresaleAccess, className, showCountdown = true }: EventSalesStatusProps) {
  const { t } = useLanguage();
  const [status, setStatus] = useState<SalesStatusType>(() => getEventSalesStatus(event, allRoundsSoldOut));
  const [countdown, setCountdown] = useState('');

  const formatSaleDate = (date: string) =>
    new Intl.DateTimeFormat(undefined, {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(date));

  useEffect(() => {
    const update = () => {
      const newStatus = getEventSalesStatus(event, allRoundsSoldOut);
      setStatus(newStatus);

      // Calculate countdown
      if (newStatus === 'coming_soon') {
        const target = event.presaleStartAt || event.publicSaleStartAt;
        if (target) {
          const diff = new Date(target).getTime() - Date.now();
          if (diff > 0) {
            const days = Math.floor(diff / (1000 * 60 * 60 * 24));
            const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const secs = Math.floor((diff % (1000 * 60)) / 1000);
            setCountdown(
              days > 0
                ? `${String(days).padStart(2, '0')}d ${String(hours).padStart(2, '0')}h ${String(mins).padStart(2, '0')}m`
                : `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
            );
          }
        }
      } else if (newStatus === 'presale' && !hasPresaleAccess) {
        const target = event.publicSaleStartAt;
        if (target) {
          const diff = new Date(target).getTime() - Date.now();
          if (diff > 0) {
            const hours = Math.floor(diff / (1000 * 60 * 60));
            const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const secs = Math.floor((diff % (1000 * 60)) / 1000);
            setCountdown(`${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`);
          }
        }
      }
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [event, allRoundsSoldOut, hasPresaleAccess]);

  if (status === 'public_sale') return null;

  return (
    <div className={cn('rounded-xl border p-4', className, {
      'border-amber-500/30 bg-amber-500/5': status === 'coming_soon',
      'border-primary/30 bg-primary/5': status === 'presale',
      'border-destructive/30 bg-destructive/5': status === 'sold_out',
      'border-white/10 bg-white/[0.03]': status === 'ended',
    })}>
      {status === 'ended' && (
        <div className="text-center space-y-1.5">
          <div className="flex items-center justify-center gap-2">
            <CalendarX2 className="h-5 w-5 text-muted-foreground" />
            <span className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
              {t('salesStatus.ended')}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{t('salesStatus.endedDesc')}</p>
        </div>
      )}

      {status === 'coming_soon' && (
        <div className="text-center space-y-3">
          <div className="flex items-center justify-center gap-2">
            <Timer className="h-5 w-5 text-amber-400" />
            <span className="text-sm font-bold uppercase tracking-wider text-amber-400">
              {t('tickets.comingSoon')}
            </span>
          </div>
          {showCountdown && countdown && (
            <div className="text-2xl font-mono font-bold text-amber-300 tracking-widest">
              {countdown}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {countdown ? t('salesStatus.ticketsAvailableIn') : t('salesStatus.waitlistOpen')}
          </p>

          {event.presaleStartAt && event.publicSaleStartAt && (
            <div className="rounded-lg bg-background/40 px-3 py-2 text-[11px] text-muted-foreground space-y-1 text-left">
              <p>
                {t('tickets.presaleMembersStart')}:{' '}
                <span className="text-foreground font-medium">{formatSaleDate(event.presaleStartAt)}</span>
              </p>
              <p>
                {t('tickets.publicSaleStart')}:{' '}
                <span className="text-foreground font-medium">{formatSaleDate(event.publicSaleStartAt)}</span>
              </p>
            </div>
          )}
        </div>
      )}

      {status === 'presale' && !hasPresaleAccess && (
        <div className="text-center space-y-3">
          <div className="flex items-center justify-center gap-2">
            <Lock className="h-5 w-5 text-primary" />
            <span className="text-sm font-bold uppercase tracking-wider text-primary">
              {t('salesStatus.presaleInProgress')}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{t('salesStatus.presaleMembersOnly')}</p>
          {showCountdown && countdown && (
            <>
              <p className="text-xs text-muted-foreground">{t('salesStatus.publicSaleIn')}</p>
              <div className="text-xl font-mono font-bold text-primary tracking-widest">
                {countdown}
              </div>
            </>
          )}
        </div>
      )}

      {status === 'presale' && hasPresaleAccess && (
        <div className="flex items-center justify-center gap-2 flex-nowrap">
          <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm font-bold text-primary whitespace-nowrap">
            {t('salesStatus.presaleAccess')}
          </span>
          <Badge className="bg-primary/20 text-primary border-0 text-[10px] whitespace-nowrap shrink-0">
            {t('salesStatus.earlyAccess')}
          </Badge>
        </div>
      )}

      {status === 'sold_out' && (
        <div className="text-center">
          <span className="text-sm font-bold uppercase tracking-wider text-destructive">
            {t('tickets.soldOut')}
          </span>
        </div>
      )}
    </div>
  );
}
