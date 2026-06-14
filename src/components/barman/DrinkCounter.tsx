import { motion } from 'framer-motion';
import { Wine } from 'lucide-react';

interface DrinkCounterProps {
  served: number;
  total: number;
}

export function DrinkCounter({ served, total }: DrinkCounterProps) {
  const percentage = total > 0 ? (served / total) * 100 : 0;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex items-center gap-2 bg-surface border border-border/50 rounded-lg px-3 py-1.5"
    >
      <Wine className="h-4 w-4 text-primary" />
      <div className="flex items-center gap-1">
        <span className="text-lg font-bold text-primary">{served}</span>
        <span className="text-muted-foreground">/</span>
        <span className="text-lg font-semibold text-foreground">{total}</span>
      </div>
      {/* Mini progress indicator */}
      <div className="w-8 h-1.5 bg-muted rounded-full overflow-hidden ml-1">
        <motion.div
          className="h-full bg-primary rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        />
      </div>
    </motion.div>
  );
}
