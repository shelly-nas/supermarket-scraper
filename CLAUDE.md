# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Code style

- **Never use emojis** anywhere in code, UI, or responses. Use proper text labels or icon components (e.g. SVG icons, icon libraries) instead.

## Documentation

- **REQUIRED:** After any functional change (new feature, changed behaviour, removed feature), update [docs/FUNCTIONAL_DESIGN.md](docs/FUNCTIONAL_DESIGN.md) to reflect the new state. Keep it accurate — do not leave stale descriptions.

## Keeping this file current

- **REQUIRED:** After every code change, update this CLAUDE.md to reflect any architectural changes, new/removed files, renamed modules, or changed responsibilities. Keep the Architecture and Adding a New Supermarket sections accurate.

## Development Commands

### Scraper API (`scraper/`)
```bash
cd scraper
npm install
npm run build   # tsc compile to dist/
npm run dev     # build + run (no hot reload)
npm run lint    # eslint check
```

### Web Frontend (`web/`)
```bash
cd web
npm install
npm run dev     # vite dev server
npm run build   # tsc + vite build
npm run lint    # eslint check
```

### Running the full stack
```bash
# Development
cp .env.example .env  # configure DB_NAME, DB_USER, DB_PASSWORD, LOG_LEVEL
docker compose up --build -d

# Rebuild after scraper/web changes
docker compose up --build -d scraper-api  # or: web

# View logs
docker compose logs -f scraper-api

# Direct DB access
docker exec -it supermarket-scraper-db psql -U supermarket_user -d supermarket
```

### Environment variables (`.env` in project root)
```
DB_NAME=supermarket
DB_USER=supermarket_user
DB_PASSWORD=change_this_password
LOG_LEVEL=INFO   # DEBUG | INFO | WARN | ERROR
CORS_ORIGINS=    # optional, comma separated allowed origins (empty = all)
CATALOG_ENABLED=true          # catalog step of each supermarket's weekly run on/off
IMAGE_CACHE_DIR=              # optional, where the image proxy caches images (default: OS temp dir)
```

## Architecture

Three Docker services communicate over an internal network:

```
postgres (port 5432) ← scraper-api (port 3001) ← web (port 3010→nginx→3000)
```

### `scraper/` — Express API + API-based scraper clients (TypeScript)

Entry point: [scraper/src/index.ts](scraper/src/index.ts)

**Key layers:**
- **`api/Routes.ts`** — Admin Express routes under `/api` (used by the management `web/`). Scraping is triggered via `POST /api/scraper/run/:supermarket`.
- **`api/PublicRoutes.ts`** — Read-only, versioned consumer API under `/api/public/v1` used by the Baskit app (`/health`, `/supermarkets`, `/categories`, `/search`, `/products/:id`, `POST /compare`). camelCase responses, no scraper/scheduler endpoints; `/search` and `/categories` take `scope=offers|all`, `/products/:id` includes `catalog`, `priceHistory` and `sameProduct` (the same product at other supermarkets via `SameProducts.ts`); `GET /images/:id` serves product images through `ImageProxy.ts`. Search logic lives in `ProductSearch.ts`. CORS origins are restricted via `CORS_ORIGINS` in `index.ts`.
- **`api/SameProducts.ts`** — `findSameProducts(db, productRow)`: candidates with the same `ean`, or the same `match_brand` and quantity (within 2%), checked with `utils/ProductMatch.isSameProduct` (naming habits per supermarket from all products of the brand); cheapest one per other supermarket.
- **`api/ImageProxy.ts`** — Fetches `products.image_url` once (only `image/*`, max 5 MB) and caches it on disk in `IMAGE_CACHE_DIR` (default the OS temp dir), keyed by product id + URL hash; behind `GET /api/public/v1/images/:id` (7-day `Cache-Control`, `ETag`).
- **`utils/ProductMatch.ts`** — Same product across supermarkets: `matchFields(name, brand)` -> `match_brand` (brand as one word, else the first word) and `match_tokens` (name words without pack size, packaging words and brand), `normalizeEan` (GS1 check digit), `namingHabits`, `isSameProduct` (barcode decides; else brand, quantity and words, ignoring a supermarket's habit words only when the other name lacks them).
- **`clients/`** — API-based discount fetchers. `ApiClient` is the abstract base with `fetchDiscounts()` returning `{ discounts: IProductDiscountDetails[], expireDate: string }`. Each discount includes a `productUrl` (direct link to the supermarket offer page, or the offers listing page when per-product URLs are unavailable). Concrete clients: `DirkApiClient` (Dirk GraphQL via `clients/dirk/DirkGraphql.ts`, no browser; one discount per product a folder offer covers, looked up with `products(storeId, productIds)`, `externalId` = Dirk product id; offers without known products stay one discount by name), `AhApiClient` (no browser: the AH mobile API via `clients/ah/AhMobileApi.ts`, product search per category with `filters=bonus=Bonus`; one discount per product via `mapAhDiscount`, only `promotionType` NATIONAL and not the "Voordeelshop" segment, per-item price from `currentPrice` or the discount label (`ahBonusPrice`), pack size from `salesUnitSize`, `externalId` = webshopId; run expiry = most common end date), `PlusApiClient` (Playwright via `clients/plus/PlusSite.ts`, the product list with the "Nu in de aanbieding" filter; per-item price from `NewPrice` or the label, `externalId` = SKU), `LidlApiClient` (no browser: reads the `data-grid-data` tile JSON from the server HTML of lidl.nl/aanbiedingen with the catalog's `extractGridData`; per tile via `mapLidlOffer`: `externalId` = the offer's own erpNumber, `articleNumbers` = the permanent `nat`/`ians` (links the offer to its catalog row), `regularPrice` = the struck-through price (stored on that row), own end date from `storeEndDate`, regular price, Lidl Plus offers from `lidlPlus`/`regionsPrices` (`lidlOfferPrice`), pack size via `lidlOfferQuantity`; run expiry = most common end date), `AldiApiClient` (no browser; the current folder from `OFFER_GET` in the offers page `__NEXT_DATA__` via `AldiAlgolia.folder()`, each offer valid until its folder category's end date; `externalId` via `aldiLinkedId` = the regular article with the same id or the id after a leading `9`, else the offer's own id; regular price from `strikePrice`; non-food offers skipped via `clients/aldi/AldiFood.ts`), `HoogvlietApiClient` (Magento GraphQL via `clients/hoogvliet/HoogvlietGraphql.ts`, no browser; keeps products with a current promotion, discount price per item also for multi-buy labels, sets `externalId` = SKU; run expiry = most common end date), `JumboApiClient` (jumbo.com GraphQL via `clients/jumbo/JumboGraphql.ts`, no browser; whole assortment via `searchProducts`, keeps products with a price promotion, per-item price via `utils/Promotion.promotionPrice`, sets `externalId` = SKU). Discounts may set `quantity` (pack size in kg/l/stuk); without it the name is parsed. AH, Dirk, PLUS, Aldi, Hoogvliet and Jumbo set `productUrl` to the product page; Lidl links to the offers listing page.
- **`api/ProductSearch.ts`** — Search SQL shared by the public endpoints: one current (cheapest active) discount per product via `CURRENT_DISCOUNT_JOIN`, `scope` `offers` (default) or `all` (also catalog products at regular price), relevance ranking, `PRODUCT_COLUMNS` (the columns `mapSearchRow` reads, shared with `PriceComparison`/`SameProducts`), `mapSearchRow` response shape (`brand`, `imageUrl`, `imageProxyUrl`, `ean`, `quantity`, `packSize`, `price`, `discount`, `catalog`). Also owns the `SUPERMARKETS` key/name list re-exported by `PublicRoutes.ts`.
- **`api/PriceComparison.ts`** — `compareList` behind `POST /api/public/v1/compare`: per list item one `DISTINCT ON (supermarket)` query picking the best match per supermarket (all words in the name, at least one as a whole word; ranked by whole-word matches, then known quantity first, the most common unit among those matches first, current price per kg/l/stuk, then current price, then name length), retried without size tokens; an item's own `productId` is used as is at its supermarket and `findSameProducts` fills the other supermarkets first; each line has `match` (`own`/`same`/`search`).
- **`api/CatalogRoutes.ts`** — Admin catalog endpoints under `/api/catalog`: `GET /status`, `GET /runs`, `POST /run/:supermarket` (202, runs in the background).
- **`clients/catalog/`** — Full assortment fetchers at regular price. `CatalogClient` (abstract, `fetchCatalog(onPage)` streams pages), `AhCatalogClient` (AH mobile API via `clients/ah/AhMobileApi.ts`, shared with `AhApiClient`: anonymous token, categories, paged product search; current iOS app headers; every call retries on 401/429/5xx and a final failure names the step, status and response start), `LidlCatalogClient` (crawls the lidl.nl food assortment pages from `/c/assortiment-producten/s10008015`, reads the `data-grid-data` tile JSON, keeps `Food`/`F+V` tiles, sets `articleNumber` = the permanent `nat` (via `lidlArticleNumbers`); Lidl publishes no regular prices, so prices come from the checkjebon.nl dataset matched on erpNumber, permanent number or unique name (the last two with a pack size check), with Lidl's own `oldPrice` first; products without a match get `price: null`; a price Lidl showed next to an offer in the last 180 days is kept by `PostgresCatalogController.keepsObservedPrice`). `HoogvlietCatalogClient` (same GraphQL module: categories via `categories(parent_id: 2)`, SKUs via `categoryList { products }`, details incl. pack size and promotion via `products(filter: sku in)`; skips `GroupedProduct` promotion groups), `JumboCatalogClient` (same Jumbo GraphQL module; regular price in cents, quantity from pack size/title/price per unit; a page that Jumbo nulls because of one broken product is split until that product is skipped). `ICatalogProduct.price` is nullable and `priceSource` (`supermarket`/`checkjebon`) is stored as `products.price_source`; `ICatalogProduct.quantity` (or, when absent, `utils/Quantity.parseQuantity(unitSize)`) is stored as `products.quantity_value`/`quantity_unit` (kg, l, stuk) and the public API returns `pricePerUnit`. Registered in `ConfigHelper.getCatalogClient` / `CATALOG_SUPERMARKETS`. `DirkCatalogClient` (Dirk web gateway via `clients/dirk/DirkGraphql.ts`: departments, then `listWebGroupProducts` per web group at store 66), `PlusCatalogClient` (headless browser via `clients/plus/PlusSite.ts`: replays plus.nl's own `DataActionGetProductListAndCategoryInfo` request without a category, 12 per page), `AldiCatalogClient` (aldi.nl's Algolia index via `clients/aldi/AldiAlgolia.ts`, search-only key from the site; regular objects, not category `offer`; food and drink only via `aldiFoodFilter` in `clients/aldi/AldiFood.ts`: Aldi's own categories, else a naive Bayes word model learned from them).
- **`services/CatalogService`** — Starts catalog runs (one per supermarket at a time), upserts pages through `controllers/PostgresCatalogController` (match on `(supermarket, external_id)`, then adopts an offer-only row with the same name; `price_history` row only when the regular price changes), marks products not seen as `in_catalog = false` unless the run saw under 50% of the known products, and records `catalog_runs`. `SchedulerService` runs a supermarket's catalog as the first step of its weekly run (off with `CATALOG_ENABLED=false`).
- **`data/Migrations.ts`** — Applies `scraper/migrations/NNN_*.sql` on startup (recorded in `schema_migrations`, one transaction per file). Every schema change after the base `database/src/schema.sql` goes into a new numbered migration; the Dockerfile copies the directory.
- **`data/PostgresDataManager`** — Facade coordinating the four controllers. `addProductDb` upserts products (deduplicates and matches on `externalId` when the scraper sets it, via `PostgresProductController.addProductByExternalId`; otherwise by name) and stores the offer's details via `PostgresProductController.setOfferDetails`: `quantity` (or `parseQuantity(name)`), `brand` and match fields only on rows the catalog does not keep (`catalog_updated_at IS NULL`), `imageUrl` and `ean` only where still empty. An offer with `articleNumbers` lands on the catalog row with that `article_number` and the same quantity (`PostgresProductController.findCatalogProductByArticle` / `pickByQuantity`, also used by `addDiscountDb`); its `regularPrice` is stored via `setRegularPriceFromOffer` (`price_source` `supermarket`, `price_observed_at`, `price_history`). An offer with `articleNumbers` lands on the catalog row with that `article_number` and the same quantity (`PostgresProductController.findCatalogProductByArticle` / `pickByQuantity`, also used by `addDiscountDb`); its `regularPrice` is stored via `setRegularPriceFromOffer` (`price_source` `supermarket`, `price_observed_at`, `price_history`). `PostgresProductController.backfillMatchFields` fills match fields of older rows on startup (`index.ts`); `addDiscountDb` uses smart logic comparing against the previous batch's `promotion_expire_date` to avoid duplicate discount rows.
- **`controllers/`** — One controller per table (`PostgresProductController`, `PostgresDiscountController`, `PostgresScraperRunController`, `PostgresScheduledRunController`), each receiving a `PostgresDataContext` (singleton pg pool).
- **`services/SchedulerService`** — node-cron job (every minute) that deactivates expired discounts and queries `scheduled_runs` for due entries. A due supermarket gets its weekly run in the background: the catalog through `CatalogService` (awaited), then the offers through an internal `axios.post` to its own API. While it runs, `next_run_at` is a retry 3 hours later. The offers route then sets the next run with `utils/Schedule.nextRunAfterExpiry`: the first 03:00 Europe/Amsterdam after the offers end (computed with `Intl`, the container runs in UTC), a retry in 3 hours without an end date or with one already passed, and at most 7 days ahead. `PostgresScheduledRunController.upsertScheduledRun` keeps the existing `enabled` setting.

### Consumers

The Baskit app (separate repo `shelly-nas/baskit`) reads discount data exclusively through `/api/public/v1` — never directly from the database. In production `scraper-api` joins `shelly-network` so the Baskit nginx container can proxy to `http://supermarket-scraper-api:3001/api/public/v1` (acc: `supermarket-scraper-acc-api`). Keep the public API backwards compatible; breaking changes go into a new version prefix.

### Environments and pipelines

In prod and acc, `/api` goes from Traefik straight to `scraper-api` (routers `supermarkets-api` / `supermarkets-acc-api`, `Host && PathPrefix(/api)`, port 3001), never through the web nginx: both stacks' APIs are on `shelly-network` under the service name `scraper-api`, so nginx's `proxy_pass http://scraper-api:3001` (only meant for local use) would reach either stack.

- `.github/workflows/github-pipeline.yaml` — every push to `main` builds the three images (`latest`) and deploys `docker-compose.prod.yml` to `/volume1/docker/supermarket-scraper` (production, persistent named volume). Also tears down acc once its commit is in production.
- `.github/workflows/acc.yml` — every pull request is built (tag `acc-<commit>`) and deployed to acceptance `supermarkets-acc.shelly-nas.nl` (`docker-compose.acc.yml`, `/volume1/docker/supermarket-scraper-acc`) via the shared `deploy-acceptance.yml`; torn down when the PR closes (`teardown-acceptance.yml`). The acc database is rebuilt on every deploy: `schema.sql` + `migrate.sql` from the image, then `database/demo/seed-demo.sql` (demo offers for all 7 supermarkets with expiry relative to the deploy, expired offers as history, run logs). The demo seed is never in the database image, so never in production. Acc runs with `CATALOG_ENABLED=false`; its API joins `shelly-network` as `supermarket-scraper-acc-api` for the Baskit acc stack.

### `database/` — PostgreSQL init scripts

Schema: [database/src/schema.sql](database/src/schema.sql). Tables:
- `products` — unique per `(name, supermarket)`; upserted on every scrape; stores `product_url` (offer page link)
- `discounts` — soft-delete via `active` flag; old discounts are marked `active=false` rather than deleted
- `scraper_runs` — audit log of every execution with metrics
- `scheduled_runs` — one row per supermarket, holds `next_run_at` and `promotion_expire_date`
- `products` catalog columns (migration 001): `external_id`, `brand`, `unit_size`, `image_url`, `regular_price`, `unit_price`, `in_catalog`, `catalog_updated_at`; `price_source` (migration 003); `quantity_value`, `quantity_unit` (migration 004); `ean`, `match_brand`, `match_tokens` (migration 005, written by the scraper from `utils/ProductMatch.ts`); `article_number` (Lidl permanent article number), `price_observed_at` (when the supermarket itself last showed `regular_price`) (migration 007)
- `price_history` — regular price changes per product; `catalog_runs` — audit log of catalog scrapes; `schema_migrations` — applied migrations

### `web/` — React + Vite frontend (TypeScript)

Routes: `/discounts` (default) and `/configurations`. The Discounts table shows each product's pack size under its name and the discount price per kilo, liter or piece (`GET /api/discounts` returns `unit_size`, `quantity_value`, `quantity_unit`; `web/src/utils/quantity.ts` formats them). The Configurations page shows supermarket statuses, dashboard stats, scraper run history, and lets you trigger manual runs or toggle scheduled runs. Its "Weekly offers" section starts discount scrapes and toggles their auto re-scrape (a switch); its "Full assortment" section (`components/CatalogSection.tsx`) shows catalog status per supported supermarket and starts catalog runs. All data fetched from the scraper API via [web/src/services/api.ts](web/src/services/api.ts). Served by nginx in production (see [web/nginx.conf](web/nginx.conf)).

**Design:** the UI follows the shelly-nas design guidelines (repo `shelly-nas/shelly-fundamentals`, skill `design-richtlijnen`). `web/src/styles/tokens.css` and `web/src/styles/components.css` are copies of that skill's files (update them by copying again, do not edit them here); `main.tsx` imports the Figtree font (`@fontsource/figtree` 400-700), then `tokens.css`, `components.css` and `index.css`. App stylesheets read only roles (`var(--primary)`, `var(--surface)`, `var(--text-muted)`), never hex values, and use the component classes (`btn`, `card`, `badge`, `table`, `input`, `switch`, `nav-item`, `skel`, `t-title`/`t-heading`/`t-small`/`t-label`). `index.css` holds the page-level pieces (page header, sections, empty/error states).

**App shell:** `components/AppShell.tsx` renders the navigation once (logo, nav items, theme switch) in a sticky 248px sidebar from 900px up, and below that in a `<dialog>` drawer opened from a fixed 56px top bar. Shared UI: `components/Icons.tsx` (inline line icons), `components/StatusBadge.tsx` (run status as dot plus word), `components/PageState.tsx` (`EmptyState`, `ErrorState`, `ErrorAlert`), `components/ConfirmDialog.tsx` (native `<dialog>`).

**Theme system:** `web/src/context/ThemeContext.tsx` provides a `ThemeProvider` and `useTheme` hook. Mode is `system | light | dark`, persisted in `localStorage` (key `theme`, always in try/catch). The resolved theme is the class `theme-light` or `theme-dark` on `<html>`; an inline script in `web/index.html` sets it before the first paint, the provider keeps it in sync. The theme switch at the bottom of the navigation picks one of the three modes.

## Adding a Catalog Scraper

1. Create `scraper/src/clients/catalog/<Name>CatalogClient.ts` extending `CatalogClient`; deliver `ICatalogProduct` pages through `onPage` with a stable `externalId`, the regular (non-promotion) price, `brand` and `imageUrl` (both needed for same-product matching and images) and `ean` when the source has one.
2. Register it in `getCatalogClient` and add the name to `CATALOG_SUPERMARKETS` in `scraper/src/utils/ConfigHelper.ts`.

## Adding a New Supermarket

1. Create `scraper/src/clients/<Name>ApiClient.ts` extending `ApiClient`; implement `fetchDiscounts()` returning `{ discounts: IProductDiscountDetails[], expireDate: string }`. Set `externalId`, `imageUrl` and `brand` when the source has them (and `ean` if published).
2. Register the new client in `scraper/src/utils/ConfigHelper.ts` (`getSupermarketClient` switch).
3. Add the name mappings in `scraper/src/api/Routes.ts` (all `nameMap` objects + `allSupermarkets` array), `scraper/src/api/ProductSearch.ts` (`SUPERMARKETS`) and `scraper/src/services/SchedulerService.ts` (`SUPERMARKET_KEYS`).
