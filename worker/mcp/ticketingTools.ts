// La billetterie d'une soirée Yuno par le serveur MCP : get_ticketing (relire,
// avec les ids) et set_ticketing (poser toute la liste des billets en mode
// libre, rounds et heures d'entrée compris). Tout passe par mcp_write →
// _mcp_ticketing (migration 20261017120000), qui revérifie les droits de la
// Console. set_ticketing n'allume jamais la vente.

import { compactResult } from './compact';
import { rpc } from './db';
import type { McpEnv } from './config';

interface CallEnvelope {
  ok: boolean;
  error?: string;
  call_id?: number;
  space?: { key: string; name: string; kind: string; product: string };
  spaces?: unknown;
  result?: Record<string, unknown> | null;
}

export interface TicketingOutcome { text: string; isError: boolean; code?: string; callId?: number }

/** La page Billetterie de la Console, selon le type d'espace. */
export function ticketingConsoleUrl(kind: string | undefined): string {
  return kind === 'venue' ? 'https://yunoapp.eu/owner/ticketing' : 'https://yunoapp.eu/organizer-app/ticketing';
}

/** Messages d'erreur, écrits pour que l'IA sache quoi faire. */
export function ticketingErrorText(code: string, extra: Record<string, unknown> = {}): string {
  const at = typeof extra.index === 'number' ? ` (ticket ${extra.index} of the list)` : '';
  switch (code) {
    case 'drafts_not_allowed':
      return 'This connection does not include drafts, which also cover ticketing: Yuno cannot change tickets for it. The person can reconnect Yuno in their AI app (the consent screen includes drafts). Meanwhile, give the ticket list to set up in the Console.';
    case 'event_not_found':
      return 'No night of this space matches. list_events gives the nights with their ids and dates.';
    case 'external_event':
      return 'This night is sold on an external ticketing (Shotgun): its tickets are managed there, not in Yuno.';
    case 'write_forbidden':
      return 'This person cannot manage the tickets of this night in the Yuno Console (club owner, manager with the tickets permission, organizer or team editor).';
    case 'event_over':
      return 'This night is over: its tickets can no longer change.';
    case 'ticketing_live':
      return 'The tickets of this night are ON SALE: any change is visible to buyers immediately. Nothing was changed. Call again with apply_to_live: true once the person has confirmed this exact change.';
    case 'mode_has_sales':
      return 'This night already sold tickets in another selling mode (rounds, simple or time slots): switching it to the free-form list would reset those tickets. Change it in the Console instead.';
    case 'tickets_required':
    case 'tickets_count':
      return 'tickets must be a list of 1 to 40 tickets.';
    case 'unknown_ticket_id':
      return `An id does not belong to a ticket of this night${at}. get_ticketing gives the ids; omit id for a new ticket.`;
    case 'duplicate_ticket':
      return `The same ticket id appears twice${at}.`;
    case 'cannot_remove_sold':
      return `These tickets already sold and cannot be removed: ${String(extra.tickets ?? '')}. Keep them in the list (with their id); to stop selling one, set sale "manual" or a sale_ends_at.`;
    case 'quantity_below_sold':
      return `The quantity is below what is already sold${at}: ${String(extra.sold ?? '')} sold.`;
    case 'opens_after_required':
      return `sale "after" needs opens_after: the ref, id or exact name of the ticket that must sell out first${at}.`;
    case 'unknown_opens_after':
      return `opens_after does not match any ticket of the list by ref, id or exact name${at}.`;
    case 'chain_self':
      return `A ticket cannot open after itself${at}.`;
    case 'chain_cycle':
      return `These tickets wait for each other in a loop, so none would ever open${at}. Each round must wait for an earlier one.`;
    case 'date_required':
      return `visibility "at" needs visible_from, and sale "at" needs sale_starts_at${at}.`;
    case 'invalid_ticket':
      return `Invalid ticket${at}: ${String(extra.message ?? '')}.`;
    case 'invalid_args':
      return 'Invalid arguments (often a date that is not ISO 8601, such as "2026-10-20T20:00:00+02:00"). Nothing was changed.';
    case 'rate_limited':
      return 'Too many ticketing changes for this connection today (100). Try again tomorrow or finish in the Console.';
    case 'space_not_allowed':
      return `This space is not part of the connection. Spaces: ${JSON.stringify(extra.spaces ?? [])}.`;
    default:
      return 'The ticketing could not be read or saved on the Yuno side. Nothing was changed. Try again in a moment.';
  }
}

export async function runTicketing(
  env: McpEnv, accessHash: string, tool: 'get_ticketing' | 'set_ticketing', args: Record<string, unknown>,
): Promise<TicketingOutcome> {
  const w = await rpc<CallEnvelope>(env, 'mcp_write', { p_access_hash: accessHash, p_tool: tool, p_args: args }, 28_000);
  if (w.error === 'unauthorized') return { text: 'unauthorized', isError: true, code: 'unauthorized' };
  const res = w.result ?? {};
  if (!w.ok || res.ok === false) {
    const code = String(res.error ?? w.error ?? 'internal');
    return { text: ticketingErrorText(code, { ...res, spaces: w.spaces }), isError: true, code, callId: w.call_id };
  }
  const { ok: _ok, ...view } = res;
  void _ok;
  const live = view.ticketing_on_sale === true;
  const out = {
    ...view,
    space: w.space,
    console_url: ticketingConsoleUrl(w.space?.kind),
    notes: 'status: on_sale, waiting_previous (opens when its opens_after ticket sells out), not_open (opened by hand in the Console), scheduled (sale date ahead), sold_out, hidden, ended. Prices in euros, Yuno service fee not included. quantity null = no limit.',
    ...(tool === 'set_ticketing'
      ? {
          saved: true,
          next: live
            ? 'Saved on a night already on sale: buyers see these tickets now.'
            : 'Saved. Sales are NOT on: the person reviews the tickets on the Console ticketing page (console_url) and switches "Activer la vente" on for this night.',
        }
      : {}),
  };
  return { text: compactResult(out, 60_000), isError: false, callId: w.call_id };
}
