alter table fulfillment_orders
  drop constraint fulfillment_orders_status_check,
  drop constraint fulfillment_orders_store_check;

alter table fulfillment_orders
  add constraint fulfillment_orders_status_check check (
    status in (
      'ACTION_REQUIRED', 'PREPARING', 'SHIPPED', 'DELIVERED',
      'CANCELLATION_PENDING_REFUND', 'CANCELLED'
    )
  ),
  add constraint fulfillment_orders_store_check check (
    (status = 'ACTION_REQUIRED' and store_id is null) or
    (status <> 'ACTION_REQUIRED' and store_id is not null)
  );

alter table fulfillment_timeline_entries
  drop constraint fulfillment_timeline_status_check;

alter table fulfillment_timeline_entries
  add constraint fulfillment_timeline_status_check check (
    status in (
      'ACTION_REQUIRED', 'PREPARING', 'SHIPPED', 'DELIVERED',
      'CANCELLATION_PENDING_REFUND', 'CANCELLED'
    )
  );
