import { describe, expect, it, vi } from 'vitest';
import {
  invoiceErrorText, invoiceFailureAlert, issueSaleInvoice, saleInvoiceArgs,
} from '../../../supabase/functions/_shared/sale-invoice.ts';

const TICKET = { kind: 'ticket' as const, id: '11111111-1111-1111-1111-111111111111', eventId: 'e1' };

type Call = { fn: string; args: Record<string, unknown> };

function fakeClient(answer: (fn: string) => { data: unknown; error: unknown } | Error) {
  const calls: Call[] = [];
  return {
    calls,
    client: {
      rpc: vi.fn((fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        const a = answer(fn);
        return a instanceof Error ? Promise.reject(a) : Promise.resolve(a);
      }),
    },
  };
}

describe('saleInvoiceArgs', () => {
  it('fills exactly one sale', () => {
    expect(saleInvoiceArgs(TICKET)).toEqual({
      p_ticket_id: TICKET.id, p_table_reservation_id: null, p_order_id: null,
    });
    expect(saleInvoiceArgs({ kind: 'table', id: 't' })).toEqual({
      p_ticket_id: null, p_table_reservation_id: 't', p_order_id: null,
    });
    expect(saleInvoiceArgs({ kind: 'order', id: 'o' })).toEqual({
      p_ticket_id: null, p_table_reservation_id: null, p_order_id: 'o',
    });
  });
});

describe('invoiceFailureAlert', () => {
  it('shares its dedup key with the SQL sweep (one alert per sale)', () => {
    const a = invoiceFailureAlert(TICKET, { message: 'invoice_seller_unknown', code: 'P0001' }, 'verify-ticket-payment');
    expect(a.p_type).toBe('admin_invoice_failed');
    expect(a.p_dedup_key).toBe(`invoice_failed:ticket:${TICKET.id}`);
    expect(a.p_reference_type).toBe('ticket');
    expect(a.p_event_id).toBe('e1');
    expect(a.p_message).toContain('invoice_seller_unknown');
    expect(a.p_message.length).toBeLessThanOrEqual(480);
    expect(a.p_metadata).toMatchObject({ source: 'verify-ticket-payment', error: 'invoice_seller_unknown · P0001' });
  });

  it('caps a very long error message', () => {
    expect(invoiceFailureAlert(TICKET, 'x'.repeat(2000), 's').p_message.length).toBe(480);
  });
});

describe('invoiceErrorText', () => {
  it('reads PostgREST errors, exceptions and strings', () => {
    expect(invoiceErrorText(null)).toBe('unknown_error');
    expect(invoiceErrorText('boom')).toBe('boom');
    expect(invoiceErrorText(new Error('net down'))).toBe('net down');
    expect(invoiceErrorText({ message: 'duplicate key', code: '23505' })).toBe('duplicate key · 23505');
  });
});

describe('issueSaleInvoice', () => {
  it('returns the number the database assigned, no alert', async () => {
    const { client, calls } = fakeClient(() => ({ data: 'ORG-2026-00001', error: null }));
    await expect(issueSaleInvoice(client, TICKET, 'test')).resolves.toBe('ORG-2026-00001');
    expect(calls.map((c) => c.fn)).toEqual(['issue_sale_invoice']);
  });

  it('alerts instead of swallowing a database refusal', async () => {
    const { client, calls } = fakeClient((fn) =>
      fn === 'issue_sale_invoice'
        ? { data: null, error: { message: 'invoice_sale_not_paid' } }
        : { data: 'alert-id', error: null });
    await expect(issueSaleInvoice(client, TICKET, 'test')).resolves.toBeNull();
    expect(calls.map((c) => c.fn)).toEqual(['issue_sale_invoice', 'emit_admin_notification']);
    expect(calls[1].args.p_dedup_key).toBe(`invoice_failed:ticket:${TICKET.id}`);
  });

  it('alerts when the call itself throws, and never throws itself', async () => {
    const { client, calls } = fakeClient((fn) =>
      fn === 'issue_sale_invoice' ? new Error('fetch failed') : new Error('alert down too'));
    await expect(issueSaleInvoice(client, TICKET, 'test')).resolves.toBeNull();
    expect(calls.map((c) => c.fn)).toEqual(['issue_sale_invoice', 'emit_admin_notification']);
  });

  it('treats an empty answer as a failure', async () => {
    const { client, calls } = fakeClient((fn) =>
      fn === 'issue_sale_invoice' ? { data: null, error: null } : { data: null, error: null });
    await expect(issueSaleInvoice(client, TICKET, 'test')).resolves.toBeNull();
    expect(calls[1].args.p_message).toContain('no_invoice_number');
  });
});
