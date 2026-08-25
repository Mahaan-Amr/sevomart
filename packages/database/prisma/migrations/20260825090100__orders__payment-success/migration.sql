alter table order_orders add column paid_at timestamptz(3);

create table order_state_transitions (
  id uuid primary key,
  order_id uuid not null references order_orders(id) on delete restrict,
  from_status varchar(32),
  to_status varchar(32) not null,
  reason_code varchar(64) not null,
  actor_kind varchar(32) not null,
  correlation_id varchar(128) not null,
  occurred_at timestamptz(3) not null default now()
);

create index order_state_transitions_order_occurred_idx
  on order_state_transitions (order_id, occurred_at);
