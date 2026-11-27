-- Products an outside dataset may only add (ICatalogProduct.addOnly).
--
-- catalog_source: the dataset that added the row ('checkjebon' for Lidl's
-- store assortment that lidl.nl does not show); null for rows from the
-- supermarket itself. An add-only product never changes a row whose
-- catalog_source differs; the supermarket's own data takes a dataset row over
-- and sets it back to null.

ALTER TABLE products ADD COLUMN IF NOT EXISTS catalog_source VARCHAR(20);

COMMENT ON COLUMN products.catalog_source IS 'Dataset that added this row as add-only (e.g. checkjebon); null for rows from the supermarket itself';
