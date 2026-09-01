alter table order_orders
  drop constraint order_orders_status_check;

alter table order_orders
  add constraint order_orders_status_check check (
    status in (
      'PENDING_PAYMENT', 'PAID', 'PAYMENT_REVIEW', 'EXPIRED',
      'CANCELLATION_PENDING_REFUND', 'CANCELLED'
    )
  );
