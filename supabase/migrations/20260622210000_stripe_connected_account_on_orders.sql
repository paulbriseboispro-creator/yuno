-- Direct charges: store the connected account (club/orga) the charge was created ON.
--
-- With direct charges the Stripe Checkout Session + PaymentIntent live on the
-- CONNECTED account, not the platform. The confirmation (verify-*) and refund
-- (owner-refund / cancel-ticket / staff-cancel) functions therefore need the
-- connected account id to pass `{ stripeAccount }` when retrieving the session
-- or creating the refund.
--
-- NULL = legacy / co-event "separate" charge that sits on the platform account
--        (retrieve/refund on the platform, with reverse_transfer for transfers).
-- NON-NULL = direct charge on this connected account (retrieve/refund with
--            { stripeAccount }, no transfer to reverse).

alter table public.tickets
  add column if not exists stripe_connected_account_id text;

alter table public.orders
  add column if not exists stripe_connected_account_id text;

alter table public.table_reservations
  add column if not exists stripe_connected_account_id text;

comment on column public.tickets.stripe_connected_account_id is
  'Stripe connected account the direct charge was created on (NULL = platform/separate charge).';
comment on column public.orders.stripe_connected_account_id is
  'Stripe connected account the direct charge was created on (NULL = platform/separate charge).';
comment on column public.table_reservations.stripe_connected_account_id is
  'Stripe connected account the direct charge was created on (NULL = platform/separate charge).';
