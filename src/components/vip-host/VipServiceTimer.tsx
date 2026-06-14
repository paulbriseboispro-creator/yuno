import { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface VipServiceTimerProps {
  createdAt: string;
  className?: string;
}

/**
 * C7: Shows elapsed time since a VIP order/reservation was created.
 * Updates every second. Changes color based on urgency.
 */
export function VipServiceTimer({ createdAt, className }: VipServiceTimerProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = new Date(createdAt).getTime();
    const update = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [createdAt]);

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const display = minutes > 0
    ? `${minutes}m${seconds.toString().padStart(2, '0')}s`
    : `${seconds}s`;

  // Urgency thresholds
  const isUrgent = minutes >= 10;
  const isWarning = minutes >= 5 && minutes < 10;

  return (
    <div
      className={cn(
        'flex items-center gap-1 text-xs font-mono tabular-nums',
        isUrgent && 'text-destructive font-bold animate-pulse',
        isWarning && 'text-yellow-500 font-semibold',
        !isUrgent && !isWarning && 'text-muted-foreground',
        className
      )}
    >
      <Clock className="h-3 w-3" />
      <span>{display}</span>
    </div>
  );
}
