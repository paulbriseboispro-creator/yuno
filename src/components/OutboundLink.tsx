import type { AnchorHTMLAttributes, MouseEvent } from 'react';
import { openExternal } from '@/lib/native';

/**
 * Lien sortant qui RESTE dans l'app Yuno.
 *
 * En natif (app B2C), un `<a target="_blank">` éjecte l'utilisateur vers Safari
 * système. Ici le clic passe par `openExternal()` → navigateur in-app
 * (SFSafariViewController) : l'utilisateur garde le contexte Yuno et revient
 * d'un geste. Sur le web, comportement identique à un onglet neuf.
 *
 * Le `href` réel reste posé (accessibilité, clic droit, partage, aperçu de lien).
 * Un `onClick` fourni (tracking) s'exécute AVANT la redirection ; s'il appelle
 * `preventDefault()`, la redirection est annulée.
 *
 * NB : nommé `OutboundLink` et pas `ExternalLink` — ce dernier est l'icône
 * lucide-react déjà importée dans plusieurs pages affiliées.
 */
export function OutboundLink({
  href,
  onClick,
  children,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (href && !e.defaultPrevented) {
      e.preventDefault();
      openExternal(href);
    }
  };

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      {...rest}
      onClick={handleClick}
    >
      {children}
    </a>
  );
}
