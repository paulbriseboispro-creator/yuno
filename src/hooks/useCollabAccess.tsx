import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useSubscriptionPlan } from './useSubscriptionPlan';
import { isCollabPlan, FeatureKey, hasFeature } from '@/lib/planFeatures';

/**
 * Returns whether a venue currently in plan `collab` is allowed to use a
 * paid feature in the context of a specific event.
 *
 * Rules:
 *  - Paid plans (essential / pro / elite) → always allowed (PlanGuard handles this).
 *  - Plan `collab` → only allowed if the event is co-organised with a partner organizer
 *    (`partner_organizer_id` set, OR `organizer_user_id` set + venue_id set).
 *  - Plan `core` → never allowed (must upgrade).
 *
 * Use together with PlanGuard / hasFeature for a complete gating story.
 */
export function useCollabAccess(eventId?: string | null) {
  const { plan, loading: planLoading } = useSubscriptionPlan();

  const { data: event, isLoading: eventLoading } = useQuery({
    queryKey: ['collab-access-event', eventId],
    enabled: !!eventId && isCollabPlan(plan),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('events')
        .select('id, venue_id, organizer_user_id, partner_organizer_id, partner_venue_id, event_mode')
        .eq('id', eventId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const isCollab = isCollabPlan(plan);
  const eventIsCollabContext = !!event && (
    !!event.partner_organizer_id ||
    (!!event.organizer_user_id && !!event.venue_id) ||
    !!event.partner_venue_id
  );

  /**
   * For a given feature, determine if the venue can access it for this event.
   * Paid plans bypass collab scoping entirely.
   */
  const canAccessFeature = (feature: FeatureKey): boolean => {
    if (!isCollab) return hasFeature(plan, feature);
    if (!eventId) return false; // collab needs an event context
    if (!eventIsCollabContext) return false;
    return hasFeature('collab', feature);
  };

  return {
    loading: planLoading || (isCollab && !!eventId && eventLoading),
    isCollabPlan: isCollab,
    eventIsCollabContext,
    canAccessFeature,
  };
}
