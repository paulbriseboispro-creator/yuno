-- DJ secured-booking add-on fee (pricing refonte Phase 2 §9.4).
--
-- The club paying a DJ cachet into Yuno escrow is charged a Yuno service fee on top:
-- 4% of the cachet, min 2€, capped at 250€ (computeDjEscrowFeeCents). The DJ still
-- receives 100% of the cachet. We snapshot the fee charged on the contract for records.
alter table public.dj_booking_contracts
  add column if not exists yuno_fee_cents integer not null default 0;

comment on column public.dj_booking_contracts.yuno_fee_cents is
  'Yuno secured-booking service fee charged to the club at escrow checkout (4% of cachet, min 2€, cap 250€). The DJ still receives the full cachet.';
