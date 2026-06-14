import { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { Timer } from 'lucide-react';

interface EventCountdownProps {
  startAt: string;
  className?: string;
  compact?: boolean;
}

export function EventCountdown({ startAt, className, compact = false }: EventCountdownProps) {
  const { t } = useLanguage();
  const [remaining, setRemaining] = useState<{ days: number; hours: number; minutes: number } | null>(null);
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    const calc = () => {
      const now = Date.now();
      const start = new Date(startAt).getTime();
      const diff = start - now;

      if (diff <= 0) {
        setIsLive(true);
        setRemaining(null);
        return;
      }

      // Only show if < 7 days
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      if (diff > sevenDays) {
        setRemaining(null);
        setIsLive(false);
        return;
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

      setRemaining({ days, hours, minutes });
      setIsLive(false);
    };

    calc();
    const interval = setInterval(calc, 60_000);
    return () => clearInterval(interval);
  }, [startAt]);

  if (!remaining && !isLive) return null;

  if (isLive) {
    return (
      <span className={cn(
        "inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary",
        className
      )}>
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
        </span>
        {t('countdown.live')}
      </span>
    );
  }

  const parts: string[] = [];
  if (remaining!.days > 0) parts.push(`${remaining!.days}${t('countdown.days')}`);
  if (remaining!.hours > 0) parts.push(`${remaining!.hours}${t('countdown.hours')}`);
  if (remaining!.days === 0 && remaining!.minutes > 0) parts.push(`${remaining!.minutes}${t('countdown.minutes')}`);

  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400",
      compact ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-0.5 text-[11px]",
      "font-semibold",
      className
    )}>
      <Timer className={compact ? "h-2.5 w-2.5" : "h-3 w-3"} />
      {t('countdown.in')} {parts.join(' ')}
    </span>
  );
}
