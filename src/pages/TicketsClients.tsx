/**
 * Yuno Tickets › Clients, Segments, Imports — les écrans Clients de Yuno CRM
 * (src/tickets/clients, migration 20261109400000) dans la Console Club,
 * Manager et Organisateur, sur la base clients de Yuno Tickets. Demande de
 * Paul du 22/10 : « dans Yuno CRM c'est excellent ; je veux exactement la
 * même chose dans la Console Yuno Tickets ».
 *
 * Même coquille que les Analyses (src/pages/TicketsAnalyses.tsx) : l'en-tête
 * de page de la Console Club et Manager, le conteneur `.ya` du thème, la
 * section de textes `tixana`.
 */
import type { ReactNode } from 'react';
import { OwnerHeader } from '@/components/OwnerHeader';
import { useLanguage, useLocaleSection } from '@/contexts/LanguageContext';
import { useDashboardMode } from '@/contexts/DashboardModeContext';
import ClientsPage from '@/tickets/clients/ClientsPage';
import SegmentsPage from '@/tickets/clients/segments/SegmentsPage';
import ImportsPage from '@/tickets/clients/imports/ImportsPage';
import '@/tickets/analytics/theme.css';

function Shell({ title, children }: { title: string; children: ReactNode }) {
  const ready = useLocaleSection('tixana');
  const { t } = useLanguage();
  const { mode } = useDashboardMode();
  return (
    <>
      {mode !== 'organizer' && <OwnerHeader title={t(title)} />}
      <div className="ya" style={{ display: 'flex', flexDirection: 'column', width: '100%', minWidth: 0 }}>
        {ready ? children : <ShellSkeleton />}
      </div>
    </>
  );
}

function ShellSkeleton() {
  return (
    <div style={{ width: '100%', maxWidth: 1280, margin: '0 auto', boxSizing: 'border-box', padding: '20px clamp(16px,1.6vw,24px)', display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div className="ya-skel" style={{ height: 22, width: 'min(320px, 70%)', borderRadius: 8 }} />
      <div className="ya-skel" style={{ height: 240, borderRadius: 18 }} />
      <div className="ya-skel" style={{ height: 420, borderRadius: 18 }} />
    </div>
  );
}

export default function TicketsClients() {
  return <Shell title="nav.tixClients"><ClientsPage /></Shell>;
}

export function TicketsSegments() {
  return <Shell title="nav.tixSegments"><SegmentsPage /></Shell>;
}

export function TicketsImports() {
  return <Shell title="nav.tixImports"><ImportsPage /></Shell>;
}
