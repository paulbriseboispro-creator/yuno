// Gabarit des pages Yuno CRM : la même page sert la Console Club (en-tête
// OwnerHeader, fond de la Console) et la Console Organisateur (OrgPage, la barre
// du layout est déjà là) — le modèle d'IntegrationsSettings.

import type { ReactNode } from 'react';
import { useVenueContext } from '@/hooks/useVenueContext';
import { OwnerHeader } from '@/components/OwnerHeader';
import { OrgPage, OrgPageHeader } from '@/components/org-ui';

export function CrmPageShell({ title, subtitle, actions, backTo, children }: {
  title: string; subtitle?: string; actions?: ReactNode; backTo?: string; children: ReactNode;
}) {
  const { mode } = useVenueContext();
  if (mode === 'organizer') {
    return (
      <OrgPage>
        <OrgPageHeader title={title} subtitle={subtitle} actions={actions} />
        <div className="space-y-5">{children}</div>
      </OrgPage>
    );
  }
  return (
    <div className="min-h-screen pb-28" style={{ background: 'var(--sf-000000)' }}>
      <div className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgb(var(--ink)/.025),transparent 55%)' }} />
      <OwnerHeader title={title} backTo={backTo} rightContent={actions} />
      <div className="relative z-10 mx-auto max-w-[1340px] px-4 sm:px-6 pt-2 space-y-5">
        {subtitle && <p style={{ color: 'rgb(var(--ink)/var(--ink-a58,0.58))', fontSize: 13.5, maxWidth: 720 }}>{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}
