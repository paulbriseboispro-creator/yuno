import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { isNative, openExternal, PENDING_CHECKOUT_KEY } from '@/lib/native';
import { useLanguage } from '@/contexts/LanguageContext';

/**
 * Convertit une URL de notification en path interne navigable.
 * Les payloads push portent tantôt des paths ('/my-orders'), tantôt des URLs
 * absolues ('https://yunoapp.eu/l/abc'). Hors domaine Yuno → null (externe).
 */
function toInternalPath(url: string | undefined | null): string | null {
  if (!url) return null;
  if (url.startsWith('/')) return url;
  try {
    const u = new URL(url);
    if (/(^|\.)yunoapp\.eu$/.test(u.hostname) || u.hostname === 'localhost') {
      return u.pathname + u.search + u.hash;
    }
  } catch {
    // URL invalide : ignorer.
  }
  return null;
}

/**
 * Pont natif Capacitor — monté une seule fois dans le Router, ne rend rien.
 * Web : no-op total. Natif iOS :
 *  - notifyAppReady() (Capgo : sans cet appel, rollback auto du bundle OTA)
 *  - deep links yuno://open?path=... et Universal Links → navigation SPA
 *  - tap sur une notification push → navigation vers data.url (le ?pc= de
 *    tracking campagne reste intact, PushClickTracker le consommera)
 *  - fermeture de SafariVC pendant un checkout sans deep-link de retour →
 *    toast d'orientation vers Mes commandes
 */
export function NativeBridge() {
  const navigate = useNavigate();
  const { t } = useLanguage();

  useEffect(() => {
    if (!isNative()) return;

    // Capgo : confirme que le bundle démarre correctement.
    import('@capgo/capacitor-updater')
      .then(({ CapacitorUpdater }) => CapacitorUpdater.notifyAppReady())
      .catch(() => {});

    const cleanups: Array<() => void> = [];

    import('@capacitor/app').then(({ App: CapApp }) => {
      const urlSub = CapApp.addListener('appUrlOpen', ({ url }) => {
        try {
          // Retour checkout : yuno://open?path=<path encodé>
          if (url.startsWith('yuno://')) {
            const parsed = new URL(url);
            const path = parsed.searchParams.get('path');
            sessionStorage.removeItem(PENDING_CHECKOUT_KEY);
            import('@capacitor/browser').then(({ Browser }) => Browser.close()).catch(() => {});
            if (path) navigate(decodeURIComponent(path).startsWith('/') ? decodeURIComponent(path) : '/');
            return;
          }
          // Universal Link https://yunoapp.eu/...
          const internal = toInternalPath(url);
          if (internal) navigate(internal);
        } catch {
          // Deep link malformé : ignorer.
        }
      });
      cleanups.push(() => { urlSub.then((s) => s.remove()); });
    }).catch(() => {});

    import('@capacitor/browser').then(({ Browser }) => {
      // SafariVC fermé à la main pendant un checkout (annulation, ou succès
      // dont le deep-link n'a pas abouti) : on n'auto-navigue pas — on guide.
      const finSub = Browser.addListener('browserFinished', () => {
        if (sessionStorage.getItem(PENDING_CHECKOUT_KEY)) {
          sessionStorage.removeItem(PENDING_CHECKOUT_KEY);
          toast(t('natBridge.checkoutClosedTitle'), {
            description: t('natBridge.checkoutClosedBody'),
            action: { label: t('natBridge.checkoutClosedCta'), onClick: () => navigate('/my-orders') },
            duration: 8000,
          });
        }
      });
      cleanups.push(() => { finSub.then((s) => s.remove()); });
    }).catch(() => {});

    import('@capacitor/push-notifications').then(({ PushNotifications }) => {
      const tapSub = PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        const url = (action.notification.data as { url?: string } | undefined)?.url;
        const internal = toInternalPath(url);
        if (internal) navigate(internal);
        else if (url) openExternal(url);
      });
      // Foreground : iOS affiche déjà la bannière système (presentationOptions),
      // pas de toast doublon.
      cleanups.push(() => { tapSub.then((s) => s.remove()); });
    }).catch(() => {});

    return () => { cleanups.forEach((fn) => fn()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
