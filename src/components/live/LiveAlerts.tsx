import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Info, XCircle, X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { LiveAlert } from '@/hooks/useLiveNightData';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED = '#E8192C';
const T3  = 'rgba(255,255,255,0.36)';

const severityConfig = {
  info: {
    icon: Info,
    border: 'rgba(96,165,250,0.28)',
    bg:    'rgba(96,165,250,0.08)',
    text:  'rgba(147,197,253,1)',
  },
  warning: {
    icon: AlertTriangle,
    border: 'rgba(251,191,36,0.28)',
    bg:    'rgba(251,191,36,0.08)',
    text:  '#FCD34D',
  },
  critical: {
    icon: XCircle,
    border: 'rgba(232,25,44,0.28)',
    bg:    'rgba(232,25,44,0.08)',
    text:  RED,
  },
};

interface Props {
  alerts: LiveAlert[];
  onDismiss: (id: string) => void;
}

export function LiveAlerts({ alerts, onDismiss }: Props) {
  const { t } = useLanguage();

  if (alerts.length === 0) return null;

  return (
    <div className="space-y-2">
      <AnimatePresence mode="popLayout">
        {alerts.map(alert => {
          const config = severityConfig[alert.severity];
          const Icon = config.icon;
          return (
            <motion.div
              key={alert.id}
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 16 }}
              className="flex items-center gap-3 px-4 py-3 rounded-xl"
              style={{ border: `1px solid ${config.border}`, background: config.bg }}
            >
              <Icon className="h-4 w-4 shrink-0" style={{ color: config.text }} />
              <div className="flex-1 min-w-0">
                <p style={{ color: config.text, fontSize: 13.5, fontWeight: 600 }}>{t(alert.titleKey)}</p>
                <p style={{ color: T3, fontSize: 12 }}>{t(alert.descriptionKey)}</p>
              </div>
              <button
                onClick={() => onDismiss(alert.id)}
                className="p-1.5 rounded-lg cursor-pointer transition-all duration-150"
                style={{ color: T3 }}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
