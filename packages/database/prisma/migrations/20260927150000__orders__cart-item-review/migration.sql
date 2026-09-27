alter table order_cart_items
  add column reviewed_policy_revision integer not null default 0,
  add column reviewed_shipping_hash char(64) not null default '';

update order_cart_items item
set reviewed_policy_revision = cart.reviewed_policy_revision,
    reviewed_shipping_hash = cart.reviewed_shipping_hash
from order_carts cart
where cart.id = item.cart_id;
