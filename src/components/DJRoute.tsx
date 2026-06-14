import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useUserRoles } from '@/hooks/useUserRoles';
import { RequirePinSession } from './RequirePinSession';

interface DJRouteProps {
  children: React.ReactNode;
}

export function DJRoute({ children }: DJRouteProps) {
  const { user, loading: authLoading } = useAuth();
  const { roles, loading: rolesLoading } = useUserRoles();

  if (authLoading || rolesLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (!roles.includes('dj')) {
    return <Navigate to="/" replace />;
  }

  return (
    <RequirePinSession allowedRoles={['dj']} dashboardPath="/dj">
      {children}
    </RequirePinSession>
  );
}
