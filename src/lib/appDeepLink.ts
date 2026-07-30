import { isNative } from '@/lib/native';

/**
 * Ouvre un chemin Yuno « app d'abord » depuis une page web publique : sur
 * mobile web on tente le scheme yuno:// (NativeBridge reprend le path et ses
 * params de tracking) ; si l'app ne prend pas la main sous ~1,4 s, on reste
 * sur le web (navigation SPA). Dans l'app native ou sur desktop : navigation
 * directe. Utilisé par les pages Agenda publiques (promoteur, agence).
 */
export function smartOpenEvent(webPath: string, navigate: (p: string) => void) {
  if (isNative()) {
    navigate(webPath);
    return;
  }
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  if (!isMobile) {
    navigate(webPath);
    return;
  }

  let opened = false;
  const markOpened = () => { opened = true; };
  const onVisibility = () => { if (document.hidden) markOpened(); };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', markOpened);
  window.addEventListener('blur', markOpened);

  window.location.href = `yuno://open?path=${encodeURIComponent(webPath)}`;

  window.setTimeout(() => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', markOpened);
    window.removeEventListener('blur', markOpened);
    if (!opened) navigate(webPath);
  }, 1400);
}
