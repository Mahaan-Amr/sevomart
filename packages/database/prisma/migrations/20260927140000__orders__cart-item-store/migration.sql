alter table order_cart_items add column store_id uuid;

update order_cart_items item
set store_id = cart.store_id
from order_carts cart
where cart.id = item.cart_id;

alter table order_cart_items alter column store_id set not null;

create index order_cart_items_cart_store_idx
  on order_cart_items (cart_id, store_id);
