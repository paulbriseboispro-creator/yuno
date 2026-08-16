import { useState } from 'react';
import { matchPath, useLocation } from 'react-router-dom';
import { X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  APP_STORE_URL,
  canPromoteApp,
  dismissInstallBar,
  isInstallBarDismissed,
} from '@/lib/appStore';
import { shouldShowLanding } from '@/lib/webHome';
import { AppleLogo } from '@/components/install/AppStoreBadge';

/**
 * Barre fine « Yuno sur iPhone » — web mobile iOS UNIQUEMENT, sur les pages
 * publiques de découverte. Jamais bloquante, jamais un interstitiel :
 * Google pénalise les interstitiels d'app, et un client dans la file du
 * bar ne doit JAMAIS avoir un mur entre lui et sa commande.
 *
 * Où elle apparaît : allowlist stricte ci-dessous (découverte + fiches).
 * Où elle n'apparaît JAMAIS : tunnels d'achat (checkout billets / tables /
 * guest list), commande de boissons au QR, surfaces staff/pro, liens
 * promoteurs & affiliés (trafic Instagram → l'app ne s'ouvre pas depuis
 * leur webview, inutile de polluer), auth.
 *
 * Dismiss mémorisé 14 jours (localStorage). Se pose au-dessus de la
 * BottomNav via la variable CSS --bottom-nav-height qu'elle maintient.
 */
const SHOW_PATTERNS = [
  '/',
  '/explore',
  '/events',
  '/clubs',
  '/djs',
  '/map',
  '/tickets',
  '/vip-tables',
  '/order-drinks',
  '/favorites',
  '/loyalty',
  '/moment/:slug',
  '/club/:slug',
  '/club/:slug/event/:eventId',
  '/events/:host/:eventSlug',
  '/event/:eventId',
  '/dj/:slug',
  '/dj/:slug/past',
  '/o/:slug',
] as const;

export function InstallBar() {
  const { pathname } = useLocation();
  const { t } = useLanguage();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;
  if (!canPromoteApp()) return null;
  if (isInstallBarDismissed()) return null;
  if (!SHOW_PATTERNS.some((p) => matchPath(p, pathname))) return null;
  // À la racine, la landing porte déjà ses propres CTA App Store : pas de doublon.
  if (pathname === '/' && shouldShowLanding()) return null;

  const close = () => {
    dismissInstallBar();
    setDismissed(true);
  };

  return (
    <div
      role="complementary"
      aria-label={t('install.barTitle')}
      className="fixed inset-x-0 z-[55] px-3"
      style={{ bottom: 'calc(var(--bottom-nav-height, 0px) + max(10px, env(safe-area-inset-bottom)))' }}
    >
      <div
        className="mx-auto flex items-center gap-3 max-w-lg"
        style={{
          background: 'rgba(20,20,20,0.92)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          border: '1px solid rgba(255,255,255,0.10)',
          borderRadius: 14,
          padding: '10px 12px',
          boxShadow: '0 16px 40px rgba(0,0,0,0.45)',
        }}
      >
        {/* Tuile logo — même rouge que l'icône de l'app */}
        <div
          className="flex items-center justify-center flex-none font-display font-bold"
          style={{ width: 34, height: 34, borderRadius: 8, background: '#E8192C', color: '#fff', fontSize: 17 }}
          aria-hidden="true"
        >
          Y
        </div>
        <p className="flex-1 min-w-0 font-sans font-medium text-white truncate" style={{ fontSize: '13px' }}>
          {t('install.barTitle')}
        </p>
        <a
          href={APP_STORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 flex-none font-mono font-bold uppercase active:scale-[0.97]"
          style={{
            height: 32,
            padding: '0 13px',
            background: '#E8192C',
            color: '#fff',
            borderRadius: 999,
            fontSize: '10.5px',
            letterSpacing: '0.08em',
            transition: 'transform 160ms cubic-bezier(0.16,1,0.3,1)',
          }}
        >
          <AppleLogo size={12} />
          {t('install.barCta')}
        </a>
        <button
          type="button"
          onClick={close}
          aria-label={t('install.barDismiss')}
          className="flex items-center justify-center flex-none"
          style={{ width: 28, height: 28, borderRadius: 999, color: '#9A9A9A' }}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
