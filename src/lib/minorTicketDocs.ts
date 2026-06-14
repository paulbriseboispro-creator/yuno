import { supabase } from '@/integrations/supabase/client';

// A minor-ticket record, surfaced to owners/organizers next to the matching
// paid purchase. See migration 20260614030000_minor_ticket_docs.sql.
export interface MinorDoc {
  birthDate: string | null;
  docUrl: string | null;
  docName: string | null;
}

// Map key tying a record to a specific buyer on a specific event.
export const minorDocKey = (eventId: string, email: string) =>
  `${eventId}|${email.trim().toLowerCase()}`;

// Age in full years from a YYYY-MM-DD string, or null if unparseable.
export function ageFromBirthDate(dateStr?: string | null): number | null {
  if (!dateStr) return null;
  const birth = new Date(dateStr);
  if (isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

// Fetch the set of (lowercased) buyer emails that have a minor-ticket record on
// the given events — for flagging/filtering email-keyed customer lists.
export async function fetchMinorEmailSet(eventIds: string[]): Promise<Set<string>> {
  const set = new Set<string>();
  if (!eventIds.length) return set;
  const { data, error } = await supabase
    .from('minor_ticket_docs' as any)
    .select('buyer_email')
    .in('event_id', eventIds);
  if (error) {
    console.error('fetchMinorEmailSet failed:', error);
    return set;
  }
  for (const r of (data as any[]) ?? []) {
    if (r.buyer_email) set.add(String(r.buyer_email).trim().toLowerCase());
  }
  return set;
}

// Fetch minor-ticket records for the given events, keyed by lowercased email
// (latest record wins) — for email-keyed customer lists/detail panels.
export async function fetchMinorDocsByEmail(eventIds: string[]): Promise<Map<string, MinorDoc>> {
  const map = new Map<string, MinorDoc>();
  if (!eventIds.length) return map;
  const { data, error } = await supabase
    .from('minor_ticket_docs' as any)
    .select('buyer_email, birth_date, doc_url, doc_name, created_at')
    .in('event_id', eventIds)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('fetchMinorDocsByEmail failed:', error);
    return map;
  }
  for (const r of (data as any[]) ?? []) {
    const email = String(r.buyer_email ?? '').trim().toLowerCase();
    if (email && !map.has(email)) {
      map.set(email, { birthDate: r.birth_date ?? null, docUrl: r.doc_url ?? null, docName: r.doc_name ?? null });
    }
  }
  return map;
}

// Fetch all minor-ticket records for the given events, keyed by event+email.
// RLS already restricts rows to events the caller owns. Latest record wins.
export async function fetchMinorDocsByEvents(eventIds: string[]): Promise<Map<string, MinorDoc>> {
  const map = new Map<string, MinorDoc>();
  if (!eventIds.length) return map;
  const { data, error } = await supabase
    .from('minor_ticket_docs' as any)
    .select('event_id, buyer_email, birth_date, doc_url, doc_name, created_at')
    .in('event_id', eventIds)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('fetchMinorDocsByEvents failed:', error);
    return map;
  }
  for (const r of (data as any[]) ?? []) {
    const key = minorDocKey(r.event_id, r.buyer_email);
    // Ordered newest-first, so only keep the first (latest) per key.
    if (!map.has(key)) {
      map.set(key, { birthDate: r.birth_date ?? null, docUrl: r.doc_url ?? null, docName: r.doc_name ?? null });
    }
  }
  return map;
}
