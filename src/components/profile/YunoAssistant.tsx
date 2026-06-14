import { motion } from 'framer-motion';
import { Sparkles, ArrowRight } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useNavigate } from 'react-router-dom';
import yunoLogo from '@/assets/yuno-logo-red.png';

interface YunoAssistantProps {
  firstName?: string | null;
}

export function YunoAssistant({ firstName }: YunoAssistantProps) {
  const { t } = useLanguage();
  const navigate = useNavigate();

  const greeting = firstName
    ? t('assistant.greeting').replace('{name}', firstName)
    : t('assistant.greetingGeneric');

  const suggestions = [
    t('assistant.suggest1'),
    t('assistant.suggest2'),
    t('assistant.suggest3'),
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-3"
    >
      {/* Callout accent rouge éditorial */}
      <motion.button
        whileTap={{ scale: 0.98 }}
        onClick={() => navigate('/assistant')}
        className="w-full flex items-center gap-3.5 group relative overflow-hidden transition-colors"
        style={{
          background: 'rgba(232,25,44,0.06)',
          border: '1px solid rgba(232,25,44,0.28)',
          borderRadius: 4,
          padding: '16px 18px',
        }}
      >
        <div
          className="h-11 w-11 shrink-0 relative flex items-center justify-center"
          style={{ background: 'rgba(232,25,44,0.10)', borderRadius: 4 }}
        >
          <img src={yunoLogo} alt="Yuno" className="h-6 w-6 object-contain" />
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full animate-pulse" style={{ background: '#E8192C' }} />
        </div>
        <div className="text-left flex-1 relative min-w-0">
          <p className="font-mono uppercase" style={{ fontSize: '9px', letterSpacing: '0.16em', color: '#E8192C' }}>
            {t('assistant.title')}
          </p>
          <p className="font-display font-bold text-white truncate" style={{ fontSize: '16px', letterSpacing: '-0.01em', marginTop: 2 }}>
            {greeting}
          </p>
        </div>
        <div
          className="shrink-0 h-8 w-8 flex items-center justify-center transition-colors"
          style={{ background: 'rgba(232,25,44,0.12)', borderRadius: 3 }}
        >
          <ArrowRight className="h-4 w-4" style={{ color: '#E8192C' }} />
        </div>
      </motion.button>

      {/* Suggestion chips — mono uppercase */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar px-0.5">
        {suggestions.map((s, i) => (
          <motion.button
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + i * 0.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => navigate('/assistant', { state: { initialMessage: s } })}
            className="shrink-0 font-mono uppercase transition-colors"
            style={{
              fontSize: '10px', letterSpacing: '0.06em', color: '#9A9A9A',
              padding: '6px 12px', borderRadius: 999,
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)',
            }}
          >
            {s}
          </motion.button>
        ))}
      </div>
    </motion.div>
  );
}
