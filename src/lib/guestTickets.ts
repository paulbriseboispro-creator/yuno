// Local "cache" of purchases a guest claimed via /claim, so they show up in
// /my-orders without an account. Each entry is a snapshot captured at claim
// time (after OTP verification). Cleared per-entry once the guest links the
// purchase to a real account.

export interface GuestTicket {
  id: string;
  type: 'order' | 'ticket' | 'table';
  reference: string;
  qrCode?: string;
  eventTitle?: string;
  venueName?: string;
  venueAddress?: string;
  eventStartAt?: string;
  eventPoster?: string;
  roundName?: string;
  ticketType?: string;
  zoneName?: string;
  packName?: string;
  quantity?: number;
  guestCount?: number;
  totalPrice?: number;
  fullName?: string;
  status?: string;
  savedAt: number;
}

const KEY = 'yuno_guest_purchases';

export function getGuestTickets(): GuestTicket[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveGuestTicket(t: Omit<GuestTicket, 'savedAt'>): void {
  try {
    const all = getGuestTickets();
    // Dedup by reference + type — re-claiming refreshes the snapshot.
    const filtered = all.filter((x) => !(x.reference === t.reference && x.type === t.type));
    filtered.unshift({ ...t, savedAt: Date.now() });
    localStorage.setItem(KEY, JSON.stringify(filtered));
  } catch {
    /* storage full or disabled — best effort */
  }
}

export function removeGuestTicket(reference: string, type: string): void {
  try {
    const all = getGuestTickets().filter((x) => !(x.reference === reference && x.type === type));
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

export function hasGuestTickets(): boolean {
  return getGuestTickets().length > 0;
}
