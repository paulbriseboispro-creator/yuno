import { RequireRole } from './RequireRole';
import { RequireStaffSession } from './RequireStaffSession';

interface VipHostRouteProps {
  children: React.ReactNode;
}

export function VipHostRoute({ children }: VipHostRouteProps) {
  return (
    <RequireRole allowedRoles={['vip_host', 'owner']}>
      <RequireStaffSession 
        allowedRoles={['vip_host']} 
        loginPath="/auth"
      >
        {children}
      </RequireStaffSession>
    </RequireRole>
  );
}
