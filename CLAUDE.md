# CLAUDE.md

Scrapes weekly offers and full assortments of Dutch supermarkets into PostgreSQL and serves them to the
Baskit app. Three Docker services: `postgres` <- `scraper-api` (Express, TypeScript, port 3001) <- `web`
(React + Vite admin UI behind nginx). Follows the shelly-nas standards (plugin `shelly-fundamentals`).

Module map, data model, environments and how-tos: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
Behaviour per functionality: one file per feature in `docs/functional/`, listed in [docs/FUNCTIONAL_DESIGN.md](docs/FUNCTIONAL_DESIGN.md).
Read only the file and section you need.

## Rules

- **No emojis** in code, UI or responses. Use text labels or the SVG icons in `web/src/components/Icons.tsx`.
- **The public API `/api/public/v1` is a contract with Baskit** (`shelly-nas/baskit`, which never reads the
  database directly). Keep it backwards compatible; a breaking change goes into a new version prefix.
- **Schema changes** go into a new numbered migration `scraper/migrations/NNN_*.sql`, applied on startup by
  `scraper/src/data/Migrations.ts`. The base schema is `database/src/schema.sql`.
- **Styles:** `web/src/styles/tokens.css` and `components.css` are copies from the `design-richtlijnen` skill.
  Do not edit them here; copy them again. App CSS uses roles (`var(--primary)`), never hex values.
- **After a functional change**, update the file of that functionality in `docs/functional/` (a new
  functionality gets its own file and a row in `docs/FUNCTIONAL_DESIGN.md`). **After adding,
  removing or renaming a module, or moving a responsibility**, update its section of `docs/ARCHITECTURE.md`.
  Change this file only when a rule or command changes.

## Reading code

- Locate first, then read narrowly: search with grep or glob (with line numbers), then read only the relevant
  range with an offset and limit. Read a whole file only when you are going to edit it or it is short.
- Find a section in the docs with grep on its heading instead of reading the whole document.
- Do not re-read a file you already read in this session unless it changed since.

## Commands

| Where | Command |
|---|---|
| `scraper/` | `npm ci` · `npm run build` (tsc to `dist/`) · `npm test` (Vitest) · `npm run dev` (build and run). No lint script. |
| `web/` | `npm ci` · `npm run build` (tsc + vite) · `npm run lint` · `npm run dev`. No tests yet. |
| Full stack | `cp .env.example .env`, then `docker compose up --build -d`; rebuild one service with `docker compose up --build -d scraper-api` |
| Logs / DB | `docker compose logs -f scraper-api` · `docker exec -it supermarket-scraper-db psql -U supermarket_user -d supermarket` |

## Where things are (`scraper/src/`)

| Path | Role |
|---|---|
| `api/Routes.ts`, `api/CatalogRoutes.ts` | Admin API under `/api` (used by `web/`) |
| `api/PublicRoutes.ts` + `ProductSearch.ts`, `PriceComparison.ts`, `SameProducts.ts`, `ImageProxy.ts` | Public API for Baskit |
| `clients/<Name>ApiClient.ts` (+ `clients/<name>/`) | Weekly offers per supermarket, extends `ApiClient` |
| `clients/catalog/<Name>CatalogClient.ts` | Full assortment at regular price, extends `CatalogClient` |
| `utils/ProductMatch.ts`, `utils/Quantity.ts`, `utils/Promotion.ts` | Same product across supermarkets, pack sizes, promotion prices |
| `data/PostgresDataManager.ts`, `controllers/` | Writes to the database, one controller per table |
| `services/SchedulerService.ts`, `services/CatalogService.ts`, `utils/Schedule.ts` | Weekly run per supermarket (catalog, then offers) and when it is due |
| `utils/ConfigHelper.ts` | Registry of offer and catalog clients |

Adding a supermarket or a catalog scraper: see the "Adding ..." sections in `docs/ARCHITECTURE.md`.
