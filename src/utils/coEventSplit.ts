/**
 * Co-event revenue-split helpers — single source of truth for "your share".
 *
 * Mirrors the backend split model in supabase/functions/_shared/payment-split.ts.
 * The Yuno fee model lives here (not in utils/fees.ts) because it is tied to the
 * co-event split: tickets/tables 4% (min 0.99€), drinks 3%. Stripe-fee and
 * refund math stay in utils/fees.ts.
 *
 * Used by:
 *   - components/owner/co-event/EventInvoicesModule.tsx (single event)
 *   - pages/OwnerAccounting.tsx (aggregated across all events)
 * Keep both on this module so the per-event invoice PDF and the accounting
 * report always agree to the cent.
 */

import { normalizeSplitRules } from '@/lib/splitRules';

export type InvoiceType = 'ticket' | 'table' | 'order';

export interface EffectiveSplit { organizer_pct: number; venue_pct: number; }

export interface ShareResult {
  /** Viewer's share of the net amount (€), rounded to cents. */
  share: number;
  /** Effective percentage applied for the viewer's side. */
  pct: number;
  /** Net amount after Yuno fees (€). */
  net: number;
  /** Yuno service fee on this transaction (€). */
  yuno: number;
}

/** Yuno fee model — kept in sync with supabase/functions/_shared/commission.ts.
 *  BDE events (events.is_bde) keep the 4% rate but a reduced 0.49€ floor.
 *  Tables are additionally capped at 25€; tickets and drinks are uncapped.
 *
 *  ESTIMATE ONLY. This re-derives the fee from today's rate card, so it is wrong
 *  for any transaction billed under a previous one. Use `resolveYunoFee` whenever
 *  the real charged amount is available on the row. */
export function computeYunoFee(type: InvoiceType, gross: number, isBde = false): number {
  if (type === 'order') return Math.round(gross * 0.03 * 100) / 100;
  const withMin = Math.max(isBde ? 0.49 : 0.99, gross * 0.04);
  return type === 'table' ? Math.min(25, withMin) : withMin;
}

/**
 * Yuno fee for a transaction, preferring what was ACTUALLY charged.
 *
 * Accounting must report history, not re-price it. A table booked before the 25€
 * cap shipped was really billed e.g. 80€; recomputing would show 25€ and silently
 * overstate the club's net by 55€. `storedFee` is the persisted commission
 * (`table_reservations.management_fee`), and it wins whenever present. The
 * recompute is only a fallback for rows that predate the column being written.
 */
export function resolveYunoFee(
  type: InvoiceType,
  gross: number,
  storedFee: number | null | undefined,
  isBde = false,
): number {
  const stored = Number(storedFee);
  if (storedFee !== null && storedFee !== undefined && Number.isFinite(stored) && stored >= 0) {
    return Math.round(stored * 100) / 100;
  }
  return computeYunoFee(type, gross, isBde);
}

/** Default split per event mode, mirroring backend defaultSplitForItem(). */
export function defaultSplit(type: InvoiceType, mode: string | null): EffectiveSplit {
  // Drinks ('order') are ALWAYS 100% venue (alcohol licence) — overrides every mode,
  // including org_hosted. Defense in depth, mirrors backend payment-split.ts.
  if (type === 'order') return { organizer_pct: 0, venue_pct: 100 };
  if (mode === 'venue_rental') {
    return type === 'ticket' ? { organizer_pct: 100, venue_pct: 0 } : { organizer_pct: 0, venue_pct: 100 };
  }
  if (mode === 'org_hosted') return { organizer_pct: 100, venue_pct: 0 };
  if (type === 'ticket') return { organizer_pct: 50, venue_pct: 50 };
  if (type === 'table') return { organizer_pct: 0, venue_pct: 100 };
  return { organizer_pct: 0, venue_pct: 100 }; // drinks default to venue
}

/** Normalize the stored revenue_split_rules jsonb into effective percentages. */
export function getEffectiveSplit(rules: any, type: InvoiceType, mode: string | null): EffectiveSplit {
  // Drinks ('order') default to 100% venue, but a stored drinks split is honored: an
  // organizer who attested their alcohol licence can negotiate a drinks share. The
  // attestation gate lives at write time (contract RPC + split editors), so we just
  // read whatever drinks split is stored.
  if (!rules) return defaultSplit(type, mode);
  // Coerce legacy flat { organizer, venue } rows into the canonical nested shape so
  // a global split still produces correct per-category percentages (not the default).
  const norm = normalizeSplitRules(rules);
  if (!norm) return defaultSplit(type, mode);
  const key = type === 'ticket' ? 'tickets' : type === 'table' ? 'tables' : 'drinks';
  const block = norm[key];
  if (!block) return defaultSplit(type, mode);
  const o = Number(block.organizer_pct ?? 0);
  const v = Number(block.venue_pct ?? 0);
  const total = o + v;
  if (total <= 0) return defaultSplit(type, mode);
  return { organizer_pct: (o / total) * 100, venue_pct: (v / total) * 100 };
}

/**
 * Compute the viewer's share for one transaction.
 * @param amount   TTC amount charged to the customer (€).
 * @param type     ticket | table | order.
 * @param side     which party is viewing ('venue' | 'organizer').
 * @param rules    revenue_split_rules jsonb (null → defaults for the mode).
 * @param mode     event_mode (co_event | venue_rental | org_hosted | solo_*).
 * @param storedFee the commission actually charged, when known — see resolveYunoFee.
 */
export function computeShare(
  amount: number,
  type: InvoiceType,
  side: 'venue' | 'organizer',
  rules: any,
  mode: string | null,
  isBde = false,
  storedFee?: number | null,
): ShareResult {
  const yuno = resolveYunoFee(type, amount, storedFee, isBde);
  const net = amount - yuno;
  const split = getEffectiveSplit(rules, type, mode);
  const pct = side === 'venue' ? split.venue_pct : split.organizer_pct;
  const share = Math.round((net * pct) / 100 * 100) / 100;
  return { share, pct, net, yuno };
}
