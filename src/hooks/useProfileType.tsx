import { useState, useEffect } from 'react';
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
 * Used to route between Club dashboard and Organizer/BDE dashboard.
 */
export function useProfileType() {
  const { user, loading: authLoading } = useAuth();
  const [profile, setProfile] = useState<OrgProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('profile_type, organization_name, organization_logo_url, avatar_url, onboarding_completed')
        .eq('id', user.id)
        .maybeSingle();

      if (cancelled) return;
      if (error || !data) {
        // SECURITY: never default to 'club' on failure — that would expose
        // the club dashboard to organizers if a network error occurs.
        // Returning null forces the route guards to deny access.
        setProfile(null);
      } else {
        setProfile({
          profileType: (data.profile_type ?? 'club') as ProfileType,
          organizationName: data.organization_name,
          organizationLogoUrl: data.organization_logo_url,
          avatarUrl: data.avatar_url,
          onboardingCompleted: data.onboarding_completed ?? false,
        });
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  const isOrganizer = profile?.profileType === 'organizer';

  return {
    profile,
    loading: authLoading || loading,
    isOrganizer,
    // Back-compat alias — kept so existing imports don't break.
    isOrganizerOrBde: isOrganizer,
    isClub: profile?.profileType === 'club',
  };
}
