import { RequireRole } from './RequireRole';
import { RequireStaffSession } from './RequireStaffSession';

interface BouncerRouteProps {
  children: React.ReactNode;
}

/**
 * Écran du videur. Le rôle `bouncer` y entre, et aussi l'organisateur, son
 * équipe et son staff (vérifié par RequireStaffSession) : Amoris scanne ses
 * soirées avec le même écran que son videur. RequireRole ne garde ici que la
 * connexion et la suspension.
 */
export function BouncerRoute({ children }: BouncerRouteProps) {
  return (
    <RequireRole allowAnyAuthenticated>
      <RequireStaffSession
        allowedRoles={['bouncer']}
        loginPath="/pro"
        allowOrganizerDoor
      >
        {children}
      </RequireStaffSession>
    </RequireRole>
  );
}
