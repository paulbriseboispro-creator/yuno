/**
 * Frontend helper for inserting owner-facing staff_notifications.
 * Best-effort — errors are swallowed so they never break the user action.
 */

import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';

export type NotifPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface OwnerNotifPayload {
  venueId: string;
  type: string;
  title: string;
  message: string;
  priority?: NotifPriority;
  targetRole?: string;
  referenceType?: string;
  referenceId?: string;
  eventId?: string;
  metadata?: Record<string, unknown>;
}

export async function insertOwnerNotif(p: OwnerNotifPayload): Promise<void> {
  try {
    await supabase.from('staff_notifications').insert({
      venue_id: p.venueId,
      target_role: p.targetRole ?? 'owner',
      notification_type: p.type,
      title: p.title,
      message: p.message,
      priority: p.priority ?? 'normal',
      reference_type: p.referenceType ?? null,
      reference_id: p.referenceId ?? null,
      event_id: p.eventId ?? null,
      metadata: (p.metadata ?? {}) as Json,
    });
  } catch (e) {
    console.error(`[ownerNotif] ${p.type} failed:`, e);
  }
}

/** Dedup check — has this type+referenceId been fired in the last N hours? */
export async function notifAlreadySent(
  venueId: string,
  type: string,
  referenceId: string,
  withinHours = 24,
): Promise<boolean> {
  try {
    const since = new Date(Date.now() - withinHours * 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from('staff_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('venue_id', venueId)
      .eq('notification_type', type)
      .eq('reference_id', referenceId)
      .gte('created_at', since);
    return (count ?? 0) > 0;
  } catch {
    return false;
  }
}
