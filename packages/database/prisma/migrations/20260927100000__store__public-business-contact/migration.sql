ALTER TABLE store_stores
  ADD COLUMN public_contact_phone varchar(11);

ALTER TABLE store_stores
  ADD CONSTRAINT store_stores_public_contact_phone_format
  CHECK (public_contact_phone IS NULL OR public_contact_phone ~ '^0[1-9][0-9]{9}$');
