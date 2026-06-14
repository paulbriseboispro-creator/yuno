import { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';

interface TicketVisualCardProps {
  children: ReactNode;
  className?: string;
  accentColor?: string;
  variant?: 'default' | 'confirmation';
  animate?: boolean;
}

/**
 * A minimalist ticket-styled card - Yuno signature component
 */
export function TicketVisualCard({ 
  children, 
  className, 
  accentColor,
  variant = 'default',
  animate = true
}: TicketVisualCardProps) {
  const Wrapper = animate ? motion.div : 'div';
  const animationProps = animate ? {
    initial: { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.2 }
  } : {};

  return (
    <Wrapper
      {...animationProps}
      className={cn(
        "relative bg-surface/50 rounded-lg border border-border/30 overflow-hidden",
        "hover:bg-surface/80 hover:border-border/50 transition-all duration-200",
        variant === 'confirmation' && "shadow-lg shadow-black/10 bg-surface",
        className
      )}
    >
      {/* Subtle left accent */}
      <div 
        className="absolute left-0 top-0 bottom-0 w-0.5"
        style={{ backgroundColor: accentColor || 'hsl(var(--primary))' }}
      />
      
      {/* Content */}
      <div className="pl-4 pr-4 py-4">
        {children}
      </div>
    </Wrapper>
  );
}

/**
 * Confirmation ticket design for order/payment confirmation
 */
interface ConfirmationTicketProps {
  children: ReactNode;
  accentColor?: string;
  className?: string;
}

export function ConfirmationTicket({ 
  children, 
  accentColor,
  className 
}: ConfirmationTicketProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ 
        type: "spring", 
        stiffness: 400, 
        damping: 30,
        delay: 0.1
      }}
      className={cn(
        "relative bg-surface rounded-xl overflow-hidden shadow-xl shadow-black/20",
        "border border-border/50",
        className
      )}
    >
      {/* Top accent bar */}
      <div 
        className="h-1 w-full"
        style={{ backgroundColor: accentColor || 'hsl(var(--primary))' }}
      />
      
      {/* Content */}
      <div className="p-6">
        {children}
      </div>
      
      {/* Dashed separator line */}
      <div className="mx-6 border-t border-dashed border-border/40" />
      
      {/* Footer area for price breakdown */}
      <div className="p-6 pt-4 bg-muted/20">
        {/* This space intentionally left for the parent to fill */}
      </div>
    </motion.div>
  );
}
