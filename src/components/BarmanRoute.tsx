import { RequireRole } from './RequireRole';
import { RequireStaffSession } from './RequireStaffSession';

interface BarmanRouteProps {
  children: React.ReactNode;
}

export function BarmanRoute({ children }: BarmanRouteProps) {
  return (
    <RequireRole allowedRoles={['barman', 'owner']}>
      <RequireStaffSession 
        allowedRoles={['barman']} 
        loginPath="/auth"
      >
        {children}
      </RequireStaffSession>
    </RequireRole>
  );
}
