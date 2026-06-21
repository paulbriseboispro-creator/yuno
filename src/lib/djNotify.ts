import { supabase } from '@/integrations/supabase/client';

/**
 * A2 — notify a DJ's followers that they were added to an event line-up.
 * Fire-and-forget: never blocks the event-save UX. All targeting (geo filter,
 * superfan opt-in, dedup per follower/event/DJ) happens server-side, so it is
 * safe to call on every save even though the line-up is delete+reinserted —
 * already-notified followers are skipped by the edge function.
 */
export function notifyDjLineup(eventId: string, djIds: string[]): void {
  if (!eventId || !djIds || djIds.length === 0) return;
  void supabase.functions
    .invoke('send-push-notification', {
      body: { action: 'dj_lineup', event_id: eventId, dj_ids: djIds },
    })
    .catch(() => { /* best-effort: a failed notification must never break the save */ });
}
