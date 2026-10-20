# Weekly offer scraping

Fetching the weekly offers per supermarket, manual runs, run states and the discount lifecycle. Part of the [functional design](../FUNCTIONAL_DESIGN.md).

## Epic 2: Scraper Management

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

## Use Case 2: Run Scraper Manually

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
6. Scraper calls the supermarket's API or site data over HTTP
7. Scraper retries rate limits and server errors
8. Scraper skips products outside the weekly offers
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

- **6a**: Supermarket API unreachable → Log error, update run status to "failed"
- **7a**: Website unreachable → Timeout, mark run as "failed"
- **8a**: Cookie popup not found → Log warning, continue
- **10a**: No products found → Log warning, complete with 0 products
- **11a**: Database error → Rollback transaction, mark run as "failed"

## FR-001: Web Scraping Engine

| ID        | Requirement                                                                  | Priority | Status         |
| --------- | ---------------------------------------------------------------------------- | -------- | -------------- |
| FR-001.1  | System SHALL scrape discount data from Albert Heijn: one discount per product (not per promotion group such as "Alle Felix"), from the AH mobile API product search with the bonus filter, per top-level category. Only the weekly store bonus (`promotionType` NATIONAL) is kept; online-only, Etos, Gall & Gall, the long-running "Voordeelshop" and standing volume discounts are skipped. Each discount has the regular price, the bonus price per item (multi-buy labels worked out per item), the pack size and price per unit, its own end date, the group name in the special discount text, and `externalId` = webshopId | HIGH     | ✅ Implemented |
| FR-001.2  | System SHALL scrape discount data from Dirk website                          | HIGH     | ✅ Implemented |
| FR-001.3  | System SHALL scrape discount data from PLUS website                          | HIGH     | ✅ Implemented |
| FR-001.4  | System SHALL handle cookie consent popups automatically                      | HIGH     | ➖ Obsolete: no scraper uses a browser any more |
| FR-001.5  | System SHALL extract promotion expiration dates per offer; the run's expiry (which schedules the next run) is the weekly folder's end date, i.e. the most common end date, so long-running promotions do not postpone the next run. Lidl reads each tile's own end date (`storeEndDate`) from the offers page | HIGH     | ✅ Implemented |
| FR-001.6  | System SHALL extract product names, categories, prices, discount details, and product URLs | HIGH     | ✅ Implemented |
| FR-001.7  | System SHALL read every supermarket over plain HTTP, without a browser (AH mobile API, Jumbo/Dirk/Hoogvliet GraphQL, Aldi Algolia, Lidl and PLUS site data); the API image has no browser | HIGH     | ✅ Implemented |
| FR-001.8  | System SHALL support configurable web identifiers per supermarket            | MEDIUM   | ✅ Implemented |
| FR-001.9  | System SHALL log all scraping activities with timestamps                     | MEDIUM   | ✅ Implemented |
| FR-001.10 | System SHALL handle network timeouts gracefully                              | MEDIUM   | ✅ Implemented |

## Discount Lifecycle

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

## Scraper Run States

```mermaid
stateDiagram-v2
    [*] --> Created: Create scraper_run record
    Created --> Running: Start HTTP client
    Running --> Scraping: Navigate to website
    Scraping --> Processing: Extract data
    Processing --> Updating: Update database
    Updating --> Scheduling: Create scheduled_run
    Scheduling --> Success: Complete successfully

    Running --> Failed: API error
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
