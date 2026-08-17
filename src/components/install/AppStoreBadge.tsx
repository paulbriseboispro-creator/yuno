import { useLanguage } from '@/contexts/LanguageContext';
import { APP_STORE_URL, APP_STORE_READY } from '@/lib/appStore';

/**
 * Badge « Télécharger sur l'App Store » — DA publique (pill noire, bord
 * subtil, logo Apple inline). Tant que l'app n'est pas approuvée
 * (APP_STORE_READY=false), rend la variante inerte « Bientôt sur
 * l'App Store » si `showComingSoon`, sinon null.
 */
export function AppStoreBadge({
  showComingSoon = false,
  className = '',
}: {
  showComingSoon?: boolean;
  /** Classes additionnelles (ex. `w-full sm:w-auto` pour les CTA de hero mobile). */
  className?: string;
}) {
  const { t } = useLanguage();

  const inner = (
    <>
      <AppleLogo />
      <span
        className="font-sans font-semibold"
        style={{ fontSize: '14px', letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}
      >
        {APP_STORE_READY ? t('landing.ctaApp') : t('landing.appSoon')}
      </span>
    </>
  );

  const baseStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    height: 48,
    padding: '0 22px',
    borderRadius: 999,
    background: '#FFFFFF',
    color: '#0A0A0A',
    border: '1px solid rgba(255,255,255,0.14)',
    transition: 'transform 160ms cubic-bezier(0.16,1,0.3,1), opacity 160ms',
  };

  if (!APP_STORE_READY) {
    if (!showComingSoon) return null;
    return (
      <span
        className={className}
        style={{ ...baseStyle, background: 'rgba(255,255,255,0.06)', color: '#9A9A9A', border: '1px solid rgba(255,255,255,0.10)' }}
      >
        {inner}
      </span>
    );
  }

  return (
    <a
      href={APP_STORE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`active:scale-[0.97] ${className}`}
      style={baseStyle}
    >
      {inner}
    </a>
  );
}

/** Logo Apple monochrome (hérite de currentColor). */
export function AppleLogo({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 384 512" fill="currentColor" aria-hidden="true">
      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
    </svg>
  );
}
