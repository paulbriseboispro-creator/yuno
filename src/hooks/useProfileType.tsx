import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

export type ProfileType = 'club' | 'organizer';

export interface OrgProfile {
  profileType: ProfileType;
  organizationName: string | null;
  organizationLogoUrl: string | null;
  avatarUrl: string | null;
  onboardingCompleted: boolean;
}

/**
 * Returns the user's profile_type and organization info.
 * Used to route between Club dashboard and Organizer/Association dashboard.
 */
/**
 * `enabled: false` monte le hook sans interroger la base. `useVenueContext` le
 * traverse désormais sur TOUTES les surfaces, club comprises, pour savoir si
 * l'appelant travaille pour l'organisation de quelqu'un d'autre — sans ce
 * garde-fou, chaque écran de club paierait une lecture de profil dont il n'a
 * aucun usage. Les règles des hooks interdisent l'appel conditionnel, pas le
 * chargement conditionnel.
 */
export function useProfileType(options?: { enabled?: boolean }) {
  const enabled = options?.enabled !== false;
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;

  // Lecture PARTAGÉE (react-query) : ce hook est monté par la barre latérale,
  // l'en-tête, les gardes et plusieurs pages de la Console — chacun relisait
  // le même profil (jusqu'à 5 requêtes identiques par navigation).
  const query = useQuery({
    queryKey: ['profile-type', userId],
    enabled: enabled && !authLoading && !!userId,
    staleTime: 60_000,
    queryFn: async (): Promise<OrgProfile | null> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('profile_type, organization_name, organization_logo_url, avatar_url, onboarding_completed')
        .eq('id', userId!)
        .maybeSingle();
      // SECURITY: never default to 'club' on failure — that would expose
      // the club dashboard to organizers if a network error occurs.
      // Returning null forces the route guards to deny access.
      if (error || !data) return null;
      return {
        profileType: (data.profile_type ?? 'club') as ProfileType,
        organizationName: data.organization_name,
        organizationLogoUrl: data.organization_logo_url,
        avatarUrl: data.avatar_url,
        onboardingCompleted: data.onboarding_completed ?? false,
      };
    },
  });

  const profile = enabled && userId ? query.data ?? null : null;
  const loading = enabled ? authLoading || (!!userId && query.isPending) : false;
  const isOrganizer = profile?.profileType === 'organizer';

  return {
    profile,
    loading,
    isOrganizer,
    // Back-compat alias — kept so existing imports don't break.
    isOrganizerOrBde: isOrganizer,
    isClub: profile?.profileType === 'club',
  };
}
