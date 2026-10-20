# Functional Design Document

## Supermarket Scraper System

**Version:** 1.0  
**Date:** October 24, 2025  
**Project:** supermarket-scraper (named discount-scraper until October 2026)  
**Author:** System Analysis

---

The functional design is split per functionality, so a change only touches the file of the feature it
changes. Each file holds the user stories, use cases, requirements and data contracts of that feature.

| Functionality | File | What it covers |
|---|---|---|
| Overview | [functional/overview.md](functional/overview.md) | Purpose, business goals, scope, system boundaries, technology stack, personas, glossary |
| Weekly offer scraping | [functional/offer-scraping.md](functional/offer-scraping.md) | Scraper management stories, manual runs, the scraping engine, discount lifecycle, run states |
| Scheduling | [functional/scheduling.md](functional/scheduling.md) | Scheduled-operation stories, automated scraping, the scheduling system |
| Product catalog | [functional/product-catalog.md](functional/product-catalog.md) | The full assortment at regular price per supermarket |
| Same product and images | [functional/same-product-and-images.md](functional/same-product-and-images.md) | The same product across supermarkets, the image proxy |
| API | [functional/api.md](functional/api.md) | Admin API, public API for consumer apps (Baskit), data contracts, endpoint summary |
| Web interface | [functional/web-interface.md](functional/web-interface.md) | Discount discovery stories, viewing and filtering discounts, the admin UI |
| Data model | [functional/data-model.md](functional/data-model.md) | Data storage, tables, indexes, data flow, configuration data, migrations, example queries |
| Operations | [functional/operations.md](functional/operations.md) | Monitoring and logging, non-functional requirements, integration, deployment, configuration |
| Roadmap | [functional/roadmap.md](functional/roadmap.md) | Possible future features, scalability considerations |

## Keeping it current

After a functional change, update the file of the functionality it changes. A new functionality gets
its own file in `functional/` and a row in the table above.

## Where the original sections went

| Original section | Now in |
|---|---|
| 1 Purpose, 2 Scope, 3.1 Personas, 8 Glossary | `overview.md` |
| 3.2 Epic 1, 3.3 Use Cases 1 and 4, FR-005 | `web-interface.md` |
| 3.2 Epic 2, 3.3 Use Case 2, FR-001, 4.3 System Behavior | `offer-scraping.md` |
| 3.2 Epic 3, 3.3 Use Case 3, FR-003 | `scheduling.md` |
| FR-004, 5.5 API Data Contracts, 9.1 API Endpoint Summary | `api.md` |
| FR-007 | `product-catalog.md` |
| FR-008 | `same-product-and-images.md` |
| FR-002, 5 Data Structure (except 5.5), 9.2 Database Query Examples | `data-model.md` |
| FR-006, 4.2 Non-Functional Requirements, 6 System Integration, 9.3 Configuration Example | `operations.md` |
| 7 Future Enhancements | `roadmap.md` |
