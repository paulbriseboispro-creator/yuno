/**
 * Shared helper for inserting owner-facing staff_notifications from edge functions.
 * Use this in any edge function that needs to surface an event to the owner's inbox.
 */

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
  /** Pass supabaseAdmin client — must have service role for RLS bypass */
  client: {
    from: (table: string) => {
      select: (...args: unknown[]) => unknown;
      insert: (payload: unknown) => Promise<{ error: unknown }>;
    };
  };
}

/**
 * Insert a single owner notification. Swallows errors to avoid breaking
 * the parent payment/action flow — notifications are best-effort.
 */
export async function insertOwnerNotif(p: OwnerNotifPayload): Promise<void> {
  try {
    const { error } = await p.client
      .from('staff_notifications')
      .insert({
        venue_id: p.venueId,
        target_role: p.targetRole ?? 'owner',
        notification_type: p.type,
        title: p.title,
        message: p.message,
        priority: p.priority ?? 'normal',
        reference_type: p.referenceType ?? null,
        reference_id: p.referenceId ?? null,
        event_id: p.eventId ?? null,
        metadata: p.metadata ?? {},
        created_at: new Date().toISOString(),
      });
    if (error) {
      console.error(`[owner-notifications] Insert failed for ${p.type}:`, error);
    }
  } catch (e) {
    console.error(`[owner-notifications] Unexpected error for ${p.type}:`, e);
  }
}

/**
 * Check if an owner notification of a given type already exists for a
 * reference_id within the last `withinHours` hours. Used for deduplication
 * on threshold events (sold-out, almost sold-out).
 */
export async function notifAlreadySent(
  client: OwnerNotifPayload['client'],
  venueId: string,
  type: string,
  referenceId: string,
  withinHours = 24,
): Promise<boolean> {
  try {
    const since = new Date(Date.now() - withinHours * 60 * 60 * 1000).toISOString();
    const result = await (client.from('staff_notifications') as any)
      .select('id', { count: 'exact', head: true })
      .eq('venue_id', venueId)
      .eq('notification_type', type)
      .eq('reference_id', referenceId)
      .gte('created_at', since);
    return (result?.count ?? 0) > 0;
  } catch {
    return false;
  }
}
