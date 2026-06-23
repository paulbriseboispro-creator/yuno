-- Fee absorption toggle (pricing refonte Phase 2) — per-merchant choice of WHO pays
-- the Yuno commission at checkout.
--
-- Default false = the fan pays the commission on top of the item price (current
-- behavior, zero change). When true, the merchant absorbs the commission (it is
-- deducted from its net via the Connect application_fee) and the fan pays only the
-- item price. For co-events the CLUB (venue) is the seller of record, so its flag
-- governs the charge.
alter table public.venues
  add column if not exists absorb_yuno_fees boolean not null default false;
alter table public.organizer_profiles
  add column if not exists absorb_yuno_fees boolean not null default false;

-- Per-sale snapshot: was the Yuno commission absorbed by the merchant at purchase
-- time? Stored so REFUNDS can give the fan back the full amount they actually paid
-- (in absorb mode they paid no separate fee), while ANALYTICS keep reading
-- service_fee / management_fee as the commission (club net = gross - commission).
alter table public.tickets
  add column if not exists fee_absorbed boolean not null default false;
alter table public.table_reservations
  add column if not exists fee_absorbed boolean not null default false;
alter table public.orders
  add column if not exists fee_absorbed boolean not null default false;

comment on column public.venues.absorb_yuno_fees is
  'When true, the club absorbs the Yuno commission (fan pays item price only). Default false = fan pays the fee on top.';
comment on column public.orders.fee_absorbed is
  'Snapshot at purchase: true if the merchant absorbed the Yuno commission (fan paid no separate service fee). Drives refund refundability.';
