/**
 * Yuno Tickets › Analyses — les Analyses de Yuno CRM (Ventes, Trafic,
 * Communauté, Guest list, Parcours client) dans la Console Club, Manager et
 * Organisateur, sur les ventes Yuno (src/tickets/analytics, migration
 * 20261109300000). Demande de Paul du 22/10 : « tout doit être pareil, ajuste
 * juste les couleurs et les polices à Yuno Tickets ».
 *
 * La coquille : l'en-tête de page de la Console Club et Manager (OwnerHeader ;
 * la Console Organisateur a déjà le sien, au niveau du layout, et deux cloches
 * ouvriraient deux fois le même canal temps réel), le conteneur `.ya` qui porte
 * le thème (theme.css), et la section de textes `tixana`, chargée à la demande.
 */
import type { ReactNode } from 'react';
import { OwnerHeader } from '@/components/OwnerHeader';
import { useLanguage, useLocaleSection } from '@/contexts/LanguageContext';
import { useDashboardMode } from '@/contexts/DashboardModeContext';
import { AnalyticsPage } from '@/tickets/analytics/AnalyticsPage';
import { JourneyPage } from '@/tickets/analytics/journey/JourneyPage';
import '@/tickets/analytics/theme.css';

function Shell({ children }: { children: ReactNode }) {
  const ready = useLocaleSection('tixana');
  const { t } = useLanguage();
  const { mode } = useDashboardMode();
  return (
    <>
      {mode !== 'organizer' && <OwnerHeader title={t('nav.analyses')} />}
      <div className="ya" style={{ display: 'flex', flexDirection: 'column', width: '100%', minWidth: 0 }}>
        {ready ? children : <ShellSkeleton />}
      </div>
    </>
  );
}

function ShellSkeleton() {
  return (
    <div style={{ width: '100%', maxWidth: 1280, margin: '0 auto', boxSizing: 'border-box', padding: 'clamp(24px,3vw,36px) clamp(16px,3vw,40px)', display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div className="ya-skel" style={{ height: 14, width: 180 }} />
      <div className="ya-skel" style={{ height: 36, width: 'min(420px, 80%)', borderRadius: 12 }} />
      <div className="ya-skel" style={{ height: 44, width: 'min(560px, 100%)', borderRadius: 99 }} />
      <div className="ya-skel" style={{ height: 420, borderRadius: 28 }} />
    </div>
  );
}

export default function TicketsAnalyses() {
  return <Shell><AnalyticsPage /></Shell>;
}

export function TicketsJourney() {
  return <Shell><JourneyPage /></Shell>;
}
