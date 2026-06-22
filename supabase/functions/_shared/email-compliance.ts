// Marketing-email consent gate for automated/lifecycle marketing emails
// (missed-you, upsell, next-event recommendation).
//
// POLICY: marketing email is sent ONLY to recipients who have explicitly opted in
// to marketing for the relevant venue/organizer (newsletter_subscriptions.opted_in
// = true, created from the checkout opt-in checkbox or a newsletter signup).
// Operational/transactional emails (ticket confirmation, invites, refunds, loyalty,
// waitlist the user joined, ...) do NOT use this gate — they are relationship mail.
//
// FAILS CLOSED: any lookup error returns an empty allowlist, so a transient DB
// failure can never cause marketing to reach a non-consenting recipient.

const PUBLIC_URL =
  Deno.env.get('PUBLIC_URL') || Deno.env.get('APP_BASE_URL') || 'https://yunoapp.eu';

export interface OptInScope {
  venueId?: string | null;
  organizerUserId?: string | null;
}

/** lowercased email -> the venue/organizer scopes they opted in to (with token). */
export type OptInMap = Map<
  string,
  Array<{ venueId: string | null; organizerUserId: string | null; token: string | null }>
>;

export async function loadOptIns(
  admin: any,
  emails: (string | null | undefined)[],
): Promise<OptInMap> {
  const map: OptInMap = new Map();
  const unique = [...new Set((emails.filter(Boolean) as string[]).map((e) => e.toLowerCase()))];
  if (unique.length === 0) return map;

  try {
    for (let i = 0; i < unique.length; i += 200) {
      const chunk = unique.slice(i, i + 200);
      const { data, error } = await admin
        .from('newsletter_subscriptions')
        .select('email, venue_id, organizer_user_id, unsubscribe_token')
        .eq('opted_in', true)
        .in('email', chunk);
      if (error) throw error;
      for (const row of data || []) {
        const e = String(row.email).toLowerCase();
        const arr = map.get(e) || [];
        arr.push({
          venueId: row.venue_id ?? null,
          organizerUserId: row.organizer_user_id ?? null,
          token: row.unsubscribe_token ?? null,
        });
        map.set(e, arr);
      }
    }
  } catch (err) {
    console.error('loadOptIns failed — failing CLOSED (no marketing sent this run):', err);
    return new Map();
  }
  return map;
}

// Returns the unsubscribe token (possibly '') when this email opted in to marketing
// for the given venue/organizer, or null when they have NOT opted in. A null result
// means: do not send this recipient marketing.
export function optInToken(
  map: OptInMap,
  email: string | null | undefined,
  scope: OptInScope,
): string | null {
  if (!email) return null;
  const arr = map.get(email.toLowerCase());
  if (!arr) return null;
  for (const s of arr) {
    if (scope.venueId && s.venueId === scope.venueId) return s.token ?? '';
    if (scope.organizerUserId && s.organizerUserId === scope.organizerUserId) return s.token ?? '';
  }
  return null;
}

/** One-click unsubscribe headers for the Resend payload. Empty when no token. */
export function unsubscribeHeaders(token: string | null): Record<string, string> {
  if (!token) return {};
  const url = `${PUBLIC_URL}/unsubscribe?token=${token}`;
  return {
    'List-Unsubscribe': `<${url}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}
