import { RequireRole } from './RequireRole';
import { RequireStaffSession } from './RequireStaffSession';

interface BouncerRouteProps {
  children: React.ReactNode;
}

export function BouncerRoute({ children }: BouncerRouteProps) {
  return (
    <RequireRole allowedRoles={['bouncer', 'owner']}>
      <RequireStaffSession 
        allowedRoles={['bouncer']} 
        loginPath="/auth"
      >
        {children}
      </RequireStaffSession>
    </RequireRole>
  );
}
