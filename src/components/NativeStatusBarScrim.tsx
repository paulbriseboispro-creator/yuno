import { isNative } from '@/lib/native';

/**
 * Scrim global sous la status bar iOS — app native uniquement.
 * Avec viewport-fit=cover, le contenu scrolle sous l'heure/batterie : ce léger
 * dégradé fixe garde la status bar lisible sur TOUTES les pages, y compris
 * celles dont le contenu passe sous le haut de l'écran. Invisible sur les
 * pages à header sombre (dégradé noir sur fond #0A0A0A) et transparent aux
 * interactions (pointer-events: none).
 */
export function NativeStatusBarScrim() {
  if (!isNative()) return null;
  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: 'calc(env(safe-area-inset-top, 0px) + 6px)',
        background: 'linear-gradient(to bottom, rgba(0,0,0,0.62) 0%, rgba(0,0,0,0.38) 62%, transparent 100%)',
        zIndex: 60,
        pointerEvents: 'none',
      }}
    />
  );
}
