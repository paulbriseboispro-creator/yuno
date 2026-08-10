import { type ReactNode } from 'react';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { VenueSelector } from '@/components/VenueSelector';
import { usePromoterData, scopeKey } from '@/contexts/PromoterDataContext';
import { isProApp } from '@/lib/native';
import { T1, T3 } from '@/components/promoter/promoter-ui';

/**
 * Coquille de page de l'espace promoteur (/promoter/*). Vit dans le
 * <SidebarInset> de PromoterLayout. Barre du haut = toggle sidebar (gauche) +
 * sélecteur de portée (droite, seulement multi-clubs). Puis la colonne de
 * contenu centrée sur la vignette ambiante — miroir de DJPage (dj-ui.tsx).
 */
export function PromoterPage({ children, maxWidth = 1100 }: { children: ReactNode; maxWidth?: number }) {
  const { profiles, selectedKey, setSelectedKey } = usePromoterData();
  // Dans l'app Pro, la barre d'onglets flotte au-dessus du contenu : sans cette
  // réserve (hauteur de la barre + marge basse + encoche du bas), le dernier
  // bloc de chaque page finit caché derrière elle.
  const bottomPad = isProApp() ? 'calc(env(safe-area-inset-bottom, 0px) + 92px)' : undefined;
  const scopeOptions = profiles.map(p => ({
    id: scopeKey(p),
    name: p.venue?.name || p.organizerName || 'Organisateur',
    logo_url: p.venue?.logo_url || null,
  }));
  return (
    <div className="min-h-screen pb-24 relative" style={{ background: '#000', paddingBottom: bottomPad }}>
      <div className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(255,255,255,.025),transparent 55%)' }} />
      <div className="relative z-10 flex items-center justify-between gap-2 px-4 sm:px-6 pt-3"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}>
        <SidebarTrigger className="text-white/60 hover:text-white -ml-1" />
        <VenueSelector venues={scopeOptions} selectedVenueId={selectedKey} onSelect={setSelectedKey} />
      </div>
      <div className="relative z-10 mx-auto px-4 sm:px-6 pt-2 space-y-4" style={{ maxWidth }}>
        {children}
      </div>
    </div>
  );
}

// ─── En-tête de page ─────────────────────────────────────────────────────────
export function PromoHeading({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div className="min-w-0">
        <h1 style={{ color: T1, fontSize: 'clamp(20px,2.4vw,26px)', fontWeight: 680, letterSpacing: '-0.02em', margin: 0 }}>
          {title}
        </h1>
        {subtitle && <p style={{ color: T3, fontSize: 13, marginTop: 3 }}>{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}
