import { Link } from 'react-router-dom';
import { SidebarHeader, SidebarMenuButton } from '@/components/ui/sidebar';
import { Wordmark } from '@/components/brand/Wordmark';

export interface SidebarIdentityProps {
  /** Destination du clic sur l'en-tête (l'accueil de l'espace). */
  to: string;
  /** Nom du compte : club, organisation, promoteur, agence. Sans nom, le wordmark Yuno. */
  name: string | null | undefined;
  /** Logo ou photo du compte. Sans image, l'icône Yuno. */
  logoUrl: string | null | undefined;
  /** Type d'espace, éventuellement suivi d'un contexte (ville, club promu…). */
  subtitle: string;
}

/**
 * En-tête commun des barres latérales pro : le logo du compte, son nom en
 * rouge Yuno et le type d'espace en dessous. Dessiné d'abord pour l'espace
 * agence, il sert maintenant au club, à l'organisateur et au promoteur —
 * la barre dit à qui appartient le dashboard, pas seulement qui l'édite.
 * Replié en mode icône, seul le logo reste.
 */
export function SidebarIdentity({ to, name, logoUrl, subtitle }: SidebarIdentityProps) {
  return (
    <SidebarHeader className="h-14 justify-center">
      <SidebarMenuButton asChild>
        <Link to={to} className="gap-2.5">
          {logoUrl ? (
            <img src={logoUrl} alt={name ?? ''} className="size-8 rounded-lg shrink-0 object-cover" />
          ) : (
            <img src="/yuno-icon-192.png" alt="Yuno" className="size-8 rounded-lg shrink-0" />
          )}
          <div className="flex flex-col leading-tight min-w-0 group-data-[collapsible=icon]:hidden">
            {name ? (
              <span className="truncate text-sm font-black tracking-wide" style={{ color: '#E8192C' }}>
                {name}
              </span>
            ) : (
              <Wordmark height={14} tone="red" />
            )}
            <span className="truncate text-[10px] text-muted-foreground -mt-0.5">{subtitle}</span>
          </div>
        </Link>
      </SidebarMenuButton>
    </SidebarHeader>
  );
}
