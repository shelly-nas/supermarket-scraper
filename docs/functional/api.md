# API

The admin API and the public API for consumer apps (Baskit), with data contracts. Part of the [functional design](../FUNCTIONAL_DESIGN.md).

## FR-004: REST API

| ID        | Requirement                                                              | Priority | Status         |
| --------- | ------------------------------------------------------------------------ | -------- | -------------- |
| FR-004.1  | System SHALL provide health check endpoint                               | HIGH     | ✅ Implemented |
| FR-004.2  | System SHALL provide endpoint to retrieve all active discounts           | HIGH     | ✅ Implemented |
| FR-004.3  | System SHALL provide endpoint to trigger scraper runs                    | HIGH     | ✅ Implemented |
| FR-004.4  | System SHALL provide endpoint to retrieve scraper run history            | MEDIUM   | ✅ Implemented |
| FR-004.5  | System SHALL provide endpoint to retrieve dashboard statistics           | MEDIUM   | ✅ Implemented |
| FR-004.6  | System SHALL provide endpoint to retrieve supermarket statuses           | MEDIUM   | ✅ Implemented |
| FR-004.7  | System SHALL provide endpoint to manage scheduled runs                   | MEDIUM   | ✅ Implemented |
| FR-004.8  | System SHALL provide endpoint to manually cleanup expired discounts      | LOW      | ✅ Implemented |
| FR-004.9  | System SHALL return JSON formatted responses                             | HIGH     | ✅ Implemented |
| FR-004.10 | System SHALL handle errors gracefully with appropriate HTTP status codes | HIGH     | ✅ Implemented |
| FR-004.11 | System SHALL provide a versioned, read-only public API (`/api/public/v1`) for consumer apps such as Baskit | HIGH | ✅ Implemented |
| FR-004.12 | Public API SHALL support paginated text search over active discounts with supermarket/category filters and sorting | HIGH | ✅ Implemented |
| FR-004.13 | System SHALL restrict allowed CORS origins via the `CORS_ORIGINS` environment variable (all origins when unset) | MEDIUM | ✅ Implemented |
| FR-004.14 | Public search SHALL support `scope=all` to include catalog products at their regular price | HIGH | ✅ Implemented |
| FR-004.15 | Public API SHALL price a shopping list at every supermarket (`POST /compare`) | HIGH | ✅ Implemented |

## 5.5 API Data Contracts

### GET /api/discounts

**Response:** Array of discount objects with embedded product information

```typescript
interface DiscountResponse {
  id: number; // Product ID
  name: string; // Product name
  category: string; // Product category
  supermarket: string; // Supermarket name
  created_at: string; // ISO 8601 timestamp
  updated_at: string; // ISO 8601 timestamp
  discount: {
    id: number; // Discount ID
    product_id: number; // Foreign key to product
    original_price: number; // Pre-discount price
    discount_price: number; // Discounted price
    unit_price: string | null; // e.g., "€1.49/kg", "€0.99/l", "€0.50/st"
    special_discount: string | null; // e.g., "2+1 gratis"
    expire_date: string; // ISO 8601 timestamp
    active: boolean; // Always true for this endpoint
    created_at: string; // ISO 8601 timestamp
  };
}
```

**Example:**

```json
[
  {
    "id": 123,
    "name": "Coca Cola 1.5L",
    "category": "Dranken",
    "supermarket": "Albert Heijn",
    "created_at": "2025-10-20T10:00:00.000Z",
    "updated_at": "2025-10-24T08:30:00.000Z",
    "discount": {
      "id": 456,
      "product_id": 123,
      "original_price": 2.49,
      "discount_price": 1.99,
      "unit_price": null,
      "special_discount": null,
      "expire_date": "2025-10-31T23:59:59.000Z",
      "active": true,
      "created_at": "2025-10-24T08:30:00.000Z"
    }
  }
]
```

### POST /api/scraper/run/:supermarket

**Parameters:**

- `:supermarket` - One of: `albert-heijn`, `aldi`, `dirk`, `hoogvliet`, `jumbo`, `lidl`, `plus`

**Response:**

```typescript
interface ScraperRunResponse {
  success: boolean;
  message: string;
  data: {
    runId: number;
    supermarket: string;
    productsScraped: number;
    productsCreated: number;
    productsUpdated: number;
    discountsCreated: number;
    discountsSkipped: number;
    timestamp: string; // ISO 8601
  };
}
```

**Example:**

```json
{
  "success": true,
  "message": "Scraper completed for Albert Heijn",
  "data": {
    "runId": 42,
    "supermarket": "Albert Heijn",
    "productsScraped": 150,
    "productsCreated": 12,
    "productsUpdated": 138,
    "discountsCreated": 150,
    "discountsSkipped": 0,
    "timestamp": "2025-10-24T14:30:00.000Z"
  }
}
```

### GET /api/dashboard/stats

**Response:**

```typescript
interface DashboardStats {
  totalRuns: number; // Total scraper runs ever
  successRate: number; // Percentage (0-100)
  scrapedProducts: number; // Active discounts count
  uniqueProducts: number; // Total unique products
  nextScheduledRun: string; // Human-readable or "Not scheduled"
}
```

**Example:**

```json
{
  "totalRuns": 156,
  "successRate": 98.7,
  "scrapedProducts": 450,
  "uniqueProducts": 523,
  "nextScheduledRun": "Albert Heijn at 10/31/2025, 11:00:00 PM"
}
```

### GET /api/dashboard/statuses

**Response:**

```typescript
interface SupermarketStatus {
  key: string; // URL-safe key
  name: string; // Display name
  status: "success" | "failed" | "running" | "pending";
  lastRun?: string; // ISO 8601 timestamp
  productsScraped?: number;
  runId?: number;
}
```

**Example:**

```json
[
  {
    "key": "albert-heijn",
    "name": "Albert Heijn",
    "status": "success",
    "lastRun": "2025-10-24T08:30:00.000Z",
    "productsScraped": 150,
    "runId": 42
  },
  {
    "key": "dirk",
    "name": "Dirk",
    "status": "pending"
  }
]
```

### Public API (`/api/public/v1`) — consumer apps

Read-only endpoints used by the Baskit app. They never expose scraper triggers,
run logs or scheduler management and use camelCase fields. Every product gets
at most one current discount: the cheapest active, non-expired one. Responses
carry `Cache-Control: public, max-age=60`.

| Endpoint | Description |
| -------- | ----------- |
| `GET /api/public/v1/health` | Health check |
| `GET /api/public/v1/supermarkets` | All supermarkets with `key`, `name`, `activeDiscounts`, `lastUpdated`, `expireDate`, `catalogProducts`, `catalogUpdated` |
| `GET /api/public/v1/categories?supermarket=&scope=` | Categories with counts for the given scope |
| `GET /api/public/v1/search` | Paginated search (see below) |
| `GET /api/public/v1/products/:id` | Product with the item fields below (`brand`, `imageUrl`, `imageProxyUrl`, `ean`, `quantity`, `packSize`), `price`, `catalog`, `currentDiscount`, up to 50 discount `history` entries, up to 100 `priceHistory` entries and `sameProduct`: the same product at other supermarkets (search item shape, cheapest first, FR-008) |
| `GET /api/public/v1/images/:id` | The product's image through the cached image proxy (FR-008.6); `404` without image, `Cache-Control: public, max-age=604800`, `ETag` |
| `POST /api/public/v1/compare` | Prices a shopping list at every supermarket (see below) |

Search query parameters:

| Param | Description |
| ----- | ----------- |
| `q` | Free text; every word must occur in the product name (case-insensitive, LIKE wildcards are escaped) |
| `supermarket` | Comma separated supermarket keys (`albert-heijn,dirk,...`) |
| `category` | Exact category name |
| `scope` | `offers` (default): only products with a current discount. `all`: also catalog products at their regular price |
| `sort` | `relevance` (default: exact > whole word > prefix > word prefix > contains, then price), `price` (effective price), `discount`, `expiry`, `name` |
| `limit` / `offset` | Page size 1-100 (default 25) and offset |

```typescript
interface SearchResponse {
  query: string;
  total: number;
  limit: number;
  offset: number;
  items: {
    id: number;
    name: string;
    brand: string | null;
    category: string;
    supermarket: { key: string; name: string };
    productUrl: string | null;
    imageUrl: string | null;      // the image at the supermarket
    imageProxyUrl: string | null; // "/api/public/v1/images/:id", same image cached by this API
    ean: string | null;           // barcode, when the supermarket publishes it
    quantity: { value: number; unit: "kg" | "l" | "stuk" } | null;
    packSize: string | null;      // pack size to show: the supermarket's text, else e.g. "1,5 liter"
    price: number | null; // offer price when on offer, otherwise the regular price
    pricePerUnit: { value: number; unit: "kg" | "l" | "stuk" } | null; // price / quantity
    discount: {
      id: number;
      originalPrice: number | null; // falls back to the catalog price
      discountPrice: number;
      unitPrice: string | null;
      specialDiscount: string | null;
      discountPercentage: number | null;
      expireDate: string; // ISO 8601
    } | null; // always set with scope=offers
    catalog: {
      regularPrice: number | null; // null when unknown (some Lidl products)
      priceSource: "supermarket" | "checkjebon" | null;
      quantity: { value: number; unit: "kg" | "l" | "stuk" } | null; // e.g. 500 g -> 0.5 kg
      unitPrice: string | null; // as shown by the supermarket, e.g. "€5.18 per kilo"
      unitSize: string | null;
      brand: string | null;
      imageUrl: string | null;
    } | null; // null when the product is not in the latest catalog scrape
    updatedAt: string;
  }[];
}
```

**Price comparison** - `POST /api/public/v1/compare`

Request: `{ items: [{ id, query, count?, productId? }], supermarkets?: "dirk,albert-heijn" }`
(1-100 items, `count` 1-99, default all supermarkets).

For every item and supermarket the best matching product is chosen among
current offers and catalog products: every word of `query` must occur in the
name and at least one as a whole word; more whole-word matches rank higher.
Among equally good matches, products with a known pack quantity come first and
like is compared with like (the unit most of those matches are sold in, kg, l
or stuk, goes first); the lowest current price per unit (offer or regular
price over the quantity) wins, so a 500 ml pack does not beat a cheaper liter.
Then the lowest current price, then the shortest name. Because larger packs
are often cheaper per unit, `total` reflects the best value packs, not the
lowest possible receipt. When nothing matches, words
containing digits (sizes such as `1L`, `500g`) are dropped and the match is
retried. An item with a `productId` uses exactly that product at its own
supermarket and the same product (FR-008) at the other supermarkets, cheapest
per supermarket; the name search only fills the supermarkets without it.
`match` on each line says which: `own`, `same` or `search`.

```typescript
interface CompareResponse {
  itemCount: number;
  // Most items found first, then the lowest total
  supermarkets: {
    key: string;
    name: string;
    total: number;      // sum of lineTotal of the found items
    matched: number;    // items found
    missing: string[];  // ids of items not found
    lines: {
      itemId: string;
      count: number;
      product: SearchResponse["items"][number] | null;
      match: "own" | "same" | "search" | null; // how the product was found
      lineTotal: number | null; // product.price * count
    }[];
  }[];
}
```

### Catalog admin API (`/api/catalog`)

| Endpoint | Description |
| -------- | ----------- |
| `GET /api/catalog/status` | Per supermarket: `supported`, `running`, `productsInCatalog`, `lastUpdated`, `lastRun` |
| `GET /api/catalog/runs?limit=` | Latest catalog runs (default 50, max 200) |
| `POST /api/catalog/run/:supermarket` | Starts a catalog run in the background: `202 { runId }`, `409` when one is already running, `400` for supermarkets without a catalog scraper |

## 9.1 API Endpoint Summary

| Method | Endpoint                             | Purpose                               |
| ------ | ------------------------------------ | ------------------------------------- |
| GET    | `/health`                            | Health check                          |
| GET    | `/api/discounts`                     | Retrieve all active discounts         |
| POST   | `/api/scraper/run/:supermarket`      | Trigger scraper run                   |
| GET    | `/api/scraper/runs`                  | Get all scraper runs                  |
| GET    | `/api/scraper/runs/:supermarket`     | Get runs for specific supermarket     |
| GET    | `/api/scraper/run/:id`               | Get specific run by ID                |
| GET    | `/api/dashboard/stats`               | Get dashboard statistics              |
| GET    | `/api/dashboard/statuses`            | Get supermarket statuses              |
| GET    | `/api/scheduler/runs`                | Get all scheduled runs                |
| GET    | `/api/scheduler/run/:supermarket`    | Get scheduled run for supermarket     |
| PUT    | `/api/scheduler/toggle/:supermarket` | Enable/disable scheduled run          |
| GET    | `/api/scheduler/due`                 | Get due scheduled runs                |
| POST   | `/api/discounts/cleanup`             | Manually deactivate expired discounts |
