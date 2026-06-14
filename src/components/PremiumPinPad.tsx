import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Delete, Eye, EyeOff } from 'lucide-react';

interface PremiumPinPadProps {
  title: string;
  subtitle?: string;
  pinLength?: number;
  icon?: React.ReactNode;
  onSubmit: (pin: string) => void;
  onBack?: () => void;
  loading?: boolean;
  error?: string;
  footerContent?: React.ReactNode;
}

export function PremiumPinPad({
  title,
  subtitle,
  pinLength = 6,
  icon,
  onSubmit,
  onBack,
  loading = false,
  error,
  footerContent,
}: PremiumPinPadProps) {
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [shake, setShake] = useState(false);

  // Reset pin on error
  useEffect(() => {
    if (error) {
      setShake(true);
      const t1 = setTimeout(() => setShake(false), 500);
      const t2 = setTimeout(() => setPin(''), 600);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
  }, [error]);

  // Auto-submit when pin is complete
  useEffect(() => {
    if (pin.length === pinLength && !loading) {
      const submittedPin = pin;
      setPin('');
      onSubmit(submittedPin);
    }
  }, [pin, pinLength, loading, onSubmit]);

  const handleDigit = useCallback((digit: string) => {
    if (loading) return;
    setPin(prev => prev.length < pinLength ? prev + digit : prev);
  }, [pinLength, loading]);

  const handleDelete = useCallback(() => {
    if (loading) return;
    setPin(prev => prev.slice(0, -1));
  }, [loading]);

  const handleClear = useCallback(() => {
    if (loading) return;
    setPin('');
  }, [loading]);

  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background relative overflow-hidden">
      {/* Ambient glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[300px] bg-primary/[0.06] rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/3 right-0 w-[300px] h-[300px] bg-primary/[0.04] rounded-full blur-[100px] pointer-events-none" />

      {/* Back button */}
      {onBack && (
        <motion.button
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          onClick={onBack}
          className="absolute top-4 left-4 z-20 h-10 w-10 rounded-full bg-white/[0.05] backdrop-blur-sm border border-white/[0.08] flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/[0.08] transition-all"
          style={{ top: 'max(1rem, env(safe-area-inset-top))' }}
        >
          <ArrowLeft className="h-5 w-5" />
        </motion.button>
      )}

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 relative z-10">
        {/* Icon */}
        {icon && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 20 }}
            className="mb-6"
          >
            {icon}
          </motion.div>
        )}

        {/* Title */}
        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-xl font-bold text-foreground mb-1 text-center"
        >
          {title}
        </motion.h1>
        {subtitle && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="text-sm text-muted-foreground mb-8 text-center max-w-[260px]"
          >
            {subtitle}
          </motion.p>
        )}

        {/* PIN dots */}
        <motion.div
          animate={shake ? { x: [0, -12, 12, -8, 8, -4, 4, 0] } : {}}
          transition={{ duration: 0.4 }}
          className="flex items-center gap-3 mb-3"
        >
          {Array.from({ length: pinLength }).map((_, i) => {
            const filled = i < pin.length;
            const active = i === pin.length;
            return (
              <motion.div
                key={i}
                className={`h-12 w-12 rounded-xl border-2 flex items-center justify-center transition-all duration-200 ${
                  active
                    ? 'border-primary bg-primary/[0.08] shadow-[0_0_15px_rgba(220,38,38,0.15)]'
                    : filled
                    ? 'border-primary/40 bg-primary/[0.06]'
                    : 'border-white/[0.1] bg-white/[0.03]'
                }`}
                animate={filled ? { scale: [1, 1.1, 1] } : {}}
                transition={{ duration: 0.15 }}
              >
                <AnimatePresence mode="wait">
                  {filled && (
                    <motion.div
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0, opacity: 0 }}
                      transition={{ duration: 0.1 }}
                    >
                      {showPin ? (
                        <span className="text-lg font-bold text-primary">{pin[i]}</span>
                      ) : (
                        <div className="h-3 w-3 rounded-full bg-primary shadow-[0_0_8px_rgba(220,38,38,0.4)]" />
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </motion.div>

        {/* Error message */}
        <AnimatePresence>
          {error && (
            <motion.p
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="text-xs text-destructive mb-4 text-center"
            >
              {error}
            </motion.p>
          )}
        </AnimatePresence>

        {/* Loading indicator */}
        {loading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mb-4"
          >
            <div className="h-1 w-32 rounded-full bg-white/[0.06] overflow-hidden">
              <motion.div
                className="h-full bg-primary rounded-full"
                animate={{ x: ['-100%', '100%'] }}
                transition={{ repeat: Infinity, duration: 1, ease: 'easeInOut' }}
                style={{ width: '50%' }}
              />
            </div>
          </motion.div>
        )}

        {/* Numpad */}
        <div className="grid grid-cols-3 gap-3 w-full max-w-[280px] mt-4">
          {digits.map((digit) => (
            <motion.button
              key={digit}
              whileTap={{ scale: 0.9 }}
              onClick={() => handleDigit(digit)}
              disabled={loading}
              className="h-16 w-full rounded-2xl bg-white/[0.04] backdrop-blur-sm border border-white/[0.06] text-xl font-semibold text-foreground hover:bg-white/[0.08] active:bg-primary/[0.12] active:border-primary/30 transition-all duration-150 disabled:opacity-40"
            >
              {digit}
            </motion.button>
          ))}

          {/* Bottom row: toggle visibility / 0 / delete */}
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => setShowPin(!showPin)}
            className="h-16 w-full rounded-2xl bg-white/[0.02] border border-white/[0.04] flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-all"
          >
            {showPin ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </motion.button>

          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => handleDigit('0')}
            disabled={loading}
            className="h-16 w-full rounded-2xl bg-white/[0.04] backdrop-blur-sm border border-white/[0.06] text-xl font-semibold text-foreground hover:bg-white/[0.08] active:bg-primary/[0.12] active:border-primary/30 transition-all duration-150 disabled:opacity-40"
          >
            0
          </motion.button>

          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={handleDelete}
            onDoubleClick={handleClear}
            disabled={loading}
            className="h-16 w-full rounded-2xl bg-white/[0.02] border border-white/[0.04] flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-all disabled:opacity-40"
          >
            <Delete className="h-5 w-5" />
          </motion.button>
        </div>

        {/* Footer links */}
        {footerContent && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="mt-8"
          >
            {footerContent}
          </motion.div>
        )}
      </div>
    </div>
  );
}
