alter table inventory_reservations
  add column payment_attempt_id uuid,
  add column hold_lease_until timestamptz(3),
  add constraint inventory_reservation_hold_pair_check
    check ((payment_attempt_id is null) = (hold_lease_until is null));
