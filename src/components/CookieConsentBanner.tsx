import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  hasDecidedConsent,
  setConsent,
  CONSENT_OPEN_EVENT,
} from '@/lib/consent';

/**
 * Bannière de consentement cookies (ePrivacy / CNIL). Montée une fois, B2C.
 *
 * S'affiche tant qu'aucun choix n'a été fait, ou quand on la rouvre via
 * openConsentSettings() (« Gérer les cookies »). « Refuser » est aussi simple
 * qu'« Accepter » (deux boutons de poids égal) : exigence CNIL. Tant que
 * l'utilisateur n'a pas accepté l'analytics, useVisitorTracking /
 * useAffiliateVisitorTracking ne posent aucun identifiant.
 */
export function CookieConsentBanner() {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [analytics, setAnalytics] = useState(true);

  useEffect(() => {
    // Premier affichage : uniquement si aucun choix n'a encore été fait.
    if (!hasDecidedConsent()) setOpen(true);
    const reopen = () => {
      setShowDetails(true);
      setAnalytics(true);
      setOpen(true);
    };
    window.addEventListener(CONSENT_OPEN_EVENT, reopen);
    return () => window.removeEventListener(CONSENT_OPEN_EVENT, reopen);
  }, []);

  if (!open) return null;

  const acceptAll = () => {
    setConsent({ analytics: true });
    setOpen(false);
  };
  const refuseAll = () => {
    setConsent({ analytics: false });
    setOpen(false);
  };
  const saveChoice = () => {
    setConsent({ analytics });
    setOpen(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={t('cookies.banner.title')}
      className="fixed inset-x-0 bottom-0 z-[70] px-3 pt-3"
      style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}
    >
      <div className="mx-auto max-w-lg rounded-2xl border border-white/10 bg-[#111113] p-4 shadow-2xl">
        <h2 className="text-sm font-semibold text-white">{t('cookies.banner.title')}</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-white/70">
          {t('cookies.banner.body')}{' '}
          <Link to="/legal/cookies" className="underline underline-offset-2 hover:text-white">
            {t('cookies.banner.learnMore')}
          </Link>
        </p>

        {showDetails && (
          <div className="mt-3 space-y-3 rounded-xl bg-white/5 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[13px] font-medium text-white">{t('cookies.banner.necessaryLabel')}</p>
                <p className="text-xs text-white/55">{t('cookies.banner.necessaryDesc')}</p>
              </div>
              <Switch checked disabled aria-label={t('cookies.banner.necessaryLabel')} />
            </div>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[13px] font-medium text-white">{t('cookies.banner.analyticsLabel')}</p>
                <p className="text-xs text-white/55">{t('cookies.banner.analyticsDesc')}</p>
              </div>
              <Switch
                checked={analytics}
                onCheckedChange={setAnalytics}
                aria-label={t('cookies.banner.analyticsLabel')}
              />
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          {showDetails ? (
            <Button className="flex-1" onClick={saveChoice}>
              {t('cookies.banner.save')}
            </Button>
          ) : (
            <>
              <Button className="flex-1" onClick={acceptAll}>
                {t('cookies.banner.acceptAll')}
              </Button>
              <Button variant="outline" className="flex-1" onClick={refuseAll}>
                {t('cookies.banner.refuseAll')}
              </Button>
            </>
          )}
        </div>

        {!showDetails && (
          <button
            type="button"
            onClick={() => setShowDetails(true)}
            className="mt-2 w-full text-center text-xs text-white/55 underline underline-offset-2 hover:text-white/80"
          >
            {t('cookies.banner.customize')}
          </button>
        )}
      </div>
    </div>
  );
}
