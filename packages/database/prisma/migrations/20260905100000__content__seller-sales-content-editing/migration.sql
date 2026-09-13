ALTER TABLE content_sales_contents
  ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  ADD COLUMN updated_at timestamptz(3) NOT NULL DEFAULT now();

UPDATE content_sales_contents
SET updated_at = created_at;
