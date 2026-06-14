import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type StaffContext =
  | { kind: 'venue'; venueId: string; venueName: string | null }
  | { kind: 'organizer'; organizerUserId: string; organizerName: string | null; eventIds: string[] }
  | { kind: 'none' };

/**
 * Unified hook for staff (barman/bouncer/cloakroom).
 * Returns the staff's working context: either a club venue OR an organizer with their event scope.
 * Used by all staff dashboards to handle both club-employed and organizer-employed staff.
 */
export function useStaffContext() {
  const [context, setContext] = useState<StaffContext>({ kind: 'none' });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { setLoading(false); return; }

        // 1. Check if staff is linked to a venue (legacy club staff)
        const { data: profile } = await supabase
          .from('profiles')
          .select('venue_id')
          .eq('id', user.id)
          .maybeSingle();

        if (profile?.venue_id) {
          const { data: venue } = await supabase
            .from('venues').select('name').eq('id', profile.venue_id).maybeSingle();
          if (!cancelled) {
            setContext({
              kind: 'venue',
              venueId: profile.venue_id,
              venueName: venue?.name ?? null,
            });
          }
          return;
        }

        // 2. Otherwise check if staff is linked to an organizer
        const { data: orgStaff } = await supabase
          .from('org_staff')
          .select('organizer_user_id')
          .eq('user_id', user.id)
          .eq('invitation_status', 'accepted')
          .maybeSingle();

        if (orgStaff?.organizer_user_id) {
          const [{ data: orgProfile }, { data: events }] = await Promise.all([
            supabase.from('profiles').select('organization_name').eq('id', orgStaff.organizer_user_id).maybeSingle(),
            supabase.from('events').select('id')
              .or(`organizer_user_id.eq.${orgStaff.organizer_user_id},partner_organizer_id.eq.${orgStaff.organizer_user_id}`)
              .eq('is_active', true),
          ]);
          if (!cancelled) {
            setContext({
              kind: 'organizer',
              organizerUserId: orgStaff.organizer_user_id,
              organizerName: orgProfile?.organization_name ?? null,
              eventIds: (events ?? []).map(e => e.id),
            });
          }
          return;
        }

        if (!cancelled) setContext({ kind: 'none' });
      } catch (e) {
        console.error('useStaffContext error:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { context, loading };
}
