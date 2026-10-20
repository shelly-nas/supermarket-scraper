# Same product across supermarkets and product images

Matching one product across supermarkets, and the image proxy. Part of the [functional design](../FUNCTIONAL_DESIGN.md).

## FR-008: Same Product Across Supermarkets and Product Images

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
