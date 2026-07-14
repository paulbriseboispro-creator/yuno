import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { isProApp } from '@/lib/native';
import { useLanguage } from '@/contexts/LanguageContext';
import { useNetworkStatus, OfflinePill } from '@/components/pro/OfflinePill';

/**
 * Barre supérieure fine de l'app Yuno Pro, injectée au-dessus des pages staff
 * UNIQUEMENT quand on tourne dans l'app pro (les pages staff web restent
 * identiques). Retour vers /pro + état réseau.
 */
export function ProShellChrome({ venueName }: { venueName?: string | null }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useLanguage();
  const online = useNetworkStatus();

  if (!isProApp()) return null;
  if (location.pathname === '/pro') return null;

  return (
    <div
      className="sticky top-0 z-40 flex items-center justify-between gap-2 px-3 py-2"
      style={{
        background: 'rgba(5,5,5,0.92)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)',
      }}
    >
      {/* shrink-0 : sans ça un nom de club long comprime le bouton retour et son
          libellé passe à la ligne. -my-2/py-2 : zone de tap de 44px (le staff
          appuie d'une main, dans le noir) sans épaissir la barre outre mesure. */}
      <button
        onClick={() => navigate('/pro')}
        className="inline-flex shrink-0 items-center gap-1.5 -my-2 min-h-[44px] py-2 pr-2 whitespace-nowrap text-xs font-medium text-white/70 active:opacity-70"
      >
        <ArrowLeft className="h-3.5 w-3.5 flex-none" />
        {t('proapp.chrome.home')}
      </button>
      <div className="flex items-center gap-2 min-w-0">
        {venueName && (
          <span className="truncate text-[11px] font-semibold text-white/50 uppercase tracking-wide">{venueName}</span>
        )}
        <OfflinePill label={online ? t('proapp.chrome.online') : t('proapp.chrome.offline')} />
      </div>
    </div>
  );
}
