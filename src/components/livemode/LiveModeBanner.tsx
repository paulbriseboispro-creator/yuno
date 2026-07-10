// Mode Live — bandeau de ré-entrée : visible sur les surfaces client quand le
// client a quitté le takeover mais que la soirée est toujours en cours.
// Fine barre au-dessus de la BottomNav : « ● LIVE — {venue} » → un tap ramène
// au /live. Rendu par le LiveModeProvider (aucun montage par page).
import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { useLiveMode } from '@/contexts/LiveModeContext';
import { transitions } from '@/lib/motion';

// Le bandeau ne s'affiche que sur les surfaces client de flânerie/consultation
// — jamais sur les tunnels de paiement, l'auth ni les surfaces staff/pro.
function isClientSurface(pathname: string): boolean {
  if (
    pathname === '/' ||
    pathname === '/favorites' ||
    pathname === '/my-orders' ||
    pathname === '/profile' ||
    pathname === '/map'
  ) {
    return true;
  }
  return pathname.startsWith('/club/') || pathname.startsWith('/events/');
}

export function LiveModeBanner() {
  const { session, isLive, exited, enterLive } = useLiveMode();
  const { t } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();

  const visible = isLive && exited && !!session && isClientSurface(location.pathname);

  // Publie la hauteur occupée par le bandeau : les pages ajoutent
  // var(--live-banner-offset) à leur padding bas pour ne rien masquer.
  useEffect(() => {
    const root = document.documentElement;
    if (visible) root.style.setProperty('--live-banner-offset', '44px');
    else root.style.removeProperty('--live-banner-offset');
    return () => { root.style.removeProperty('--live-banner-offset'); };
  }, [visible]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          type="button"
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 40, opacity: 0 }}
          transition={transitions.modal}
          onClick={() => {
            enterLive();
            navigate('/live');
          }}
          aria-label={t('live.reenter')}
          className="fixed left-3 right-3 z-40 mx-auto flex max-w-lg items-center justify-center gap-2 py-2"
          style={{
            bottom: 'calc(var(--bottom-nav-height, 64px) + env(safe-area-inset-bottom, 0px) + 6px)',
            background: 'rgba(20,20,20,0.92)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            border: '1px solid rgba(232,25,44,0.5)',
            borderRadius: 8,
            boxShadow: '0 4px 18px rgba(0,0,0,0.5), 0 0 14px rgba(232,25,44,0.18)',
          }}
        >
          {/* Point statique — pas d'animation en boucle (AMOLED/batterie) */}
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#E8192C' }} />
          <span
            className="truncate font-mono font-bold uppercase text-white"
            style={{ fontSize: 10.5, letterSpacing: '0.12em' }}
          >
            LIVE — {session?.venueName}
          </span>
          <span
            className="font-mono uppercase"
            style={{ fontSize: 9.5, letterSpacing: '0.08em', color: '#9A9A9A' }}
          >
            {t('live.reenter')}
          </span>
        </motion.button>
      )}
    </AnimatePresence>
  );
}
