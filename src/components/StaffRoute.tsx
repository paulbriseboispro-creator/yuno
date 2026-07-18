import { RequireRole } from './RequireRole';
import { RequireStaffSession } from './RequireStaffSession';

/**
 * Garde des écrans staff transverses (aujourd'hui « Mon compte »), ouverts à
 * n'importe quel poste du club. Les gardes par rôle (BarmanRoute, BouncerRoute…)
 * restent en place pour les dashboards métier : un barman n'a rien à faire sur
 * l'écran de la porte.
 */
export function StaffRoute({ children }: { children: React.ReactNode }) {
  return (
    <RequireRole allowedRoles={['barman', 'bouncer', 'cloakroom', 'vip_host', 'manager', 'owner']}>
      <RequireStaffSession
        allowedRoles={['barman', 'bouncer', 'cloakroom', 'vip_host', 'manager']}
        loginPath="/auth"
      >
        {children}
      </RequireStaffSession>
    </RequireRole>
  );
}
