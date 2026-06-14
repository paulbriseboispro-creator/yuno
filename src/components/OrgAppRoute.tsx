import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useProfileType } from '@/hooks/useProfileType';

interface OrgAppRouteProps {
  children: React.ReactNode;
}

/**
 * Guard for the standalone Organizer dashboard.
 * Distinct from the legacy /organizer route (talent organizers co-organizing club events).
 *
 * Allowed: profile_type = 'organizer'
 * Anyone else → /auth or /
 *
 * Privacy of an event (public vs private) is now decided at event creation
 * via `events.event_kind`, not at the profile level.
 */
export function OrgAppRoute({ children }: OrgAppRouteProps) {
  const { user, loading: authLoading } = useAuth();
  const { profile, loading: profileLoading, isOrganizer } = useProfileType();
  const location = useLocation();

  if (authLoading || profileLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace state={{ from: location }} />;
  }

  if (!isOrganizer) {
    // Clubs and clients should not be here
    return <Navigate to="/" replace />;
  }

  // Force onboarding completion
  if (profile && !profile.onboardingCompleted && !location.pathname.startsWith('/organizer-app/onboarding')) {
    return <Navigate to="/organizer-app/onboarding" replace />;
  }

  return <>{children}</>;
}
