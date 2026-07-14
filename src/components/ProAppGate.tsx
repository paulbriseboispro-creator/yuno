import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Monitor, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { isProApp } from '@/lib/native';
import { openOnWebWithSession } from '@/lib/webHandoff';
import { useLanguage } from '@/contexts/LanguageContext';
import { transitions } from '@/lib/motion';
import { ProAccessGate } from '@/components/ProAccessGate';

/** Routes autorisées dans l'app Yuno Pro (staff + promoteurs). */
const PRO_ALLOWED_PREFIXES = [
  '/pro',
  '/barman',
  '/click-collect',
  '/bouncer',
  '/cloakroom',
  '/vip-host',
  '/promoter',
  '/auth',
  '/setup-pin',
  '/reset-pin',
  '/accept-staff-invitation',
  '/account-suspended',
  '/legal',
];

/** Surfaces pro lourdes qui restent sur le web (desktop). */
const PRO_WEB_ONLY_PREFIXES = ['/manager', '/owner', '/affiliate', '/organizer-app', '/agency-app', '/admin'];

function matches(pathname: string, prefixes: string[]): boolean {
  const clean = pathname.replace(/\/+$/, '') || '/';
  return prefixes.some((p) => clean === p || clean.startsWith(p + '/'));
}

/**
 * Miroir inversé de NativeProGate, pour l'app « Yuno Pro » : les routes staff
 * SONT l'app ; tout le reste (routes B2C) redirige vers /pro. Les dashboards
 * desktop (owner/manager/admin/affiliate/orga) affichent un renvoi vers le web.
 * Sur le web et dans l'app B2C, ce composant est transparent.
 */
/** Surface pro lourde (owner, manager, admin…) : on renvoie vers le web. */
function WebOnlyNotice() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useLanguage();

  // Écran plein écran de l'app Pro : aucun chrome global dans l.app Pro, l'encoche et la
  // barre d'accueil sont à notre charge.
  return (
    <div
      className="min-h-[100dvh] bg-[#050505] flex items-center justify-center px-6"
      style={{
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 24px)',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)',
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={transitions.modal}
        className="max-w-sm w-full text-center"
      >
        <div className="mx-auto mb-6 flex h-14 w-14 flex-none items-center justify-center rounded-2xl bg-white/5 border border-white/10">
          <Monitor className="h-6 w-6 text-white/70" />
        </div>
        <h1 className="text-xl font-bold text-white mb-3 break-words">{t('proapp.webOnlyTitle')}</h1>
        <p className="text-sm text-white/60 leading-relaxed mb-8 break-words">{t('proapp.webOnlyBody')}</p>
        <div className="space-y-3">
          <button
            onClick={() => { void openOnWebWithSession(location.pathname); }}
            className="w-full min-h-[44px] rounded-xl bg-white text-black font-semibold text-sm py-3.5 active:opacity-80 transition-opacity"
          >
            {t('natGate.openWeb')}
          </button>
          <button
            onClick={() => navigate('/pro')}
            className="w-full min-h-[44px] rounded-xl bg-white/5 border border-white/10 text-white/80 font-medium text-sm py-3.5 active:opacity-80 transition-opacity inline-flex items-center justify-center gap-2"
          >
            <ArrowLeft className="h-4 w-4 flex-none" />
            <span className="truncate">{t('proapp.backHome')}</span>
          </button>
        </div>
      </motion.div>
    </div>
  );
}

export function ProAppGate({ children }: { children: ReactNode }) {
  const location = useLocation();

  if (!isProApp()) return <>{children}</>;

  // ProAccessGate enveloppe TOUTE la surface Pro — y compris le renvoi web et la
  // redirection vers /pro : un compte sans rôle pro ne franchit aucune de ces
  // portes. Il laisse lui-même passer /auth et /accept-staff-invitation, sans
  // quoi personne ne pourrait se connecter ni accepter une invitation staff.
  return (
    <ProAccessGate>
      {matches(location.pathname, PRO_WEB_ONLY_PREFIXES) ? (
        <WebOnlyNotice />
      ) : !matches(location.pathname, PRO_ALLOWED_PREFIXES) ? (
        <Navigate to="/pro" replace />
      ) : (
        children
      )}
    </ProAccessGate>
  );
}
