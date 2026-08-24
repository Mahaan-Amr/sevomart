DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "store_memberships"
    WHERE "role" = 'OWNER'
    GROUP BY "seller_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot provision approved sellers: an identity owns more than one store';
  END IF;
END;
$$;

CREATE UNIQUE INDEX "store_memberships_seller_id_key"
  ON "store_memberships"("seller_id");
