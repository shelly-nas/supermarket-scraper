-- Albert Heijn offers now come per product from the AH mobile API (see
-- clients/AhApiClient.ts), linked to the catalog by webshopId. The rows the
-- bonus page gave before were whole promotions named after the group
-- ("Alle Felix") and have no external_id; catalog rows always have one. Those
-- group rows go, with their discounts (ON DELETE CASCADE), so they do not show
-- next to the products this week. The offer run is due right away.

DELETE FROM products WHERE supermarket = 'Albert Heijn' AND external_id IS NULL;

UPDATE scheduled_runs SET next_run_at = CURRENT_TIMESTAMP WHERE supermarket = 'Albert Heijn' AND enabled;
