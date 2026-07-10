import { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Monitor, ArrowLeft } from 'lucide-react';
import { isNative, isProApp, isProPath } from '@/lib/native';
import { openOnWebWithSession } from '@/lib/webHandoff';
import { useLanguage } from '@/contexts/LanguageContext';
import { transitions } from '@/lib/motion';

/**
 * App native = expérience client B2C uniquement. Les dashboards pro (owner,
 * organisateur, staff, admin, DJ) vivent sur le web : toute route pro ouverte
 * dans l'app native affiche cet écran à la place, avec un renvoi vers le
 * navigateur. Sur le web, ce composant est transparent.
 */
export function NativeProGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useLanguage();

  // Ce gate ne concerne que l'app B2C : dans Yuno Pro, c'est ProAppGate qui
  // gouverne (routes staff autorisées, B2C redirigé vers /pro).
  if (isProApp()) return <>{children}</>;
  if (!isNative() || !isProPath(location.pathname)) return <>{children}</>;

  return (
    <div className="min-h-screen bg-[#050505] flex items-center justify-center px-6">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={transitions.modal}
        className="max-w-sm w-full text-center"
      >
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/5 border border-white/10">
          <Monitor className="h-6 w-6 text-white/70" />
        </div>
        <h1 className="text-xl font-bold text-white mb-3">{t('natGate.title')}</h1>
        <p className="text-sm text-white/60 leading-relaxed mb-8">{t('natGate.body')}</p>
        <div className="space-y-3">
          <button
            onClick={() => { void openOnWebWithSession(location.pathname); }}
            className="w-full rounded-xl bg-white text-black font-semibold text-sm py-3.5 active:opacity-80 transition-opacity"
          >
            {t('natGate.openWeb')}
          </button>
          <button
            onClick={() => navigate('/')}
            className="w-full rounded-xl bg-white/5 border border-white/10 text-white/80 font-medium text-sm py-3.5 active:opacity-80 transition-opacity inline-flex items-center justify-center gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('natGate.backHome')}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
