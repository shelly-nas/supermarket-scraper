-- One run per supermarket: the assortment and the offers in one run
-- (services/RunService.ts), logged as one scraper_runs row.
--
-- catalog_*: what the assortment step of the run did; null for a run without
-- one (CATALOG_ENABLED=false, or older offers-only runs).
-- catalog_runs is no longer written; it keeps the history of the separate
-- catalog runs from before.
-- scheduled_runs.promotion_expire_date may be empty: the scheduler gives every
-- supermarket a row before its first run, when no end date is known yet.

ALTER TABLE scraper_runs ADD COLUMN IF NOT EXISTS catalog_products INTEGER;
ALTER TABLE scraper_runs ADD COLUMN IF NOT EXISTS catalog_prices_changed INTEGER;
ALTER TABLE scraper_runs ADD COLUMN IF NOT EXISTS catalog_products_removed INTEGER;

ALTER TABLE scheduled_runs ALTER COLUMN promotion_expire_date DROP NOT NULL;

COMMENT ON COLUMN scraper_runs.catalog_products IS 'Products the assortment step of the run saw; null when the run had no assortment step';
COMMENT ON COLUMN scraper_runs.catalog_prices_changed IS 'Regular prices the assortment step changed';
COMMENT ON COLUMN scraper_runs.catalog_products_removed IS 'Products the assortment step marked as no longer in the assortment';
COMMENT ON TABLE catalog_runs IS 'Audit log of the separate catalog scrapes before runs were combined (migration 009); no longer written';
