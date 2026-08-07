import OwnerHelpCenter from './OwnerHelpCenter';
import { DashboardModeProvider } from '@/contexts/DashboardModeContext';
import { agencyHelpCategories } from '@/data/agencyHelpContent';

/**
 * Mode d'emploi de l'espace agence — même moteur que le centre d'aide owner
 * (recherche scorée, quick start, captures zoomables, glossaire), contenu
 * agence. Le mode 'agency' ancre les liens d'action sur /agency-app.
 */
export default function AgencyHelpCenter() {
  return (
    <DashboardModeProvider mode="agency">
      <OwnerHelpCenter categories={agencyHelpCategories} />
    </DashboardModeProvider>
  );
}
