alter table reporting_fulfillment_states
  drop constraint reporting_fulfillment_states_status_check;

alter table reporting_fulfillment_states
  add constraint reporting_fulfillment_states_status_check check (
    status in (
      'PREPARING', 'SHIPPED', 'DELIVERED',
      'CANCELLATION_PENDING_REFUND', 'CANCELLED'
    )
  );
