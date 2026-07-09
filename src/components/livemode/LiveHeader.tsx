// Mode Live — header plein écran : venue + événement + heure de fin, chip
// top-100 (client_scores) et sortie discrète. Passe en état LAST CALL à
// end_at − 45 min (accent rouge, purement client).
import { X, Radio } from 'lucide-react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { useLiveMode } from '@/contexts/LiveModeContext';
import { transitions } from '@/lib/motion';

const TIER_COLORS: Record<string, string> = {
  platinum: '#B9E8F5',
  gold: '#FBBF24',
  silver: '#C0C0C8',
  bronze: '#CD7F32',
};

export function LiveHeader({ lastCall }: { lastCall: boolean }) {
  const { t, language } = useLanguage();
  const { session, exitLive } = useLiveMode();
  const navigate = useNavigate();

  if (!session) return null;

  const endTime = new Date(session.eventEndAt).toLocaleTimeString(
    language === 'en' ? 'en-GB' : language === 'es' ? 'es-ES' : 'fr-FR',
    { hour: '2-digit', minute: '2-digit' }
  );
  const showTopChip = session.clientRank !== null && session.clientRank <= 100 && session.clientTier;

  const handleExit = () => {
    exitLive();
    navigate('/', { replace: true });
  };

  return (
    <header
      className="sticky top-0 z-40 border-b backdrop-blur-md"
      style={{
        background: 'rgba(10,10,10,0.86)',
        borderColor: lastCall ? 'rgba(232,25,44,0.45)' : 'rgba(255,255,255,0.08)',
        paddingTop: 'env(safe-area-inset-top, 0px)',
      }}
    >
      <div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-3">
        {/* Point live statique (pas d'animation en boucle — AMOLED/batterie) */}
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
          style={{
            background: 'rgba(232,25,44,0.12)',
            border: '1px solid rgba(232,25,44,0.4)',
          }}
        >
          <Radio className="h-4 w-4" style={{ color: '#E8192C' }} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="font-mono font-bold uppercase"
              style={{ fontSize: 10, letterSpacing: '0.14em', color: '#E8192C' }}
            >
              {lastCall ? t('live.lastCall.title') : 'LIVE'}
            </span>
            {showTopChip && (
              <span
                className="font-mono font-bold uppercase rounded-full px-1.5 py-0.5"
                style={{
                  fontSize: 9,
                  letterSpacing: '0.1em',
                  color: TIER_COLORS[session.clientTier!] ?? '#E5E5E5',
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.12)',
                }}
              >
                {session.clientTier!.toUpperCase()} · TOP {session.clientRank}
              </span>
            )}
          </div>
          <h1
            className="font-display font-bold uppercase truncate text-white"
            style={{ fontSize: 18, letterSpacing: '-0.01em', lineHeight: 1.1 }}
          >
            {session.venueName}
          </h1>
          <p
            className="font-mono uppercase truncate"
            style={{ fontSize: 10, letterSpacing: '0.08em', color: '#9A9A9A' }}
          >
            {session.eventTitle} · {t('live.endsAt').replace('{time}', endTime)}
          </p>
        </div>

        <motion.button
          type="button"
          onClick={handleExit}
          aria-label={t('live.backToApp')}
          whileTap={{ scale: 0.94 }}
          transition={transitions.pressFeedback}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
        >
          <X className="h-4 w-4 text-white" />
        </motion.button>
      </div>

      {lastCall && (
        <div
          className="px-4 pb-2 font-mono uppercase text-center"
          style={{ fontSize: 10, letterSpacing: '0.1em', color: '#E8192C' }}
        >
          {t('live.lastCall.subtitle')}
        </div>
      )}
    </header>
  );
}
