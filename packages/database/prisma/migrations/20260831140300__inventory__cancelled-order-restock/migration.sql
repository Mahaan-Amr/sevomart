alter table inventory_adjustments
  drop constraint inventory_adjustments_operation_check,
  drop constraint inventory_adjustments_reason_code_check;

alter table inventory_adjustments
  add constraint inventory_adjustments_operation_check check (
    operation in ('REPLACE_ON_HAND', 'RESTORE_CANCELLED_ORDER')
  ),
  add constraint inventory_adjustments_reason_code_check check (
    reason_code in (
      'INITIAL_STOCK', 'MANUAL_COUNT', 'DAMAGED', 'RETURNED_TO_STOCK',
      'CORRECTION', 'ORDER_CANCELLED'
    )
  );

alter table inventory_reservations
  drop constraint inventory_reservations_status_check;

alter table inventory_reservations
  add constraint inventory_reservations_status_check check (
    status in ('ACTIVE', 'CONSUMED', 'RELEASED', 'HELD_FOR_REVIEW', 'CANCELLED')
  );
