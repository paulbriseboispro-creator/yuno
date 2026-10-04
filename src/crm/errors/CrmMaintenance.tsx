import { CrmPublicShell } from '@/crm/shell/CrmLayout';
import { MaintenanceScreen } from './ErrorScreens';

/** Maintenance vue depuis la Console CRM (le Worker de l'app la rend pour /crm*). */
export default function CrmMaintenance({ message, onRetry }: { message?: string | null; onRetry: () => void }) {
  return (
    <CrmPublicShell>
      <MaintenanceScreen message={message} onRetry={onRetry} />
    </CrmPublicShell>
  );
}
