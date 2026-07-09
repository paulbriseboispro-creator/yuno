import { useEffect } from 'react';
import { CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface ScanOverlayProps {
  result: 'success' | 'error' | 'already' | 'vip_success' | null;
  onDismiss: () => void;
  holderName?: string;
  /** Libellé du badge « validé hors ligne » (scan offline, app Yuno Pro). */
  offlineBadge?: string;
}

export function ScanOverlay({ result, onDismiss, holderName, offlineBadge }: ScanOverlayProps) {
  useEffect(() => {
    if (!result) return;
    // Vibration feedback
    if ('vibrate' in navigator) {
      if (result === 'success' || result === 'vip_success') {
        navigator.vibrate([100, 50, 100]);
      } else if (result === 'error') {
        navigator.vibrate([300, 100, 300]);
      } else if (result === 'already') {
        navigator.vibrate([500]);
      }
    }
    const timer = setTimeout(onDismiss, 2000);
    return () => clearTimeout(timer);
  }, [result, onDismiss]);

  const isSuccess = result === 'success' || result === 'vip_success';
  const isAlready = result === 'already';

  return (
    <AnimatePresence>
      {result && result !== 'already' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center ${
            isSuccess ? 'bg-green-600/90' : 'bg-red-600/90'
          }`}
          onClick={onDismiss}
        >
          <motion.div
            initial={{ scale: 0.5 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          >
            {isSuccess ? (
              <CheckCircle className="h-32 w-32 text-white" strokeWidth={2.5} />
            ) : (
              <XCircle className="h-32 w-32 text-white" strokeWidth={2.5} />
            )}
          </motion.div>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-white text-3xl font-black mt-4 uppercase tracking-wider"
          >
            {isSuccess ? (result === 'vip_success' ? 'VIP' : 'OK') : 'REFUSÉ'}
          </motion.p>
          {holderName && isSuccess && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="text-white/80 text-lg mt-2"
            >
              {holderName}
            </motion.p>
          )}
          {offlineBadge && isSuccess && (
            <motion.span
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
              className="mt-3 inline-flex items-center rounded-full bg-white/15 border border-white/30 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white"
            >
              {offlineBadge}
            </motion.span>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
