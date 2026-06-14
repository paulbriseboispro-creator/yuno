import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

interface AnimatedPriceProps {
  value: number;
  className?: string;
  suffix?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

/**
 * Animated price display that smoothly transitions between values
 */
export function AnimatedPrice({ 
  value, 
  className, 
  suffix = '€',
  size = 'lg'
}: AnimatedPriceProps) {
  const [displayValue, setDisplayValue] = useState(value);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (value !== displayValue) {
      setIsAnimating(true);
      const timer = setTimeout(() => {
        setDisplayValue(value);
        setIsAnimating(false);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [value, displayValue]);

  const sizeClasses = {
    sm: 'text-lg font-semibold',
    md: 'text-xl font-bold',
    lg: 'text-2xl font-bold',
    xl: 'text-3xl font-bold'
  };

  return (
    <div className={cn("relative overflow-hidden", className)}>
      <AnimatePresence mode="popLayout">
        <motion.span
          key={displayValue}
          initial={{ y: isAnimating ? 20 : 0, opacity: isAnimating ? 0 : 1 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -20, opacity: 0 }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
          className={cn(
            sizeClasses[size],
            "inline-flex items-baseline tabular-nums"
          )}
        >
          {displayValue.toFixed(2)}
          <span className="ml-1 text-[0.7em]">{suffix}</span>
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

/**
 * Price breakdown row with optional animation
 */
interface PriceRowProps {
  label: string;
  value: number;
  highlight?: boolean;
  strikethrough?: boolean;
  className?: string;
}

export function PriceRow({ 
  label, 
  value, 
  highlight = false,
  strikethrough = false,
  className 
}: PriceRowProps) {
  return (
    <div 
      className={cn(
        "flex items-center justify-between py-1",
        highlight && "text-primary font-semibold",
        strikethrough && "text-muted-foreground line-through",
        className
      )}
    >
      <span className="text-sm">{label}</span>
      <span className={cn("tabular-nums", highlight ? "text-base" : "text-sm")}>
        {value.toFixed(2)} €
      </span>
    </div>
  );
}

/**
 * Total price row with separator
 */
interface TotalRowProps {
  label: string;
  value: number;
  className?: string;
}

export function TotalRow({ label, value, className }: TotalRowProps) {
  return (
    <>
      <div className="border-t border-border my-2" />
      <div className={cn("flex items-center justify-between py-1", className)}>
        <span className="font-semibold">{label}</span>
        <AnimatedPrice value={value} size="md" />
      </div>
    </>
  );
}
