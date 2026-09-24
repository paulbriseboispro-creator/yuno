import { Moon, Sun } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useLanguage } from '@/contexts/LanguageContext';
import { originOf, useProTheme, type ProThemePref } from '@/lib/proTheme';
import { cn } from '@/lib/utils';

const OPTIONS: { value: ProThemePref; icon: LucideIcon; key: string }[] = [
  { value: 'light', icon: Sun, key: 'proTheme.light' },
  { value: 'dark', icon: Moon, key: 'proTheme.dark' },
];

/**
 * Réglage « Apparence » des dashboards pro : Clair / Sombre (le sombre est le
 * défaut, un troisième choix « Système » n'apportait rien de plus).
 * Une seule implémentation, posée au pied de CHAQUE barre latérale pro
 * (club, manager, organisateur, agence, affilié, promoteur, DJ) et dans la
 * barre du super admin. Quand la barre est repliée en icônes, le sélecteur
 * devient un bouton unique qui bascule clair ⇄ sombre. Chaque bouton passe
 * son centre à `setPref` : c'est de là que part le cercle de la transition.
 */
export function ProThemeSegmented({ className }: { className?: string }) {
  const { t } = useLanguage();
  const { pref, setPref } = useProTheme();
  return (
    <div
      role="radiogroup"
      aria-label={t('proTheme.title')}
      className={cn('grid grid-cols-2 gap-0.5 rounded-lg border border-white/[0.08] bg-white/[0.03] p-0.5', className)}
    >
      {OPTIONS.map(({ value, icon: Icon, key }) => {
        const on = pref === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={(e) => setPref(value, originOf(e.currentTarget))}
            className={cn(
              'flex h-7 min-w-0 items-center justify-center gap-1.5 rounded-md text-[11.5px] font-medium transition-colors',
              on
                ? 'bg-white/[0.10] text-white shadow-[0_1px_2px_rgba(0,0,0,0.12)]'
                : 'text-white/45 hover:bg-white/[0.05] hover:text-white/80',
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{t(key)}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Libellé « Apparence » au-dessus du sélecteur. */
export function ProThemeField({ className }: { className?: string }) {
  const { t } = useLanguage();
  return (
    <div className={className}>
      <p className="mb-1.5 px-1 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-white/40">{t('proTheme.title')}</p>
      <ProThemeSegmented />
    </div>
  );
}

/** Bouton icône clair ⇄ sombre (barre repliée, en-têtes compacts). */
export function ProThemeIconButton({ className }: { className?: string }) {
  const { t } = useLanguage();
  const { resolved, setPref } = useProTheme();
  const next = resolved === 'light' ? 'dark' : 'light';
  const label = t('proTheme.switchTo').replace('{theme}', t(`proTheme.${next}`).toLowerCase());
  const Icon = resolved === 'light' ? Moon : Sun;
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={(e) => setPref(next, originOf(e.currentTarget))}
            aria-label={label}
            className={cn(
              'inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground',
              className,
            )}
          >
            <Icon className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Ligne « Apparence » à poser dans un <SidebarFooter>. */
export function SidebarProThemeSwitch() {
  const { t } = useLanguage();
  const { resolved, setPref } = useProTheme();
  const next = resolved === 'light' ? 'dark' : 'light';
  const label = t('proTheme.switchTo').replace('{theme}', t(`proTheme.${next}`).toLowerCase());
  const Icon = resolved === 'light' ? Sun : Moon;
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        {/* Barre dépliée : le sélecteur complet. */}
        <div className="px-1 pb-1 group-data-[collapsible=icon]:hidden">
          <ProThemeField />
        </div>
        {/* Barre repliée en icônes : un bouton qui bascule. */}
        <SidebarMenuButton
          size="sm"
          tooltip={label}
          aria-label={label}
          onClick={(e) => setPref(next, originOf(e.currentTarget))}
          className="hidden text-muted-foreground group-data-[collapsible=icon]:flex"
        >
          <Icon />
          <span>{t('proTheme.title')}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
