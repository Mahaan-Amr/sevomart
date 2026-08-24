create table inventory_reservations (
  id uuid primary key,
  order_id uuid not null unique,
  store_id uuid not null,
  status varchar(24) not null default 'ACTIVE'
    check (status in ('ACTIVE', 'CONSUMED', 'RELEASED', 'HELD_FOR_REVIEW')),
  expires_at timestamptz(3) not null,
  created_at timestamptz(3) not null default now()
);

create index inventory_reservations_status_expiry_idx
  on inventory_reservations (status, expires_at);

create table inventory_reservation_lines (
  reservation_id uuid not null references inventory_reservations(id) on delete restrict,
  variant_id uuid not null references inventory_levels(variant_id) on delete restrict,
  quantity integer not null check (quantity between 1 and 99),
  primary key (reservation_id, variant_id)
);

create index inventory_reservation_lines_variant_idx
  on inventory_reservation_lines (variant_id);
