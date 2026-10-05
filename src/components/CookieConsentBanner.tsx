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
import { TICKETING_ORIGIN, onCrmHost } from '@/lib/productHost';

/**
 * Deux habits pour le même bandeau : sombre sur yunoapp.eu (DA publique), clair
 * sur crm.yunoapp.eu (DA de Yuno CRM — src/lib/productHost.ts). Même texte, même
 * choix, même stockage ; seuls les tons changent.
 */
const DARK = {
  card: 'border-white/10 bg-[#111113]',
  title: 'text-white',
  body: 'text-white/70',
  link: 'hover:text-white',
  panel: 'bg-white/5',
  label: 'text-white',
  hint: 'text-white/55',
  customize: 'text-white/55 hover:text-white/80',
  switch: undefined as string | undefined,
};
const CRM = {
  card: 'border-[#E6DFDD] bg-white',
  title: 'text-[#1A1414]',
  body: 'text-[#6B6264]',
  link: 'hover:text-[#1A1414]',
  panel: 'bg-[#F7F4F3]',
  label: 'text-[#1A1414]',
  hint: 'text-[#857B7D]',
  customize: 'text-[#857B7D] hover:text-[#1A1414]',
  // Le rond de l'interrupteur suit le fond de la carte, blanc ici.
  switch: '[&>span]:bg-white' as string | undefined,
};
const CRM_PRIMARY = 'h-10 flex-1 rounded-full text-sm font-semibold text-white';
const CRM_PRIMARY_STYLE = { background: 'linear-gradient(110deg, #E3141B 0%, #F2392A 45%, #FF6B35 100%)' };
const CRM_SECONDARY = 'h-10 flex-1 rounded-full border-[1.5px] border-[#E6DFDD] bg-white text-sm font-semibold text-[#1A1414] hover:bg-[#F7F4F3]';

/**
 * Bannière de consentement cookies (ePrivacy / CNIL). Montée une fois, B2C.
 *
 * S'affiche tant qu'aucun choix n'a été fait, ou quand on la rouvre via
 * openConsentSettings() (« Gérer les cookies »). « Refuser » est aussi simple
 * qu'« Accepter » (deux boutons de poids égal) : exigence CNIL. Tant que
 * l'utilisateur n'a pas accepté l'analytics, useVisitorTracking /
 * useAffiliateVisitorTracking ne posent aucun identifiant ; tant qu'il n'a pas
 * accepté la publicité, aucun pixel Meta n'est chargé et aucun achat n'est
 * envoyé à Meta côté serveur (src/lib/metaPixel.ts, _shared/meta-capi.ts).
 */
export function CookieConsentBanner() {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [analytics, setAnalytics] = useState(true);
  const [marketing, setMarketing] = useState(true);

  useEffect(() => {
    // Premier affichage : uniquement si aucun choix n'a encore été fait.
    if (!hasDecidedConsent()) setOpen(true);
    const reopen = () => {
      setShowDetails(true);
      setAnalytics(true);
      setMarketing(true);
      setOpen(true);
    };
    window.addEventListener(CONSENT_OPEN_EVENT, reopen);
    return () => window.removeEventListener(CONSENT_OPEN_EVENT, reopen);
  }, []);

  if (!open) return null;
  const crm = onCrmHost();
  const tone = crm ? CRM : DARK;

  const acceptAll = () => {
    setConsent({ analytics: true, marketing: true });
    setOpen(false);
  };
  const refuseAll = () => {
    setConsent({ analytics: false, marketing: false });
    setOpen(false);
  };
  const saveChoice = () => {
    setConsent({ analytics, marketing });
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
      <div className={`mx-auto max-w-lg rounded-2xl border p-4 shadow-2xl ${tone.card}`}>
        <h2 className={`text-sm font-semibold ${tone.title}`}>{t('cookies.banner.title')}</h2>
        <p className={`mt-1.5 text-[13px] leading-relaxed ${tone.body}`}>
          {t('cookies.banner.body')}{' '}
          {crm ? (
            // La politique vit sur yunoapp.eu : un nouvel onglet, pour ne pas quitter la connexion.
            <a href={`${TICKETING_ORIGIN}/legal/cookies`} target="_blank" rel="noopener noreferrer" className={`underline underline-offset-2 ${tone.link}`}>
              {t('cookies.banner.learnMore')}
            </a>
          ) : (
            <Link to="/legal/cookies" className={`underline underline-offset-2 ${tone.link}`}>
              {t('cookies.banner.learnMore')}
            </Link>
          )}
        </p>

        {showDetails && (
          <div className={`mt-3 space-y-3 rounded-xl p-3 ${tone.panel}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className={`text-[13px] font-medium ${tone.label}`}>{t('cookies.banner.necessaryLabel')}</p>
                <p className={`text-xs ${tone.hint}`}>{t('cookies.banner.necessaryDesc')}</p>
              </div>
              <Switch checked disabled className={tone.switch} aria-label={t('cookies.banner.necessaryLabel')} />
            </div>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className={`text-[13px] font-medium ${tone.label}`}>{t('cookies.banner.analyticsLabel')}</p>
                <p className={`text-xs ${tone.hint}`}>{t('cookies.banner.analyticsDesc')}</p>
              </div>
              <Switch
                checked={analytics}
                onCheckedChange={setAnalytics}
                className={tone.switch}
                aria-label={t('cookies.banner.analyticsLabel')}
              />
            </div>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className={`text-[13px] font-medium ${tone.label}`}>{t('cookies.banner.marketingLabel')}</p>
                <p className={`text-xs ${tone.hint}`}>{t('cookies.banner.marketingDesc')}</p>
              </div>
              <Switch
                checked={marketing}
                onCheckedChange={setMarketing}
                className={tone.switch}
                aria-label={t('cookies.banner.marketingLabel')}
              />
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          {crm ? (
            showDetails ? (
              <button type="button" className={CRM_PRIMARY} style={CRM_PRIMARY_STYLE} onClick={saveChoice}>
                {t('cookies.banner.save')}
              </button>
            ) : (
              <>
                <button type="button" className={CRM_PRIMARY} style={CRM_PRIMARY_STYLE} onClick={acceptAll}>
                  {t('cookies.banner.acceptAll')}
                </button>
                <button type="button" className={CRM_SECONDARY} onClick={refuseAll}>
                  {t('cookies.banner.refuseAll')}
                </button>
              </>
            )
          ) : showDetails ? (
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
            className={`mt-2 w-full text-center text-xs underline underline-offset-2 ${tone.customize}`}
          >
            {t('cookies.banner.customize')}
          </button>
        )}
      </div>
    </div>
  );
}
