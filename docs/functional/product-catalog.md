# Product catalog

The full assortment at regular price, per supermarket. Part of the [functional design](../FUNCTIONAL_DESIGN.md).

## FR-007: Product Catalog

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

**PLUS catalog and offers.** plus.nl is an OutSystems app. It is read over
plain HTTP, without a browser (`clients/plus/PlusSite.ts`). The site's product
list call (`DataActionGetProductListAndCategoryInfo`) without a category lists
the whole assortment, 12 products per page, a fixed server page size (17,340
products on 1,445 pages on 19 October 2026). Imperva in front of plus.nl lets
these requests through. Each request carries OutSystems' fixed anonymous CSRF
token (`T6C+9iB49TLra4jEsMeSckDMNhQ=`, the same for every anonymous visitor)
and the current module and api versions, which change with every release of
the site. The scraper reads them from the site at the start of a run: the
module version from `/moduleservices/moduleversioninfo`, the api version from
the product list screen's script found through `/moduleservices/moduleinfo`.
When the server answers `hasApiVersionChanged` or `hasModuleVersionChanged`,
it reads them again and repeats the page. The week period in the site's own
request does not change the results and is left out. The old PLUS app API
(`pls-sprmrkt-mw.prd.vdc1.plus.nl`) no longer exists.

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
