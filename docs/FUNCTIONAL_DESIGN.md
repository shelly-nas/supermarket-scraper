# Functional Design Document

## Supermarket Scraper System

**Version:** 1.0  
**Date:** October 24, 2025  
**Project:** supermarket-scraper (named discount-scraper until October 2026)  
**Author:** System Analysis

---

## 1. Purpose

### 1.1 System Purpose

The Supermarket Scraper system automatically collects, stores, and presents the products of multiple Dutch supermarket chains (Albert Heijn, Aldi, Dirk, Hoogvliet, Jumbo, Lidl, and PLUS) in a centralized, searchable database with a modern web interface: the full assortment with regular prices and pack quantities where a catalog scraper exists, and the weekly offers of every chain. A read-only public API serves the data to the Baskit app, which compares shopping lists on price per kilo, liter or piece.

#### Rename from discount-scraper

Until October 2026 the project was called discount-scraper, after its first
scope (weekly offers only). With the full catalogs it became a product
scraper and was renamed supermarket-scraper: GitHub repository, images
(`supermarket-scraper-db/-api/-web`), containers, NAS directories
(`/volume1/docker/supermarket-scraper`, `-acc`) and domains
(`supermarkets.shelly-nas.nl`, `supermarkets-acc.shelly-nas.nl`; the old
`discounts*` domains no longer route), database and user (`supermarket`,
`supermarket_user`) and the database volume. Nothing ran in production yet, so
nothing was migrated: production starts on a new, empty database, and Baskit
reads the API as `supermarket-scraper-api` (acc: `supermarket-scraper-acc-api`).

### 1.2 Business Goals

- **Price Transparency**: Enable consumers to compare discounts across multiple supermarkets
- **Time Savings**: Eliminate manual browsing of multiple supermarket websites
- **Data-Driven Decisions**: Provide historical discount data for trend analysis
- **Automation**: Reduce manual effort through scheduled scraping operations
- **Reliability**: Track scraper performance and maintain data quality

### 1.3 Target Audience

- **End Consumers**: Individuals looking for the best grocery deals
- **Budget-Conscious Shoppers**: Users wanting to optimize shopping expenses
- **Data Analysts**: Users interested in discount patterns and price trends
- **System Administrators**: Technical users managing scraper operations

### 1.4 Key Benefits

- Centralized view of discounts from multiple supermarkets
- Real-time discount information with expiration tracking
- Fast full-text search across products (10-15x faster than JSON storage)
- Automated scheduling with promotion-based timing
- Complete audit trail of all scraping operations
- RESTful API for potential third-party integrations

---

## 2. Scope

### 2.1 In Scope

#### Core Features

- ✅ **Web Scraping Engine**

  - Automated discount data collection from Albert Heijn, Dirk, and PLUS
  - Playwright-based browser automation
  - Cookie consent handling
  - Product categorization
  - Promotion expiration date extraction

- ✅ **Data Management**

  - PostgreSQL database with optimized indexing
  - Product deduplication (by name + supermarket)
  - Discount lifecycle management (active/inactive states)
  - Historical data retention
  - UPSERT logic for data updates

- ✅ **Scheduling System**

  - Cron-based scheduler (checks every minute)
  - Promotion-driven scheduling (auto-schedules next run based on expiry)
  - Manual trigger capability
  - Enable/disable per supermarket

- ✅ **REST API**

  - Discount retrieval endpoints
  - Scraper execution triggers
  - Run history and statistics
  - Dashboard metrics
  - Scheduler management

- ✅ **Product Catalog**

  - Weekly full assortment scrape with regular prices for all seven supermarkets (Albert Heijn, Aldi, Dirk, Hoogvliet, Jumbo, Lidl food assortment, PLUS)
  - Price history and catalog run tracking; on-demand runs from the "Full assortment" section of the admin UI ("Run catalog")

- ✅ **Public Consumer API**

  - Versioned read-only API under `/api/public/v1` for the Baskit app
  - Search, supermarkets, categories and product detail endpoints

- ✅ **Web Interface**

  - shelly-nas house style (design guidelines from `shelly-nas/shelly-fundamentals`), light and dark mode
  - App shell with a sidebar on desktop and a top bar with a menu drawer on phones
  - Database view with sortable columns
  - Global and per-column search
  - Discount filtering (date, category, price)
  - Configurations dashboard
  - Scraper run logs with pagination

- ✅ **Monitoring & Logging**

  - Comprehensive run tracking
  - Success/failure metrics
  - Duration monitoring
  - Product and discount counters
  - Error message capture

- ✅ **Containerization**
  - Docker Compose orchestration
  - Three-tier architecture (database, API, web)
  - Environment-based configuration

### 2.2 Out of Scope (Current Version)

#### Not Implemented

- ❌ User authentication and authorization
- ❌ User accounts and personalization
- ❌ Price alerts and notifications
- ❌ Shopping list functionality
- ❌ Mobile native applications
- ❌ Email/SMS notifications
- ❌ Multi-language support (currently Dutch-focused)
- ❌ Product image storage
- ❌ Barcode/EAN matching across supermarkets
- ❌ Price history charts/visualization
- ❌ External API rate limiting
- ❌ Data export functionality (CSV/Excel)
- ❌ Advanced analytics dashboard
- ❌ Automatic product categorization across supermarkets

### 2.3 System Boundaries

```mermaid
graph TB
    subgraph "External Systems"
        AH[Albert Heijn Website]
        DIRK[Dirk Website]
        PLUS[PLUS Website]
    end

    subgraph "Supermarket Scraper System"
        SCRAPER[Scraper Service]
        API[REST API]
        WEB[Web Interface]
        DB[(PostgreSQL Database)]
        SCHEDULER[Scheduler Service]
    end

    subgraph "Users"
        CONSUMER[End Consumer]
        ADMIN[Administrator]
    end

    AH -->|HTTP| SCRAPER
    DIRK -->|HTTP| SCRAPER
    PLUS -->|HTTP| SCRAPER

    SCRAPER --> DB
    API --> DB
    SCHEDULER --> API

    CONSUMER -->|Browser| WEB
    ADMIN -->|Browser| WEB
    WEB -->|AJAX| API
    ADMIN -->|Trigger| API

    style SCRAPER fill:#e1f5ff
    style API fill:#e1f5ff
    style WEB fill:#e1f5ff
    style DB fill:#ffe1e1
    style SCHEDULER fill:#e1f5ff
```

### 2.4 Technology Stack

| Layer                | Technology              | Version |
| -------------------- | ----------------------- | ------- |
| **Frontend**         | React + TypeScript      | Latest  |
| **Frontend Build**   | Vite                    | Latest  |
| **Web Server**       | Nginx                   | Latest  |
| **Backend**          | Node.js + Express       | Latest  |
| **Language**         | TypeScript              | Latest  |
| **Web Scraping**     | Playwright              | Latest  |
| **Database**         | PostgreSQL              | 15+     |
| **Scheduling**       | node-cron               | Latest  |
| **Containerization** | Docker + Docker Compose | Latest  |
| **HTTP Client**      | Axios                   | Latest  |

---

## 3. User Stories & Use Cases

### 3.1 User Personas

#### Persona 1: Budget-Conscious Consumer (Maria)

- **Age**: 32
- **Occupation**: Teacher
- **Tech Savvy**: Medium
- **Goals**: Save money on groceries, plan weekly shopping
- **Pain Points**: Manually checking multiple websites is time-consuming

#### Persona 2: Deal Hunter (Tom)

- **Age**: 45
- **Occupation**: IT Professional
- **Tech Savvy**: High
- **Goals**: Find the absolute best deals, track discount patterns
- **Pain Points**: Wants API access, historical data

#### Persona 3: System Administrator (Admin)

- **Age**: 28
- **Occupation**: DevOps Engineer
- **Tech Savvy**: Expert
- **Goals**: Ensure scrapers run reliably, monitor system health
- **Pain Points**: Needs visibility into scraper failures, run metrics

### 3.2 User Stories

#### Epic 1: Discount Discovery

```
US-001: View Active Discounts
As a consumer
I want to see all active discounts from all supermarkets
So that I can find the best deals without visiting multiple websites

Acceptance Criteria:
- Display products with discount prices
- Show original price vs. discount price
- Display expiration date
- Filter by supermarket
- Search by product name
```

```
US-002: Search for Specific Products
As a consumer
I want to search for specific products by name
So that I can quickly find deals on items I need

Acceptance Criteria:
- Full-text search functionality
- Search across all supermarkets
- Display results within 1 second
- Highlight search terms in results
```

```
US-003: Filter Discounts by Criteria
As a consumer
I want to filter discounts by price range, category, and expiration date
So that I can narrow down deals relevant to me

Acceptance Criteria:
- Filter by price range (min/max)
- Filter by product category
- Filter by expiration date
- Combine multiple filters
- Clear all filters option
```

#### Epic 2: Scraper Management

```
US-004: Trigger Manual Scraper Run
As an administrator
I want to manually trigger a scraper for a specific supermarket
So that I can get fresh data on demand

Acceptance Criteria:
- Button to trigger each supermarket scraper
- Confirmation dialog before running
- Visual feedback during execution
- Success/failure notification
- Updated data immediately visible
```

```
US-005: Monitor Scraper Performance
As an administrator
I want to view scraper run history and metrics
So that I can ensure the system is functioning properly

Acceptance Criteria:
- View all scraper runs with timestamps
- See success/failure status
- View products scraped/created/updated counts
- View run duration
- Filter by supermarket
- Paginated results
```

```
US-006: View System Statistics
As an administrator
I want to see overall system statistics
So that I can understand system health at a glance

Acceptance Criteria:
- Total number of runs
- Overall success rate
- Total active products
- Unique products count
- Next scheduled run time
```

#### Epic 3: Scheduled Operations

```
US-007: Automatic Scheduled Scraping
As an administrator
I want scrapers to run automatically based on promotion schedules
So that data stays fresh without manual intervention

Acceptance Criteria:
- Scrapers schedule next run based on promotion expiry (the day after, at 03:00), catalog first
- Scheduler checks every minute for due runs
- Failed runs don't block future schedules
- Logging of all automated runs
```

```
US-008: Enable/Disable Scheduled Runs
As an administrator
I want to enable or disable scheduled runs per supermarket
So that I can control when automated scraping occurs

Acceptance Criteria:
- Toggle scheduled runs on/off per supermarket
- Status persists across system restarts
- Visual indication of enabled/disabled state
- Manual runs still work when disabled
```

### 3.3 Use Cases

#### Use Case 1: View Current Discounts

```mermaid
sequenceDiagram
    actor Consumer
    participant Web as Web Interface
    participant API as REST API
    participant DB as Database

    Consumer->>Web: Navigate to Discounts View
    Web->>API: GET /api/discounts
    API->>DB: SELECT products with active discounts
    DB-->>API: Return discount data
    API-->>Web: JSON response
    Web->>Web: Render table with sorting
    Web-->>Consumer: Display discounts

    Consumer->>Web: Enter search term
    Web->>Web: Filter client-side
    Web-->>Consumer: Show filtered results

    Consumer->>Web: Apply category filter
    Web->>Web: Filter client-side
    Web-->>Consumer: Show filtered results
```

**Preconditions:**

- System is running and accessible
- At least one scraper has completed successfully
- Active discounts exist in database

**Main Flow:**

1. Consumer navigates to web interface (http://localhost:3000)
2. System loads and displays all active discounts
3. Discounts are sorted by expiration date, category, and name
4. Consumer can search by product name
5. Consumer can filter by category, price, or expiration date
6. Results update in real-time

**Postconditions:**

- Consumer views relevant discount information
- No data is modified

**Alternative Flows:**

- **3a**: No discounts available → Display "No discounts found" message
- **4a**: Search returns no results → Display "No matching products"

#### Use Case 2: Run Scraper Manually

```mermaid
sequenceDiagram
    actor Admin
    participant Web as Web Interface
    participant API as REST API
    participant Scraper as Scraper Service
    participant Client as Supermarket Client
    participant External as Supermarket Website
    participant DB as Database

    Admin->>Web: Click "Run offers" for Albert Heijn (Weekly offers section)
    Web->>Admin: Show confirmation dialog
    Admin->>Web: Confirm
    Web->>API: POST /api/scraper/run/albert-heijn

    API->>DB: Create scraper_run record (status: running)
    API->>DB: Fetch supermarket config
    DB-->>API: Return config

    API->>Scraper: Initialize scraper
    Scraper->>Client: Create AhClient
    Client->>External: Navigate to URL
    Client->>External: Handle cookie popup
    Client->>External: Get promotion expiry date

    loop For each product category
        Client->>External: Scrape discount products
        External-->>Client: Return product data
    end

    Client-->>Scraper: Return all discount data

    Scraper->>DB: Upsert products
    Scraper->>DB: Deactivate old discounts
    Scraper->>DB: Insert new discounts
    Scraper->>DB: Update scraper_run (status: success)
    Scraper->>DB: Create/update scheduled_run

    API-->>Web: Success response
    Web->>API: GET /api/dashboard/statuses
    API-->>Web: Updated statuses
    Web-->>Admin: Show success message & updated data
```

**Preconditions:**

- Administrator has access to Configurations page
- Database is accessible
- Target supermarket website is reachable
- Scraper is not already running for this supermarket

**Main Flow:**

1. Administrator navigates to Configurations page
2. Administrator clicks "Run offers" for the desired supermarket in the Weekly offers section
3. System displays confirmation dialog
4. Administrator confirms action
5. System creates scraper_run record with "running" status
6. Scraper initializes Playwright browser
7. Scraper navigates to supermarket website
8. Scraper handles cookie consent popup
9. Scraper extracts promotion expiration date
10. For each product category:
    - Scraper finds discount products
    - Scraper extracts product details (name, prices, category)
11. System upserts products to database
12. System marks old discounts as inactive
13. System creates new discount records
14. System updates scraper_run to "success"
15. System schedules next run based on promotion expiry
16. Web interface refreshes to show new data

**Postconditions:**

- New/updated products exist in database
- Old discounts marked as inactive (active=false)
- New discounts created with active=true
- Scraper run logged with metrics
- Next run scheduled
- Administrator sees success confirmation

**Alternative Flows:**

- **6a**: Browser initialization fails → Log error, update run status to "failed"
- **7a**: Website unreachable → Timeout, mark run as "failed"
- **8a**: Cookie popup not found → Log warning, continue
- **10a**: No products found → Log warning, complete with 0 products
- **11a**: Database error → Rollback transaction, mark run as "failed"

#### Use Case 3: Automated Scheduled Scraping

```mermaid
sequenceDiagram
    participant Cron as Cron Job (every minute)
    participant Scheduler as Scheduler Service
    participant DB as Database
    participant API as Internal API
    participant Scraper as Scraper Service

    loop Every minute
        Cron->>Scheduler: Trigger check
        Scheduler->>DB: Deactivate expired discounts
        DB-->>Scheduler: Count of deactivated

        Scheduler->>DB: SELECT due scheduled_runs
        DB-->>Scheduler: Return due runs (if any)

        alt Has due runs
            loop For each due run
                Scheduler->>API: POST /api/scraper/run/:supermarket
                API->>Scraper: Execute scraper (async)
                Scraper-->>API: Acknowledge start
                API-->>Scheduler: 200 OK

                Note over Scraper,DB: Scraper runs in background
                Scraper->>DB: Update data
                Scraper->>DB: Schedule next run
            end
        else No due runs
            Scheduler->>Scheduler: Log "No due runs"
        end
    end
```

**Preconditions:**

- Scheduler service is running
- At least one scheduled_run exists with enabled=true
- scheduled_run.next_run_at <= current time

**Main Flow:**

1. Cron job triggers every minute
2. Scheduler checks for expired discounts
3. System deactivates discounts where expire_date < NOW()
4. Scheduler queries scheduled_runs table for due runs
5. For each due run:
   - Scheduler sets next_run_at to a retry 3 hours later (fallback)
   - Scheduler runs the supermarket's catalog scrape and waits for it
   - Scheduler triggers the offers scraper via internal API
   - Scraper completes and sets next_run_at from the offers' end date (FR-003.2, FR-003.10)
6. Scheduler logs completion and waits for next cycle

**Postconditions:**

- Expired discounts marked as inactive
- Due scrapers executed
- Next run times updated
- All operations logged

**Alternative Flows:**

- **4a**: No due runs → Log "No due runs", wait for next cycle
- **5a**: API call fails → Log error, continue with other scrapers
- **5b**: Weekly run still in progress → Skip, check again at the retry time
- **5c**: Catalog run fails → Log error, continue with the offers run
- **5d**: Offers run fails → next_run_at stays at the retry 3 hours later

#### Use Case 4: Search and Filter Discounts

```mermaid
flowchart TD
    Start([Consumer Opens Discounts View]) --> LoadData[Load All Active Discounts]
    LoadData --> DisplayTable[Display in Sortable Table]

    DisplayTable --> UserAction{User Action?}

    UserAction -->|Search| GlobalSearch[Apply Global Search Filter]
    UserAction -->|Column Filter| ColumnFilter[Apply Column-Specific Filter]
    UserAction -->|Sort| SortColumn[Sort by Column]
    UserAction -->|Quick Filter| QuickFilter[Apply Quick Filter]

    GlobalSearch --> FilterData[Filter Dataset Client-Side]
    ColumnFilter --> FilterData
    QuickFilter --> FilterData
    SortColumn --> SortData[Sort Dataset Client-Side]

    FilterData --> UpdateDisplay[Update Table Display]
    SortData --> UpdateDisplay

    UpdateDisplay --> UserAction

    UserAction -->|Clear| ClearFilters[Reset All Filters]
    ClearFilters --> DisplayTable

    UserAction -->|Exit| End([End])

    style Start fill:#90EE90
    style End fill:#FFB6C1
    style FilterData fill:#87CEEB
    style SortData fill:#87CEEB
```

**Preconditions:**

- Discounts data loaded in web interface
- Consumer on Discounts View page

**Main Flow:**

1. Consumer enters text in global search bar
2. System filters all columns for matching text
3. Table updates to show only matching rows
4. Consumer applies additional column filter (e.g., category)
5. System further filters results
6. Consumer clicks column header to sort
7. System sorts visible results
8. Consumer can clear all filters to reset view

**Postconditions:**

- Table shows filtered/sorted results
- Original data unchanged
- Filter state persists during session

---

## 4. Functional Requirements

### 4.1 Core System Requirements

#### FR-001: Web Scraping Engine

| ID        | Requirement                                                                  | Priority | Status         |
| --------- | ---------------------------------------------------------------------------- | -------- | -------------- |
| FR-001.1  | System SHALL scrape discount data from Albert Heijn: one discount per product (not per promotion group such as "Alle Felix"), from the AH mobile API product search with the bonus filter, per top-level category. Only the weekly store bonus (`promotionType` NATIONAL) is kept; online-only, Etos, Gall & Gall, the long-running "Voordeelshop" and standing volume discounts are skipped. Each discount has the regular price, the bonus price per item (multi-buy labels worked out per item), the pack size and price per unit, its own end date, the group name in the special discount text, and `externalId` = webshopId | HIGH     | ✅ Implemented |
| FR-001.2  | System SHALL scrape discount data from Dirk website                          | HIGH     | ✅ Implemented |
| FR-001.3  | System SHALL scrape discount data from PLUS website                          | HIGH     | ✅ Implemented |
| FR-001.4  | System SHALL handle cookie consent popups automatically                      | HIGH     | ✅ Implemented |
| FR-001.5  | System SHALL extract promotion expiration dates per offer; the run's expiry (which schedules the next run) is the weekly folder's end date, i.e. the most common end date, so long-running promotions do not postpone the next run. Lidl reads each tile's own end date (`storeEndDate`) from the offers page | HIGH     | ✅ Implemented |
| FR-001.6  | System SHALL extract product names, categories, prices, discount details, and product URLs | HIGH     | ✅ Implemented |
| FR-001.7  | System SHALL use Playwright for browser automation                           | HIGH     | ✅ Implemented |
| FR-001.8  | System SHALL support configurable web identifiers per supermarket            | MEDIUM   | ✅ Implemented |
| FR-001.9  | System SHALL log all scraping activities with timestamps                     | MEDIUM   | ✅ Implemented |
| FR-001.10 | System SHALL handle network timeouts gracefully                              | MEDIUM   | ✅ Implemented |

#### FR-002: Data Storage & Management

| ID        | Requirement                                                            | Priority | Status         |
| --------- | ---------------------------------------------------------------------- | -------- | -------------- |
| FR-002.1  | System SHALL store all data in PostgreSQL database                     | HIGH     | ✅ Implemented |
| FR-002.2  | System SHALL enforce unique constraint on product (name + supermarket) | HIGH     | ✅ Implemented |
| FR-002.3  | System SHALL update existing products instead of creating duplicates   | HIGH     | ✅ Implemented |
| FR-002.4  | System SHALL maintain active/inactive status for discounts             | HIGH     | ✅ Implemented |
| FR-002.5  | System SHALL preserve historical discount data                         | MEDIUM   | ✅ Implemented |
| FR-002.6  | System SHALL use optimized indexes for fast queries                    | HIGH     | ✅ Implemented |
| FR-002.7  | System SHALL support full-text search on product names                 | MEDIUM   | ✅ Implemented |
| FR-002.8  | System SHALL automatically update timestamps on record changes         | LOW      | ✅ Implemented |
| FR-002.9  | System SHALL cascade delete discounts when products are deleted        | MEDIUM   | ✅ Implemented |
| FR-002.10 | System SHALL store supermarket configurations in database              | MEDIUM   | ✅ Implemented |

#### FR-003: Scheduling System

| ID       | Requirement                                                            | Priority | Status         |
| -------- | ---------------------------------------------------------------------- | -------- | -------------- |
| FR-003.1 | System SHALL check for due scraper runs every minute                   | HIGH     | ✅ Implemented |
| FR-003.2 | System SHALL schedule the next run the day after the offers end (the run's expiry, FR-001.5) at 03:00 Europe/Amsterdam, not at midnight, so the supermarket has published its new week | HIGH     | ✅ Implemented |
| FR-003.3 | System SHALL support enable/disable toggle per supermarket             | MEDIUM   | ✅ Implemented |
| FR-003.4 | System SHALL NOT run multiple instances of same scraper concurrently   | HIGH     | ✅ Implemented |
| FR-003.5 | System SHALL deactivate expired discounts on each scheduler check      | HIGH     | ✅ Implemented |
| FR-003.6 | System SHALL log all scheduler activities                              | MEDIUM   | ✅ Implemented |
| FR-003.7 | System SHALL persist scheduled run state across restarts               | MEDIUM   | ✅ Implemented |
| FR-003.8 | System SHALL trigger scrapers via internal API calls                   | MEDIUM   | ✅ Implemented |
| FR-003.9 | System SHALL run each supermarket's weekly auto run as catalog first, then offers, so regular prices and offers change on the supermarket's own week (AH Monday to Sunday, others their own); a failed catalog run does not stop the offers run | HIGH | ✅ Implemented |
| FR-003.10 | System SHALL fall back when a date is missed: (a) while a run is in progress the next run is set to a retry 3 hours later, replaced by a successful offers run, so a failed or hanging run is retried; (b) offers without an end date, or whose end date has already passed (the site still showed the old week), are fetched again 3 hours later; (c) runs are never more than 7 days apart, also when the end date is further away; (d) a run that was due while the server was down starts on the next check | HIGH | ✅ Implemented |
| FR-003.11 | System SHALL keep the per-supermarket enabled setting when a run updates the schedule, so a manual run does not switch the automatic runs back on | MEDIUM | ✅ Implemented |

#### FR-004: REST API

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

#### FR-007: Product Catalog

| ID       | Requirement                                                                                           | Priority | Status         |
| -------- | ----------------------------------------------------------------------------------------------------- | -------- | -------------- |
| FR-007.1 | System SHALL scrape the full assortment with regular prices for supermarkets that have a catalog client | HIGH   | ✅ All seven supermarkets |
| FR-007.2 | System SHALL store the supermarket product id, brand, pack size, unit price, image and regular price   | HIGH     | ✅ Implemented |
| FR-007.3 | System SHALL record a price history row only when a regular price changes                             | MEDIUM   | ✅ Implemented |
| FR-007.4 | System SHALL mark products missing from a run as not in the catalog, unless the run saw under 50% of the known products | MEDIUM | ✅ Implemented |
| FR-007.5 | System SHALL run each supermarket's catalog scrape in its weekly auto run, right before its offers run (FR-003.9), and on demand from the admin UI; `CATALOG_ENABLED=false` leaves the catalog step out | MEDIUM | ✅ Implemented |
| FR-007.6 | System SHALL track every catalog run (status, counts, duration, error) in `catalog_runs`             | MEDIUM   | ✅ Implemented |
| FR-007.7 | System SHALL apply schema migrations from `scraper/migrations` on startup                              | HIGH     | ✅ Implemented |
| FR-007.8 | Catalog clients for Dirk, PLUS and Aldi                                                                | MEDIUM   | ✅ Implemented |
| FR-007.10 | System SHALL store each catalog product's pack quantity normalised to kg, l or stuk (`quantity_value`, `quantity_unit`; supplied by the client or read from the pack size such as "500 g", "6 x 330 ml", "4 stuks") and expose `pricePerUnit` (current price / quantity) in the public API | HIGH | ✅ Implemented |
| FR-007.12 | System SHALL store an offer's pack quantity (kg, l or stuk) on its product when the catalog does not keep that product, so offers get a `pricePerUnit` too: from the client (`quantity`: Jumbo pack size, Hoogvliet sub title, Lidl's pack size under the price such as "400 g" or "6x500 ml", else its key facts or title) or else read from the offer name ("Spekreepjes 2x190 g"). A catalog product keeps the catalog's quantity | HIGH | ✅ Implemented |
| FR-007.13 | System SHALL store only food and drink from Aldi: no clothing, home goods, tools, plants, toys, drugstore, household or pet products, in the catalog and in the offers | HIGH | ✅ Implemented |
| FR-007.11 | System SHALL link offers to products on the supermarket's own product id when the scraper provides one (`externalId`), so products sharing a name stay separate and offers land on the catalog row; without an id, offers are linked by name | HIGH | ✅ AH, Aldi, Dirk, Hoogvliet, Jumbo, PLUS, Lidl (by the permanent article number, FR-007.14) |

**Jumbo catalog and offers.** Both use jumbo.com's own GraphQL API
(`POST https://www.jumbo.com/api/graphql`) with the web client's headers
(`apollographql-client-name` / `x-source: JUMBO_WEB-search`,
`apollographql-client-version: master-v39.2.0-web`; without them the API
answers "No client headers set"). `searchProducts(input: { searchType:
category, searchTerms: "producten", offSet, limit })` lists the whole
assortment (about 17,100 products), at most 200 per page. Prices come in
cents; `pricePerUnit` follows the current (promotion) price. A product with a
missing required field (no title) makes Jumbo return `data: null` for its whole
page; the page is then split until that product is isolated and skipped.

- Quantity: from the pack size (`packSizeDisplay`, e.g. "6 x 1 L"), else the
  title, else current price / price per unit (pieces rounded to whole ones).
- The catalog stores the regular price (`price.price`) with its quantity and a
  unit price worked out from the regular price (on 16 October 2026: 17,126
  products, 17,086 with a quantity).
- The discount scraper (`JumboApiClient`) keeps products with a price
  promotion: Jumbo's `promoPrice` when lower, else the label worked out per
  item ("3 voor 6,00", "1+1 gratis", "25% korting", "voor 1,99"). Labels that
  are not about the price ("Gratis bezorging", "€2,00 bezorgkorting",
  "Vanaf € 12,00") are skipped. Promotion days come without a year and are
  dated to their next occurrence; standing offers without dates get the folder
  end (the most common end date), which is also the run's expiry date. On 16
  October 2026 this gave 1,550 offers (the previous HTML scraper found 13
  promotion cards).

Offer prices per item for multi-buy labels are worked out by
`utils/Promotion.promotionPrice`, shared by Hoogvliet and Jumbo.

**Hoogvliet catalog and offers.** hoogvliet.com is a Next.js shop on Magento 2
and exposes Magento's public GraphQL API (`https://hoogvliet.nl/graphql`,
header `Store: hoogvliet_nl`). The top-level categories come from
`categories(parent_id: 2)`; offer, theme-shop and seasonal categories are read
last so products keep their regular shelf. `categoryList { products }` lists
the SKUs per category (200 per page); `products(filter: { sku: { in } })`
(300 per call) returns the details: regular and final price, pack size and
price per kilo/liter/piece (`sub_title_attributes`) and the promotion
(`promotion_meta_data`: label, valid from/to). Promotion groups
(`GroupedProduct`, folder entries such as "Kitkat, Bros of Smarties") are
skipped; the products they bundle carry the promotion themselves.

- The catalog client stores every product at its regular price with its quantity
  (on 16 October 2026: 8,562 products, all with price and quantity).
- The discount scraper (`HoogvlietApiClient`) uses the same API and keeps
  products with a current promotion. The discount price is per item, also for
  multi-buy offers: "3 voor 6,00" is 2.00, "1 + 1 Gratis" half the regular
  price, "25% korting" and "2e halve prijs" (0.75 of the regular price) are
  worked out from the label. The run's expiry date is the most common end date
  (the weekly folder), since some promotions run for months.

**Dirk catalog and offers.** Both use Dirk's web gateway
(`https://web-gateway.dirk.nl/graphql`, the GraphQL API dirk.nl itself uses;
introspection is off, the site's own queries work without a login).
`listDepartments` gives the departments with their web groups (17 and 146 on
16 October 2026); `listWebGroupProducts(webGroupId)` with
`productAssortment(storeId: 66)` returns every product of a web group with its
regular price (`normalPrice`), offer price, pack size, brand and image at
dirk.nl's default store. Products that store does not sell come back as null
and are skipped.

- The catalog client stores every product at its regular price with its quantity
  (on 16 October 2026: 7,516 products, 99% with a quantity).
- The discount scraper (`DirkApiClient`) reads `listOffers` per department. A
  folder offer can cover many products ("Hak groente of appelmoes": 29 jars),
  so it becomes one discount per product, looked up with
  `products(storeId, productIds)` and linked by Dirk's product id at that
  product's own regular price. An offer whose products cannot be looked up is
  kept as one discount by name, as before.

**PLUS catalog and offers.** plus.nl is an OutSystems app behind Imperva, so it
is read through a headless browser (`clients/plus/PlusSite.ts`). The site's
product list call (`DataActionGetProductListAndCategoryInfo`) without a
category lists the whole assortment, 12 products per page (17,389 products on
1,450 pages on 16 October 2026). The scraper opens plus.nl, takes the request
the page itself sends as a template (it carries the current module and API
versions and the week period) and requests every page from inside the page.

- The catalog client stores each product's regular price (`OriginalPrice`),
  pack size ("Per 1000 ml", "Per kilo" as 1 kg) and SKU.
- The discount scraper (`PlusApiClient`) uses the same call with the "Nu in de
  aanbieding" filter (about 2,300 products), linked by SKU. The price per item
  comes from `NewPrice` or the label ("2 VOOR 6.00", "1+1 GRATIS",
  "50 % KORTING"); delivery offers are skipped.

**Aldi catalog and offers.** aldi.nl is built on an Algolia index whose
application id and search-only key ship in the site's JavaScript. One query
without a search term returns the whole index (3,806 objects on 16 October
2026, 1,000 per page): the regular assortment and the week offers as separate
objects in category `offer`.

- The catalog client stores every regular product with a price (2,335 on
  16 October 2026), with its pack size (`salesUnit`) and its shelf (the
  top-level category of its main category).
- The discount scraper (`AldiApiClient`) reads the current folder from the
  offers page (`aanbiedingen.html`, plain HTTP): its `__NEXT_DATA__` holds
  `OFFER_GET` with the folder categories ("Vanaf maandag", "Vanaf woensdag",
  ...), each with a start and end date and its products (215 products, all
  ending 18 October, on 16 October 2026). Each offer is valid until the end of
  its category; the offer objects' own validity in the index is not used, as
  most of them run weeks past the folder. An offer is linked to the regular
  product with the same id, or with its id after a leading 9; other offers are
  week articles of their own ("OP=OP"), linked by their own id. The regular
  price is the struck-through price (`strikePrice`), else the linked product's
  price. "2 VOOR" with price 2.00 is 1.00 per item.
- Only food and drink is stored (`clients/aldi/AldiFood.ts`). A regular product
  is food when one of its top-level categories is a food category (fresh,
  dairy, meat, drinks, ...) and non-food when it is "Baby en drogisterij",
  "Huishouden" or "Huisdieren"; mixed ranges (house brands, seasonal ranges)
  are decided by the subcategory ("Snoepgoed" food, "Speelgoed" non-food).
  Folder products have no category: one of a regular product follows that
  product, the others are judged by a word model (naive Bayes over name words
  and brand) learned on each run from the categorised regular products.
  Products with a weight or volume are kept when the model leans to food (not
  shampoo, detergent or pet food); products sold per piece, pair or set only
  when their words clearly say food, so clothing, tools, home goods and plants
  are skipped. On 16 October 2026 this kept 118 of the 215 folder products
  (all of "Vanaf woensdag" and "Vanaf zaterdag" skipped, no food dropped) and
  1,992 catalog products.
  Migration 006 removed the Aldi products stored before this filter; the next
  offer and catalog runs bring the food back.

| FR-007.9 | System SHALL record where a regular price comes from (`price_source`: `supermarket` or `checkjebon`) and keep catalog products without a known price (`regular_price` null; excluded from price comparison) | HIGH | ✅ Implemented |

**Lidl catalog.** Lidl does not publish regular prices online. The Lidl catalog
client crawls the food assortment pages on lidl.nl (starting at
`/c/assortiment-producten/s10008015`, following links whose slug contains
`assortiment` or `wijn`, at most 80 pages, meta refreshes followed) and reads
every product tile (`data-grid-data` JSON): article number, name, brand, pack
size, image, product URL and Lidl's taxonomy (food worlds only; the two naming
schemes are merged, other worlds become `Overig`). Only tiles with category
`Food` or `F+V` are kept. The regular price is, in order:

1. Lidl's own `oldPrice` when the product is on offer (`supermarket`);
2. a regular price Lidl itself showed in the last 180 days, next to an offer
   (FR-007.14); kept instead of the next two (`supermarket`);
3. the open [checkjebon.nl](https://github.com/supermarkt/checkjebon) dataset
   (MIT, refreshed daily; its Lidl data comes from boodschaapje.nl), matched on
   the tile's article number (`erpNumber`), else on the permanent article
   number (`nat`/`ians`, which checkjebon mostly uses), else on a name that
   occurs once in that dataset; the last two only with no conflicting pack
   size ("500 g" and "0,5 kg" agree) (`checkjebon`);
4. Lidl's own price without an offer (`supermarket`);
5. otherwise none: the product is in the catalog without a price.

If the checkjebon dataset cannot be loaded the run continues without prices.
On 15 October 2026 a run found about 2,360 food products, about half of them with a price.
Matching checkjebon on the permanent article number as well (17 October 2026)
left 421 of the 2,363 products without a price, down from 1,127.

| FR-007.14 | System SHALL store the regular price Lidl shows next to an offer as the catalog product's regular price (`price_source` `supermarket`, `price_observed_at` now, a `price_history` row when it is new or changed) and keep it over an outside dataset for 180 days | HIGH | ✅ Implemented |

**Lidl regular prices from offers.** Lidl gives an offer its own article
number (`erpNumber`, e.g. 11305717 for Yakult); the assortment tile has
another (6611698), but both tiles carry the permanent number in `nat`/`ians`.
The catalog stores it as `products.article_number`; an offer with
`articleNumbers` lands on the catalog row with one of those numbers. Variants
can share a permanent number, so the row with the offer's pack quantity wins
(within 2%); a single row is taken when one side does not know its quantity;
two equal candidates or only other pack sizes link nothing, and the offer is
stored under its own id as before. When an offer is linked, an active offer on
an older offer-only row with the same own id is deactivated, so the offer is
not listed twice. The offer's regular price (the struck-through price, which
under EU price indication rules is the lowest price of the past 30 days) is
stored on the product it lands on, so the catalog gains and corrects Lidl
prices week by week. In the week of 17 October 2026, 33 of the 75 offers with
a struck-through price landed on a catalog row; 7 of those corrected an
outdated checkjebon price (e.g. plums 2.49 to 1.89).

#### FR-008: Same Product Across Supermarkets and Product Images

| ID       | Requirement | Priority | Status |
| -------- | ----------- | -------- | ------ |
| FR-008.1 | System SHALL store the barcode (`products.ean`, valid GS1 check digit) where a supermarket publishes it | MEDIUM | ✅ Implemented |
| FR-008.2 | System SHALL recognise the same product at other supermarkets: equal barcode, or equal brand, pack quantity and name words | HIGH | ✅ Implemented |
| FR-008.3 | System SHALL show per product the same product at the other supermarkets (`sameProduct` on `GET /products/:id`) | HIGH | ✅ Implemented |
| FR-008.4 | The price comparison SHALL use the same product at the other supermarkets for an item added from a product, before a name search | HIGH | ✅ Implemented |
| FR-008.5 | System SHALL store a product image for catalog products and for offers (an offer only fills in a missing image) | MEDIUM | ✅ Implemented |
| FR-008.6 | System SHALL serve product images through its own cached image proxy (`GET /api/public/v1/images/:id`) | MEDIUM | ✅ Implemented |

**Why not barcodes alone.** Only Jumbo (`ean` in its GraphQL) and part of
Hoogvliet (the GTIN in the path of the GDSN label link, `bijsluiter`) publish
barcodes. AH, Dirk, PLUS, Aldi and Lidl do not. The approach follows
supermarktscanner.nl, which lists "Chocomel Vol 1 liter" at seven
supermarkets although the names differ ("Chocomel Chocolademelk vol" at Dirk,
"Chocomel Vol 1 L" at Jumbo).

**Match fields** (`utils/ProductMatch.ts`), written on every catalog and offer
upsert and filled for older rows on startup:

- `match_brand`: the brand as one word without punctuation ("Coca-Cola" ->
  `cocacola`); without a brand the first word of the name.
- `match_tokens`: the remaining name words, lower case, without accents, pack
  sizes ("1,5 L", "6 x 200 ml"), packaging words (pak, fles, krat,
  voordeelpak, ...) and brand words; "jonge"/"jong" count as one word; sorted.
- Hoogvliet names leave the brand out ("Vol"); its brand is read from the url
  key (`chocomel-vol-076401000` -> Chocomel).

**Same product rule** (`isSameProduct`): when both have a barcode, the barcode
decides. Otherwise the brand must be equal, the quantity equal within 2% (both
known), and the name words equal. A word that a supermarket uses in at least
60% of its names of that brand (with 3 or more products, e.g. "chocolademelk"
at Dirk) is ignored for that supermarket, but only when the other name lacks
it, so vol and halfvol stay apart. The rule is strict on purpose: a missed
match falls back to the name search, a wrong match would show a wrong price.
Per supermarket the cheapest same product (current price) is used.

**Images.** Every catalog client and every discount client stores the
supermarket's image URL (`products.image_url`); an offer only fills an empty
image, the catalog image wins. The image proxy fetches an image on first request (browser user
agent, 15 s timeout, at most 5 MB, only `image/*`), stores it on disk in
`IMAGE_CACHE_DIR` (default: the container's temp directory) under the product
id plus a hash of the URL, and serves it with `Cache-Control: public,
max-age=604800` and an `ETag`. A changed image URL is fetched again. 404 when
the product has no image or the supermarket does not serve it.

#### FR-005: Web Interface

| ID        | Requirement                                                        | Priority | Status         |
| --------- | ------------------------------------------------------------------ | -------- | -------------- |
| FR-005.1  | System SHALL provide web interface accessible via browser          | HIGH     | ✅ Implemented |
| FR-005.2  | System SHALL display all active discounts in table format          | HIGH     | ✅ Implemented |
| FR-005.3  | System SHALL support global search across all columns              | HIGH     | ✅ Implemented |
| FR-005.4  | System SHALL support per-column text filtering                     | MEDIUM   | ✅ Implemented |
| FR-005.5  | System SHALL support sorting by any column                         | MEDIUM   | ✅ Implemented |
| FR-005.6  | System SHALL provide quick filters (date, category, name)          | MEDIUM   | ✅ Implemented |
| FR-005.7  | System SHALL display default sorting by expiration, category, name | MEDIUM   | ✅ Implemented |
| FR-005.8  | System SHALL provide Configurations dashboard                      | MEDIUM   | ✅ Implemented |
| FR-005.9  | System SHALL display KPIs (runs, success rate, products)           | MEDIUM   | ✅ Implemented |
| FR-005.10 | System SHALL provide manual scraper trigger buttons in two sections: "Weekly offers" (current discounts, "Run offers", with an "Auto re-scrape" switch) and "Full assortment" (catalog at regular price, "Run catalog") | MEDIUM | ✅ Implemented |
| FR-005.11 | System SHALL display scraper run logs with pagination              | MEDIUM   | ✅ Implemented |
| FR-005.12 | System SHALL follow the shelly-nas design guidelines (`shelly-fundamentals`, skill `design-richtlijnen`): Figtree, color roles from `tokens.css`, components from `components.css`, status as dot plus word | LOW | ✅ Implemented |
| FR-005.13 | System SHALL be responsive for mobile devices                      | LOW      | ✅ Implemented |
| FR-005.14 | System SHALL provide confirmation dialog before running scrapers   | MEDIUM   | ✅ Implemented |
| FR-005.15 | System SHALL display an external link icon next to product names that opens the supermarket offer page | LOW | ✅ Implemented |
| FR-005.16 | System SHALL show a product thumbnail (through the image proxy) next to product names, with a placeholder icon when there is no image | LOW | ✅ Implemented |
| FR-005.17 | System SHALL offer a system, light and dark theme, remembered per browser, applied before the first paint so dark mode never flashes white | LOW | ✅ Implemented |
| FR-005.18 | System SHALL show skeletons while loading, and an empty or error state that says what happened and what to do next (with "Try again" on errors) | LOW | ✅ Implemented |
| FR-005.19 | System SHALL show failed actions (offers run, schedule toggle, catalog start) as an inline error alert on the page instead of a browser popup | LOW | ✅ Implemented |
| FR-005.20 | System SHALL show the pack size under the product name and the discount price per kilo, liter or piece in its own column (from the product's `quantity_value`/`quantity_unit`; "—" without a known quantity) | MEDIUM | ✅ Implemented |

#### FR-006: Monitoring & Logging

| ID       | Requirement                                                           | Priority | Status         |
| -------- | --------------------------------------------------------------------- | -------- | -------------- |
| FR-006.1 | System SHALL log all scraper activities to dedicated log files        | HIGH     | ✅ Implemented |
| FR-006.2 | System SHALL track scraper run status (running/success/failed)        | HIGH     | ✅ Implemented |
| FR-006.3 | System SHALL record products scraped/created/updated counts           | HIGH     | ✅ Implemented |
| FR-006.4 | System SHALL record discounts created/deactivated counts              | HIGH     | ✅ Implemented |
| FR-006.5 | System SHALL measure and store run duration                           | MEDIUM   | ✅ Implemented |
| FR-006.6 | System SHALL capture error messages for failed runs                   | HIGH     | ✅ Implemented |
| FR-006.7 | System SHALL log server activities separately from scraper activities | MEDIUM   | ✅ Implemented |
| FR-006.8 | System SHALL support configurable log levels                          | LOW      | ✅ Implemented |

### 4.2 Non-Functional Requirements

#### NFR-001: Performance

| ID        | Requirement                                                        | Priority | Status         |
| --------- | ------------------------------------------------------------------ | -------- | -------------- |
| NFR-001.1 | System SHALL return search results within 1 second                 | HIGH     | ✅ Implemented |
| NFR-001.2 | System SHALL complete scraper run within 5 minutes per supermarket | MEDIUM   | ✅ Implemented |
| NFR-001.3 | Database queries SHALL be 10-15x faster than JSON storage          | HIGH     | ✅ Implemented |
| NFR-001.4 | System SHALL support concurrent read operations                    | MEDIUM   | ✅ Implemented |
| NFR-001.5 | Web interface SHALL load within 2 seconds                          | MEDIUM   | ✅ Implemented |

#### NFR-002: Reliability

| ID        | Requirement                                                         | Priority | Status         |
| --------- | ------------------------------------------------------------------- | -------- | -------------- |
| NFR-002.1 | System SHALL recover gracefully from scraper failures               | HIGH     | ✅ Implemented |
| NFR-002.2 | System SHALL continue operation if one supermarket is unreachable   | HIGH     | ✅ Implemented |
| NFR-002.3 | Database transactions SHALL be ACID-compliant                       | HIGH     | ✅ Implemented |
| NFR-002.4 | System SHALL maintain data consistency during concurrent operations | HIGH     | ✅ Implemented |

#### NFR-003: Scalability

| ID        | Requirement                                                         | Priority | Status         |
| --------- | ------------------------------------------------------------------- | -------- | -------------- |
| NFR-003.1 | System SHALL support addition of new supermarkets via configuration | MEDIUM   | ✅ Implemented |
| NFR-003.2 | Database schema SHALL support thousands of products                 | HIGH     | ✅ Implemented |
| NFR-003.3 | System SHALL handle multiple concurrent web users                   | MEDIUM   | ✅ Implemented |

#### NFR-004: Maintainability

| ID        | Requirement                                                   | Priority | Status         |
| --------- | ------------------------------------------------------------- | -------- | -------------- |
| NFR-004.1 | System SHALL use TypeScript for type safety                   | MEDIUM   | ✅ Implemented |
| NFR-004.2 | Code SHALL follow modular architecture patterns               | MEDIUM   | ✅ Implemented |
| NFR-004.3 | Configuration SHALL be externalized via environment variables | HIGH     | ✅ Implemented |
| NFR-004.4 | Database schema SHALL include documentation comments          | LOW      | ✅ Implemented |

#### NFR-005: Usability

| ID        | Requirement                                              | Priority | Status         |
| --------- | -------------------------------------------------------- | -------- | -------------- |
| NFR-005.1 | Web interface SHALL be intuitive without training        | HIGH     | ✅ Implemented |
| NFR-005.2 | System SHALL provide visual feedback for long operations | MEDIUM   | ✅ Implemented |
| NFR-005.3 | Error messages SHALL be clear and actionable             | MEDIUM   | ✅ Implemented |

#### NFR-006: Deployment

| ID        | Requirement                                          | Priority | Status         |
| --------- | ---------------------------------------------------- | -------- | -------------- |
| NFR-006.1 | System SHALL be deployable via Docker Compose        | HIGH     | ✅ Implemented |
| NFR-006.2 | System SHALL start all services with single command  | HIGH     | ✅ Implemented |
| NFR-006.3 | Database SHALL initialize automatically on first run | HIGH     | ✅ Implemented |
| NFR-006.4 | System SHALL support environment-based configuration | HIGH     | ✅ Implemented |
| NFR-006.5 | Every pull request SHALL be deployed to an acceptance environment with a fresh database of demo data; demo data SHALL never reach production | MEDIUM | ✅ Implemented |

### 4.3 System Behavior

#### Discount Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Scraped: Scraper finds product
    Scraped --> Active: Insert into database<br/>(active=true)
    Active --> Active: Same discount found<br/>in next scrape
    Active --> Inactive: Not found in next scrape<br/>OR expire_date < NOW()
    Inactive --> Active: Discount reappears<br/>in later scrape
    Inactive --> [*]: Manual cleanup<br/>(optional)

    Active --> Expired: expire_date < NOW()<br/>(scheduler check)
    Expired --> [*]: Marked inactive

    note right of Active
        Visible in web interface
        Included in API responses
        Searchable by users
    end note

    note right of Inactive
        Hidden from web interface
        Excluded from API responses
        Preserved for history
    end note
```

#### Scraper Run States

```mermaid
stateDiagram-v2
    [*] --> Created: Create scraper_run record
    Created --> Running: Initialize browser
    Running --> Scraping: Navigate to website
    Scraping --> Processing: Extract data
    Processing --> Updating: Update database
    Updating --> Scheduling: Create scheduled_run
    Scheduling --> Success: Complete successfully

    Running --> Failed: Browser error
    Scraping --> Failed: Network timeout
    Processing --> Failed: Data extraction error
    Updating --> Failed: Database error

    Success --> [*]: Run logged
    Failed --> [*]: Error logged

    note right of Success
        - Status: success
        - Metrics recorded
        - Next run scheduled
        - Duration calculated
    end note

    note right of Failed
        - Status: failed
        - Error message stored
        - No next run scheduled
        - Admin notified via logs
    end note
```

---

## 5. Data Structure

### 5.1 Entity Relationship Diagram

```mermaid
erDiagram
    SUPERMARKET_CONFIGS ||--o{ PRODUCTS : "defines scraping for"
    PRODUCTS ||--o{ DISCOUNTS : "has"
    SUPERMARKET_CONFIGS ||--o{ SCRAPER_RUNS : "tracks runs for"
    SUPERMARKET_CONFIGS ||--o| SCHEDULED_RUNS : "schedules"

    SUPERMARKET_CONFIGS {
        serial id PK
        varchar name UK "Unique supermarket name"
        varchar name_short
        varchar url
        jsonb web_identifiers "Scraping selectors"
        timestamp created_at
        timestamp updated_at
    }

    PRODUCTS {
        serial id PK
        varchar name
        varchar category
        varchar supermarket FK
        timestamp created_at
        timestamp updated_at
        unique name_supermarket "UK: (name, supermarket)"
    }

    DISCOUNTS {
        serial id PK
        integer product_id FK
        decimal original_price
        decimal discount_price
        varchar unit_price "e.g., €1.49/kg, null when unavailable"
        varchar special_discount "e.g., 2+1 free"
        timestamp expire_date
        boolean active "true=active, false=inactive"
        timestamp created_at
    }

    SCRAPER_RUNS {
        serial id PK
        varchar supermarket FK
        varchar status "running|success|failed"
        integer products_scraped
        integer products_updated
        integer products_created
        integer discounts_deactivated
        integer discounts_created
        text error_message
        timestamp started_at
        timestamp completed_at
        integer duration_seconds
        timestamp promotion_expire_date
        timestamp created_at
        timestamp updated_at
    }

    SCHEDULED_RUNS {
        serial id PK
        varchar supermarket UK
        timestamp next_run_at
        timestamp promotion_expire_date
        boolean enabled
        timestamp created_at
        timestamp updated_at
    }
```

### 5.2 Table Specifications

#### Table: supermarket_configs

**Purpose:** Store configuration for each supermarket including scraping identifiers

| Column          | Type         | Constraints      | Description                                  |
| --------------- | ------------ | ---------------- | -------------------------------------------- |
| id              | SERIAL       | PRIMARY KEY      | Auto-incrementing ID                         |
| name            | VARCHAR(255) | NOT NULL, UNIQUE | Full supermarket name (e.g., "Albert Heijn") |
| name_short      | VARCHAR(50)  | NULL             | Short name (e.g., "AH")                      |
| url             | VARCHAR(512) | NOT NULL         | Base URL for scraping                        |
| web_identifiers | JSONB        | NOT NULL         | CSS selectors and scraping configuration     |
| created_at      | TIMESTAMP    | DEFAULT NOW()    | Record creation timestamp                    |
| updated_at      | TIMESTAMP    | DEFAULT NOW()    | Last update timestamp                        |

**Indexes:**

- `idx_supermarket_name` on `name`

**Sample Data:**

```json
{
  "name": "Albert Heijn",
  "name_short": "AH",
  "url": "https://www.ah.nl/bonus",
  "web_identifiers": {
    "cookieDecline": "button#decline-cookies",
    "promotionExpireDate": "div.promotion-period",
    "productCategories": ["category1", "category2"],
    "products": "div.product-card",
    "promotionProducts": {
      "name": "h3.product-name",
      "price": "span.price",
      "discount": "span.discount"
    }
  }
}
```

#### Table: products

**Purpose:** Store unique products identified by name + supermarket combination

| Column      | Type         | Constraints   | Description                   |
| ----------- | ------------ | ------------- | ----------------------------- |
| id          | SERIAL       | PRIMARY KEY   | Auto-incrementing ID          |
| name        | VARCHAR(500) | NOT NULL      | Product name                  |
| category    | VARCHAR(255) | NOT NULL      | Product category              |
| supermarket | VARCHAR(255) | NOT NULL      | Supermarket name                                        |
| product_url | TEXT         | NULLABLE      | Direct URL to the offer page on the supermarket website |
| created_at  | TIMESTAMP    | DEFAULT NOW() | First time product was seen   |
| updated_at  | TIMESTAMP    | DEFAULT NOW() | Last time product was updated |

**Constraints:**

- UNIQUE(name, supermarket) - Ensures no duplicate products per supermarket

**Indexes:**

- `idx_product_name` on `name`
- `idx_product_category` on `category`
- `idx_product_supermarket` on `supermarket`
- `idx_product_name_supermarket` on `(name, supermarket)`
- `idx_product_category_supermarket` on `(category, supermarket)`
- `idx_product_name_fulltext` on `to_tsvector('english', name)` (GIN index)

**Business Rules:**

- Products are updated (not recreated) when same name+supermarket is scraped again
- Products can have multiple discounts over time
- Products are never automatically deleted

#### Table: discounts

**Purpose:** Store discount information linked to products with active/inactive lifecycle

| Column           | Type          | Constraints                 | Description                             |
| ---------------- | ------------- | --------------------------- | --------------------------------------- |
| id               | SERIAL        | PRIMARY KEY                 | Auto-incrementing ID                    |
| product_id       | INTEGER       | NOT NULL, FK → products(id) | Reference to product                    |
| original_price   | DECIMAL(10,2) | NOT NULL, DEFAULT 0         | Pre-discount price                      |
| discount_price   | DECIMAL(10,2) | NOT NULL                    | Discounted price                        |
| unit_price       | VARCHAR(50)   | NULL                        | Unit price string (e.g., "€1.49/kg", "€0.99/l", "€0.50/st"); null when not available |
| special_discount | VARCHAR(255)  | NULL                        | Special conditions (e.g., "2+1 gratis") |
| expire_date      | TIMESTAMP     | NOT NULL                    | When discount expires                   |
| active           | BOOLEAN       | NOT NULL, DEFAULT true      | Is discount currently active            |
| created_at       | TIMESTAMP     | DEFAULT NOW()               | When discount was first scraped         |

**Cascade:**

- ON DELETE CASCADE - Discounts deleted when product is deleted

**Indexes:**

- `idx_discount_product_id` on `product_id`
- `idx_discount_expire_date` on `expire_date`
- `idx_discount_price_range` on `discount_price`
- `idx_discount_active` on `active`
- `idx_discount_product_expire` on `(product_id, expire_date)`
- `idx_discount_product_active` on `(product_id, active)`

**Business Rules:**

- When scraper runs, existing active discounts for products not found are marked `active=false`
- When scheduler runs, discounts with `expire_date < NOW()` are marked `active=false`
- Only active discounts (`active=true`) are returned by API and shown in web interface
- Inactive discounts are preserved for historical analysis

#### Table: scraper_runs

**Purpose:** Complete audit trail of all scraper executions with detailed metrics

| Column                | Type         | Constraints     | Description                       |
| --------------------- | ------------ | --------------- | --------------------------------- |
| id                    | SERIAL       | PRIMARY KEY     | Auto-incrementing ID              |
| supermarket           | VARCHAR(255) | NOT NULL        | Supermarket name                  |
| status                | VARCHAR(50)  | NOT NULL, CHECK | 'running', 'success', or 'failed' |
| products_scraped      | INTEGER      | DEFAULT 0       | Total products found by scraper   |
| products_updated      | INTEGER      | DEFAULT 0       | Existing products updated         |
| products_created      | INTEGER      | DEFAULT 0       | New products created              |
| discounts_deactivated | INTEGER      | DEFAULT 0       | Old discounts marked inactive     |
| discounts_created     | INTEGER      | DEFAULT 0       | New discounts created             |
| error_message         | TEXT         | NULL            | Error details if failed           |
| started_at            | TIMESTAMP    | DEFAULT NOW()   | When run started                  |
| completed_at          | TIMESTAMP    | NULL            | When run completed                |
| duration_seconds      | INTEGER      | NULL            | Total run time                    |
| promotion_expire_date | TIMESTAMP    | NULL            | Expiry date of scraped promotion  |
| created_at            | TIMESTAMP    | DEFAULT NOW()   | Record creation timestamp         |
| updated_at            | TIMESTAMP    | DEFAULT NOW()   | Last update timestamp             |

**Indexes:**

- `idx_scraper_runs_supermarket` on `supermarket`
- `idx_scraper_runs_status` on `status`
- `idx_scraper_runs_started_at` on `started_at DESC`
- `idx_scraper_runs_supermarket_status` on `(supermarket, status)`

**Business Rules:**

- Run created with status='running' before scraper starts
- Updated to status='success' on successful completion
- Updated to status='failed' with error_message on failure
- duration_seconds calculated as difference between completed_at and started_at

#### Table: scheduled_runs

**Purpose:** Manage automatic scheduling of scraper runs based on promotion cycles

| Column                | Type         | Constraints            | Description                                     |
| --------------------- | ------------ | ---------------------- | ----------------------------------------------- |
| id                    | SERIAL       | PRIMARY KEY            | Auto-incrementing ID                            |
| supermarket           | VARCHAR(255) | NOT NULL, UNIQUE       | Supermarket name (one schedule per supermarket) |
| next_run_at           | TIMESTAMP    | NOT NULL               | When scraper should run next                    |
| promotion_expire_date | TIMESTAMP    | NOT NULL               | Current promotion expiry date                   |
| enabled               | BOOLEAN      | NOT NULL, DEFAULT true | Is scheduled run enabled                        |
| created_at            | TIMESTAMP    | DEFAULT NOW()          | Record creation timestamp                       |
| updated_at            | TIMESTAMP    | DEFAULT NOW()          | Last update timestamp                           |

**Indexes:**

- `idx_scheduled_runs_supermarket` on `supermarket`
- `idx_scheduled_runs_next_run_at` on `next_run_at`
- `idx_scheduled_runs_enabled` on `enabled`

**Business Rules:**

- Scheduler checks every minute for rows where `next_run_at <= NOW() AND enabled=true`
- After successful scraper run, `next_run_at` is calculated based on new `promotion_expire_date`
- Typically scheduled to run on or just after promotion expiry (the most common end date of the run's offers)
- Can be disabled per supermarket via `enabled=false`

### 5.3 Database Indexes Strategy

#### Performance Optimization

**Full-Text Search:**

```sql
CREATE INDEX idx_product_name_fulltext
ON products USING gin(to_tsvector('english', name));
```

- Enables fast text search across product names
- 10-15x faster than LIKE queries
- Supports weighted relevance ranking

**Composite Indexes:**

```sql
CREATE INDEX idx_product_name_supermarket ON products(name, supermarket);
CREATE INDEX idx_discount_product_active ON discounts(product_id, active);
```

- Optimizes common query patterns
- Reduces need for multiple index scans
- Improves JOIN performance

**Partial Indexes (Considered but not implemented):**

```sql
-- Not used because NOW() is not immutable in PostgreSQL
-- CREATE INDEX idx_discount_active_future ON discounts(product_id)
-- WHERE active = true AND expire_date > NOW();
```

### 5.4 Data Flow Diagram

```mermaid
flowchart TD
    Start([Scraper Triggered]) --> Init[Initialize Browser]
    Init --> Navigate[Navigate to Supermarket URL]
    Navigate --> Cookie[Handle Cookie Popup]
    Cookie --> ExpDate[Extract Promotion Expire Date]
    ExpDate --> CreateRun[(Create scraper_run<br/>status: running)]

    CreateRun --> LoopStart{More Categories?}
    LoopStart -->|Yes| ScrapeCategory[Scrape Product Category]
    ScrapeCategory --> ExtractProducts[Extract Product Details]
    ExtractProducts --> LoopStart

    LoopStart -->|No| UpsertProducts[(Upsert Products<br/>UPDATE or INSERT)]

    UpsertProducts --> CheckDiscounts{Discount for<br/>this product exists?}
    CheckDiscounts -->|Yes| CompareDiscount{Same as<br/>existing?}
    CheckDiscounts -->|No| CreateDiscount[(Create New Discount<br/>active=true)]

    CompareDiscount -->|Yes| SkipDiscount[Skip - already exists]
    CompareDiscount -->|No| CreateDiscount

    CreateDiscount --> NextProduct{More Products?}
    SkipDiscount --> NextProduct
    NextProduct -->|Yes| CheckDiscounts

    NextProduct -->|No| UpdateRun[(Update scraper_run<br/>status: success<br/>metrics recorded)]

    UpdateRun --> Schedule[(Upsert scheduled_run<br/>next_run_at = expire_date)]

    Schedule --> End([Complete])

    Init -.->|Error| Failed[(Update scraper_run<br/>status: failed<br/>error_message)]
    Navigate -.->|Error| Failed
    ScrapeCategory -.->|Error| Failed
    UpsertProducts -.->|Error| Failed
    Failed -.-> End

    style CreateRun fill:#ffe6e6
    style UpsertProducts fill:#ffe6e6
    style CreateDiscount fill:#ffe6e6
    style UpdateRun fill:#ffe6e6
    style Schedule fill:#ffe6e6
    style Failed fill:#ffcccc
```

### 5.5 API Data Contracts

#### GET /api/discounts

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

#### POST /api/scraper/run/:supermarket

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

#### GET /api/dashboard/stats

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

#### GET /api/dashboard/statuses

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

#### Public API (`/api/public/v1`) — consumer apps

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

#### Catalog admin API (`/api/catalog`)

| Endpoint | Description |
| -------- | ----------- |
| `GET /api/catalog/status` | Per supermarket: `supported`, `running`, `productsInCatalog`, `lastUpdated`, `lastRun` |
| `GET /api/catalog/runs?limit=` | Latest catalog runs (default 50, max 200) |
| `POST /api/catalog/run/:supermarket` | Starts a catalog run in the background: `202 { runId }`, `409` when one is already running, `400` for supermarkets without a catalog scraper |

### 5.6 Configuration Data Structure

#### Web Identifiers (JSONB)

**Purpose:** Store CSS selectors and scraping configuration per supermarket

**Schema:**

```typescript
interface WebIdentifiers {
  cookieDecline: string; // CSS selector for cookie decline button
  promotionExpireDate: string; // CSS selector for promotion end date
  productCategories: string[]; // Array of category identifiers
  products: string; // CSS selector for product cards
  promotionProducts: {
    name: string; // CSS selector for product name
    originalPrice: string; // CSS selector for original price
    discountPrice: string; // CSS selector for discount price
    specialDiscount: string; // CSS selector for special offers
  };
}
```

**Benefits:**

- Easy to update selectors without code changes
- Supports per-supermarket customization
- Stored in database for runtime flexibility
- Can be modified via database migrations

### 5.7 Schema Migrations

**Purpose:** Keep the schema of long-lived deployments in sync with the code that queries it

The database image copies `schema.sql` and `migrate.sql` into
`/docker-entrypoint-initdb.d/`, but PostgreSQL only executes those scripts when the
data directory is **empty**. A deployment whose volume already exists therefore never
receives columns added after that volume was created, which causes runtime errors such
as `column "product_url" of relation "products" does not exist`.

To close that gap, the scraper API applies migrations itself:

- Migrations are numbered SQL files in `scraper/migrations/` (`NNN_name.sql`), applied
  in filename order by `runMigrations()` in `scraper/src/data/Migrations.ts`.
- `runMigrations()` executes on every API startup, after the connection test succeeds
  and before the HTTP server starts accepting requests.
- Applied files are recorded in `schema_migrations`; each file runs in its own
  transaction, so a failed file is retried on the next start instead of skipped.
- Every statement must be safe to run repeatedly (`ADD COLUMN IF NOT EXISTS` and
  similar), because fresh installs get `schema.sql` first and then run every file too.
  New changes go in a new file; existing files are never edited or removed.

**Current migrations:**

| File                    | Changes                                                                 |
| ----------------------- | ----------------------------------------------------------------------- |
| `001_catalog.sql`       | Catalog columns on `products`, `price_history`, `catalog_runs`          |
| `002_offer_columns.sql` | `products.product_url`, `discounts.unit_price` for pre-existing volumes |
| `003_price_source.sql`  | `products.price_source` (origin of the catalog regular price)          |
| `004_quantity.sql`      | `products.quantity_value`, `products.quantity_unit` (pack quantity in kg, l or stuk) |
| `005_product_matching.sql` | `products.ean`, `products.match_brand`, `products.match_tokens` and their indexes (same product across supermarkets, FR-008) |
| `007_article_number.sql` | `products.article_number` (Lidl permanent article number) and `products.price_observed_at` (when the supermarket itself last showed the regular price, FR-007.14) |

**Result:** a redeploy of the scraper API is sufficient to bring an existing database
up to date — no manual `psql` intervention and no volume reset.

### 5.8 System Architecture Diagram

```mermaid
C4Context
    title System Context Diagram - Supermarket Scraper

    Person(consumer, "Consumer", "Looks for grocery discounts")
    Person(admin, "Administrator", "Manages scraper operations")

    System_Boundary(ds, "Supermarket Scraper System") {
        System(web, "Web Interface", "React SPA with Vite")
        System(api, "REST API", "Express + TypeScript")
        System(scraper, "Scraper Engine", "Playwright-based scrapers")
        System(scheduler, "Scheduler Service", "Cron-based automation")
        SystemDb(db, "PostgreSQL Database", "Stores products & discounts")
    }

    System_Ext(ah, "Albert Heijn Website", "Source of discount data")
    System_Ext(dirk, "Dirk Website", "Source of discount data")
    System_Ext(plus, "PLUS Website", "Source of discount data")

    Rel(consumer, web, "Views discounts", "HTTPS")
    Rel(admin, web, "Manages scrapers", "HTTPS")
    Rel(web, api, "Fetches data", "REST/JSON")
    Rel(api, db, "Reads/Writes", "PostgreSQL Protocol")
    Rel(scraper, db, "Writes scraped data", "PostgreSQL Protocol")
    Rel(scheduler, api, "Triggers scrapers", "HTTP")
    Rel(scheduler, db, "Checks schedules", "PostgreSQL Protocol")

    Rel(scraper, ah, "Scrapes discounts", "HTTPS")
    Rel(scraper, dirk, "Scrapes discounts", "HTTPS")
    Rel(scraper, plus, "Scrapes discounts", "HTTPS")
```

---

## 6. System Integration

### 6.1 Component Interaction

```mermaid
sequenceDiagram
    participant S as Scheduler Service
    participant API as REST API
    participant SC as Scraper Client
    participant EXT as External Website
    participant DB as PostgreSQL
    participant WEB as Web Interface
    participant USER as User

    Note over S: Every minute
    S->>DB: Check for expired discounts
    DB-->>S: Deactivated count
    S->>DB: Query due scheduled_runs
    DB-->>S: List of due runs

    alt Has due runs
        S->>API: POST /api/scraper/run/:supermarket
        API->>DB: Create scraper_run (running)
        API->>SC: Initialize scraper
        SC->>EXT: Navigate & scrape
        EXT-->>SC: HTML content
        SC->>SC: Parse products & discounts
        SC->>DB: Upsert products
        SC->>DB: Create/deactivate discounts
        SC->>DB: Update scraper_run (success)
        SC->>DB: Schedule next run
        API-->>S: 200 OK
    end

    Note over USER: Meanwhile...
    USER->>WEB: Open web interface
    WEB->>API: GET /api/discounts
    API->>DB: SELECT active discounts
    DB-->>API: Discount data
    API-->>WEB: JSON response
    WEB-->>USER: Display discounts table

    USER->>WEB: Search/filter
    WEB->>WEB: Client-side filtering
    WEB-->>USER: Updated results
```

### 6.2 Deployment Architecture

```mermaid
graph TB
    subgraph "Docker Host"
        subgraph "supermarket-scraper-web (Port 3000)"
            NGINX[Nginx Web Server]
            STATIC[Static React Files]
        end

        subgraph "supermarket-scraper-api (Port 3001)"
            EXPRESS[Express Server]
            SCHEDULER[Scheduler Service]
            SCRAPERS[Scraper Clients]
        end

        subgraph "supermarket-scraper-db (Port 5432)"
            POSTGRES[(PostgreSQL 15)]
            SCHEMA[Initialized Schema]
        end
    end

    subgraph "External"
        BROWSER[User Browser]
        WEBSITES[Supermarket Websites]
    end

    BROWSER -->|HTTP :3000| NGINX
    NGINX --> STATIC
    STATIC -->|AJAX :3001| EXPRESS

    EXPRESS --> POSTGRES
    SCHEDULER --> EXPRESS
    SCRAPERS --> POSTGRES
    SCRAPERS -->|HTTPS| WEBSITES

    style POSTGRES fill:#336791,color:#fff
    style EXPRESS fill:#68a063,color:#fff
    style NGINX fill:#009639,color:#fff
```

### 6.3 Technology Integration Points

| Integration             | Technology         | Purpose                    | Protocol                 |
| ----------------------- | ------------------ | -------------------------- | ------------------------ |
| Frontend ↔ Backend      | Axios              | API communication          | HTTP/REST                |
| Backend ↔ Database      | pg (node-postgres) | Data persistence           | PostgreSQL Wire Protocol |
| Scraper ↔ Websites      | Playwright         | Web scraping               | HTTP/HTTPS               |
| Scheduler ↔ Backend     | node-cron + Axios  | Automated triggers         | HTTP (internal)          |
| Web Server ↔ Frontend   | Nginx              | Static file serving        | HTTP                     |
| Container Orchestration | Docker Compose     | Multi-container deployment | Docker API               |

---

## 7. Future Enhancements

### 7.1 Potential Features

1. **User Accounts & Personalization**

   - User registration and authentication
   - Personalized discount recommendations
   - Shopping lists with discount tracking
   - Favorite products and price alerts

2. **Advanced Analytics**

   - Price history charts
   - Discount trend analysis
   - Best time to buy recommendations
   - Savings calculator

3. **Notification System**

   - Email alerts for specific products
   - Push notifications for price drops
   - Weekly digest of best deals

4. **Product Matching**

   - Cross-supermarket product matching
   - Barcode/EAN integration
   - Price comparison across supermarkets

5. **Data Export**

   - CSV/Excel export
   - PDF reports
   - API for third-party integrations

6. **Mobile Applications**

   - Native iOS app
   - Native Android app
   - Location-based supermarket filtering

7. **Enhanced Scraping**

   - Product images
   - Nutritional information
   - Stock availability
   - More supermarket chains

8. **Administrative Features**
   - Web-based configuration editor
   - A/B testing for scraper strategies
   - Performance dashboards
   - Automated testing of scrapers

### 7.2 Scalability Considerations

- **Horizontal Scaling**: Multiple scraper instances with job queue
- **Caching Layer**: Redis for frequently accessed data
- **CDN Integration**: CloudFlare for static assets
- **Database Replication**: Read replicas for query performance
- **Microservices**: Split into dedicated services (scraper, API, scheduler)

---

## 8. Glossary

| Term                   | Definition                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------- |
| **Active Discount**    | A discount with `active=true` and `expire_date > NOW()`                                |
| **AJAX**               | Asynchronous JavaScript and XML - technique for updating web pages without full reload |
| **Cron Job**           | Time-based scheduled task                                                              |
| **CSS Selector**       | Pattern used to select HTML elements for scraping                                      |
| **Discount Lifecycle** | States: Scraped → Active → Inactive/Expired                                            |
| **Full-Text Search**   | Search technique using GIN indexes for natural language queries                        |
| **JSONB**              | PostgreSQL's binary JSON storage format                                                |
| **Playwright**         | Browser automation library for web scraping                                            |
| **Scheduled Run**      | Automated scraper execution based on promotion schedules                               |
| **Scraper Run**        | Single execution of scraper for one supermarket                                        |
| **UPSERT**             | Database operation that updates if exists, inserts if not                              |
| **Web Identifiers**    | Configuration containing CSS selectors for scraping                                    |

---

## 9. Appendix

### 9.1 API Endpoint Summary

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

### 9.2 Database Query Examples

**Find all active discounts expiring soon:**

```sql
SELECT p.name, p.supermarket, d.discount_price, d.expire_date
FROM products p
INNER JOIN discounts d ON p.id = d.product_id
WHERE d.active = true
  AND d.expire_date BETWEEN NOW() AND NOW() + INTERVAL '3 days'
ORDER BY d.expire_date ASC;
```

**Get scraper success rate per supermarket:**

```sql
SELECT
  supermarket,
  COUNT(*) as total_runs,
  COUNT(*) FILTER (WHERE status = 'success') as successful_runs,
  ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'success') / COUNT(*), 2) as success_rate
FROM scraper_runs
GROUP BY supermarket;
```

**Find products with most discount changes:**

```sql
SELECT
  p.name,
  p.supermarket,
  COUNT(d.id) as discount_count
FROM products p
INNER JOIN discounts d ON p.id = d.product_id
GROUP BY p.id, p.name, p.supermarket
ORDER BY discount_count DESC
LIMIT 10;
```

### 9.3 Configuration Example

**.env file:**

```properties
# Database Configuration
DB_HOST=postgres
DB_PORT=5432
DB_NAME=supermarket
DB_USER=supermarket_user
DB_PASSWORD=discount_pass

# API Configuration
API_PORT=3001

# Logging Configuration
LOG_LEVEL=INFO
```

**docker-compose.yml structure:**

```yml
services:
  postgres:
    # PostgreSQL database

  scraper-api:
    # Node.js API + Scraper + Scheduler
    depends_on:
      - postgres

  web:
    # Nginx + React frontend
    depends_on:
      - scraper-api
```

---

**Document End**

_This functional design document represents the current implementation of the Supermarket Scraper system as of October 24, 2025. It should be updated as the system evolves._
