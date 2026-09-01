ALTER TABLE order_items ADD COLUMN id uuid;

UPDATE order_items SET id = gen_random_uuid() WHERE id IS NULL;

ALTER TABLE order_items
  ALTER COLUMN id SET NOT NULL,
  ALTER COLUMN id SET DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX order_items_id_key ON order_items (id);
