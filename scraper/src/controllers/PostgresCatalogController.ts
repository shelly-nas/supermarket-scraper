import { PoolClient } from "pg";
import PostgresDataContext from "../data/PostgresDataContext";
import { ICatalogProduct } from "../interfaces/ICatalogProduct";
import { scraperLogger } from "../utils/Logger";
import { parseQuantity } from "../utils/Quantity";
import { matchFields, normalizeEan } from "../utils/ProductMatch";

export interface CatalogBatchMetrics {
  created: number;
  updated: number;
  pricesChanged: number;
}

/** How long a regular price the supermarket itself showed beats an outside dataset. */
export const OBSERVED_PRICE_MAX_AGE_DAYS = 180;

interface ExistingProduct {
  id: number;
  regular_price: string | null;
  price_source: string | null;
  price_observed_at: Date | null;
}

/**
 * Whether a catalog run keeps the stored price instead of the delivered one:
 * the run has no price of the supermarket's own (only an outside dataset or
 * none), while the supermarket itself showed the stored price in the last
 * OBSERVED_PRICE_MAX_AGE_DAYS days (Lidl's regular price next to an offer).
 */
export function keepsObservedPrice(
  existing: Pick<ExistingProduct, "regular_price" | "price_source" | "price_observed_at">,
  product: Pick<ICatalogProduct, "price" | "priceSource">,
  now: Date
): boolean {
  if (product.price !== null && product.priceSource === "supermarket") return false;
  if (existing.price_source !== "supermarket" || existing.regular_price === null) return false;
  if (!existing.price_observed_at) return false;
  const ageDays = (now.getTime() - new Date(existing.price_observed_at).getTime()) / 86_400_000;
  return ageDays <= OBSERVED_PRICE_MAX_AGE_DAYS;
}

/** Stores catalog products (regular prices) and catalog run bookkeeping. */
class PostgresCatalogController {
  private db: PostgresDataContext;

  constructor(db: PostgresDataContext) {
    this.db = db;
  }

  /**
   * Upserts one page of catalog products in a single transaction.
   *
   * A product is matched on (supermarket, external_id) first, then on
   * (supermarket, name) so an existing offer-only row is upgraded instead of
   * duplicated, and on its article number or name to a row an add-only
   * dataset added, which the supermarket's own data takes over. Add-only
   * products (ICatalogProduct.addOnly) never change an existing row
   * (upsertAddOnly). Price history only gets a row when the regular price
   * changes.
   */
  async upsertBatch(
    supermarket: string,
    products: ICatalogProduct[],
    runStartedAt: Date
  ): Promise<CatalogBatchMetrics> {
    const metrics: CatalogBatchMetrics = { created: 0, updated: 0, pricesChanged: 0 };

    await this.db.transaction(async (client) => {
      for (const product of products) {
        const result = await this.upsertOne(client, supermarket, product, runStartedAt);
        if (result === "skipped") continue;
        if (result.created) metrics.created++;
        else metrics.updated++;
        if (result.priceChanged) metrics.pricesChanged++;
      }
    });

    return metrics;
  }

  private async upsertOne(
    client: PoolClient,
    supermarket: string,
    product: ICatalogProduct,
    runStartedAt: Date
  ): Promise<{ created: boolean; priceChanged: boolean } | "skipped"> {
    if (product.addOnly) return this.upsertAddOnly(client, supermarket, product, runStartedAt);

    // Already seen in this run (product listed in several categories).
    const byExternal = await client.query<ExistingProduct & { catalog_updated_at: Date | null }>(
      `SELECT id, regular_price, price_source, price_observed_at, catalog_updated_at FROM products
       WHERE supermarket = $1 AND external_id = $2`,
      [supermarket, product.externalId]
    );
    let existing: ExistingProduct | undefined = byExternal.rows[0];
    if (byExternal.rows[0]?.catalog_updated_at && byExternal.rows[0].catalog_updated_at >= runStartedAt) {
      return "skipped";
    }

    let name = product.name;
    if (!existing && product.articleNumber) {
      // A row an add-only dataset added under this article number.
      const added = await client.query<ExistingProduct>(
        `SELECT id, regular_price, price_source, price_observed_at FROM products
         WHERE supermarket = $1 AND catalog_source IS NOT NULL
           AND (ltrim(external_id, '0') = $2 OR ltrim(article_number, '0') = $2)
         LIMIT 1`,
        [supermarket, product.articleNumber.replace(/^0+/, "")]
      );
      existing = added.rows[0];
    }
    if (!existing) {
      const byName = await client.query<ExistingProduct & { external_id: string | null; catalog_source: string | null }>(
        `SELECT id, regular_price, price_source, price_observed_at, external_id, catalog_source FROM products
         WHERE supermarket = $1 AND name = $2`,
        [supermarket, name]
      );
      const sameName = byName.rows[0];
      if (sameName && (sameName.external_id === null || sameName.catalog_source !== null)) {
        existing = sameName;
      } else if (sameName) {
        // Two different products with the same title: make the name unique.
        name = await this.uniqueName(client, supermarket, product);
      }
    }

    // A price the supermarket itself showed recently (e.g. next to an offer)
    // beats one from an outside dataset.
    const keep = existing !== undefined && keepsObservedPrice(existing, product, new Date());
    const price = keep ? parseFloat(existing!.regular_price!) : product.price;
    const priceSource = keep ? "supermarket" : price === null ? null : product.priceSource;
    const observedAt = keep ? existing!.price_observed_at : priceSource === "supermarket" ? new Date() : null;

    const values: (string | number | Date | null)[] = [
      product.externalId,
      product.brand,
      product.unitSize,
      product.imageUrl,
      price,
      product.unitPrice,
      product.productUrl,
      priceSource,
    ];
    const quantity = product.quantity !== undefined ? product.quantity : parseQuantity(product.unitSize);
    values.push(quantity?.value ?? null, quantity?.unit ?? null);
    const match = matchFields(product.name, product.brand);
    values.push(normalizeEan(product.ean), match.matchBrand, match.matchTokens);
    values.push(observedAt, product.articleNumber ?? null);

    if (existing) {
      await client.query(
        `UPDATE products SET
           external_id = $2, brand = $3, unit_size = $4, image_url = COALESCE($5, image_url),
           regular_price = $6, unit_price = $7,
           product_url = COALESCE($8, product_url), price_source = $9,
           quantity_value = $10, quantity_unit = $11,
           ean = COALESCE($12, ean), match_brand = $13, match_tokens = $14,
           price_observed_at = $15, article_number = COALESCE($16, article_number),
           category = $17, catalog_source = NULL, in_catalog = true, catalog_updated_at = NOW()
         WHERE id = $1`,
        [existing.id, ...values, product.category]
      );
      // Without a price (the supermarket does not publish it) there is nothing
      // to record; the product is still in the catalog.
      if (price === null) return { created: false, priceChanged: false };
      const previous = existing.regular_price === null ? null : parseFloat(existing.regular_price);
      const changed = previous !== null && Math.abs(previous - price) >= 0.005;
      // A first price (offer-only product joining the catalog) is recorded but
      // is not a change.
      if (previous === null || changed) {
        await this.recordPrice(client, existing.id, price);
      }
      return { created: false, priceChanged: changed };
    }

    const inserted = await client.query<{ id: number }>(
      `INSERT INTO products
         (name, category, supermarket, external_id, brand, unit_size, image_url,
          regular_price, unit_price, product_url, price_source, quantity_value, quantity_unit,
          ean, match_brand, match_tokens, price_observed_at, article_number, in_catalog, catalog_updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, true, NOW())
       RETURNING id`,
      [name, product.category, supermarket, ...values]
    );
    if (price !== null) await this.recordPrice(client, inserted.rows[0].id, price);
    return { created: true, priceChanged: false };
  }

  /**
   * An add-only product: inserted when no row of the supermarket has its
   * external id, article number or name. When rows match, the product only
   * touches one the same dataset added itself (catalog_source): it stays in
   * the catalog and its price is refreshed. A row from any other source is
   * left exactly as it is.
   */
  private async upsertAddOnly(
    client: PoolClient,
    supermarket: string,
    product: ICatalogProduct,
    runStartedAt: Date
  ): Promise<{ created: boolean; priceChanged: boolean } | "skipped"> {
    const source = product.priceSource ?? "dataset";
    const number = (product.articleNumber ?? product.externalId).replace(/^0+/, "");
    const matches = await client.query<
      ExistingProduct & { catalog_source: string | null; catalog_updated_at: Date | null }
    >(
      `SELECT id, regular_price, price_source, price_observed_at, catalog_source, catalog_updated_at FROM products
       WHERE supermarket = $1
         AND (ltrim(external_id, '0') = $2 OR ltrim(article_number, '0') = $2 OR lower(name) = lower($3))`,
      [supermarket, number, product.name]
    );
    if (matches.rows.some((row) => row.catalog_source !== source)) return "skipped";

    const own = matches.rows[0];
    if (own) {
      if (own.catalog_updated_at && own.catalog_updated_at >= runStartedAt) return "skipped";
      // A regular price Lidl itself showed next to an offer stays (FR-007.14).
      if (keepsObservedPrice(own, product, new Date())) {
        await client.query(`UPDATE products SET in_catalog = true, catalog_updated_at = NOW() WHERE id = $1`, [own.id]);
        return { created: false, priceChanged: false };
      }
      await client.query(
        `UPDATE products SET regular_price = $2, price_source = $3, in_catalog = true, catalog_updated_at = NOW()
         WHERE id = $1`,
        [own.id, product.price, product.priceSource]
      );
      const previous = own.regular_price === null ? null : parseFloat(own.regular_price);
      const changed = previous !== null && product.price !== null && Math.abs(previous - product.price) >= 0.005;
      if (product.price !== null && (previous === null || changed)) await this.recordPrice(client, own.id, product.price);
      return { created: false, priceChanged: changed };
    }

    const quantity = product.quantity !== undefined ? product.quantity : parseQuantity(product.unitSize);
    const match = matchFields(product.name, product.brand);
    const inserted = await client.query<{ id: number }>(
      `INSERT INTO products
         (name, category, supermarket, external_id, brand, unit_size, image_url, regular_price,
          unit_price, product_url, price_source, quantity_value, quantity_unit, ean,
          match_brand, match_tokens, article_number, catalog_source, in_catalog, catalog_updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, true, NOW())
       RETURNING id`,
      [
        product.name,
        product.category,
        supermarket,
        product.externalId,
        product.brand,
        product.unitSize,
        product.imageUrl,
        product.price,
        product.unitPrice,
        product.productUrl,
        product.priceSource,
        quantity?.value ?? null,
        quantity?.unit ?? null,
        normalizeEan(product.ean),
        match.matchBrand,
        match.matchTokens,
        number,
        source,
      ]
    );
    if (product.price !== null) await this.recordPrice(client, inserted.rows[0].id, product.price);
    return { created: true, priceChanged: false };
  }

  private async uniqueName(
    client: PoolClient,
    supermarket: string,
    product: ICatalogProduct
  ): Promise<string> {
    const candidates = [
      product.unitSize ? `${product.name} ${product.unitSize}` : null,
      `${product.name} (${product.externalId})`,
    ].filter((c): c is string => c !== null);
    for (const candidate of candidates) {
      const taken = await client.query(
        "SELECT 1 FROM products WHERE supermarket = $1 AND name = $2",
        [supermarket, candidate]
      );
      if (taken.rows.length === 0) return candidate;
    }
    return `${product.name} (${product.externalId})`;
  }

  private async recordPrice(client: PoolClient, productId: number, price: number): Promise<void> {
    await client.query("INSERT INTO price_history (product_id, price) VALUES ($1, $2)", [
      productId,
      price,
    ]);
  }

  /**
   * Marks products that were not seen in this run as no longer in the
   * catalog. Skipped when the run saw suspiciously few products, so a partial
   * API outage cannot empty the catalog.
   */
  async markRemoved(supermarket: string, runStartedAt: Date, productsSeen: number): Promise<number> {
    const current = await this.db.query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM products WHERE supermarket = $1 AND in_catalog = true",
      [supermarket]
    );
    const previousCount = parseInt(current.rows[0].count, 10);
    if (productsSeen < previousCount * 0.5) {
      scraperLogger.warn(
        `${supermarket} catalog: saw ${productsSeen} of ${previousCount} known products, not marking any as removed`
      );
      return 0;
    }
    const result = await this.db.query(
      `UPDATE products SET in_catalog = false
       WHERE supermarket = $1 AND in_catalog = true
         AND (catalog_updated_at IS NULL OR catalog_updated_at < $2)`,
      [supermarket, runStartedAt]
    );
    return result.rowCount ?? 0;
  }
}

export default PostgresCatalogController;
