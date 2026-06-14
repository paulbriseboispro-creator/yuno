import { RequireRole } from './RequireRole';
import { RequireStaffSession } from './RequireStaffSession';

interface CloakroomRouteProps {
  children: React.ReactNode;
}

export function CloakroomRoute({ children }: CloakroomRouteProps) {
  return (
    <RequireRole allowedRoles={['cloakroom', 'owner']}>
      <RequireStaffSession 
        allowedRoles={['cloakroom']} 
        loginPath="/auth"
      >
        {children}
      </RequireStaffSession>
    </RequireRole>
  );
}
