import PostgresDataContext from "../data/PostgresDataContext";
import ProductModel from "../models/ProductModel";
import { scraperLogger } from "../utils/Logger";
import { Quantity, QuantityUnit } from "../utils/Quantity";
import { matchFields, sameQuantity } from "../utils/ProductMatch";

/** Permanent article numbers and pack quantity of an offer, to find its catalog row. */
export interface ArticleLink {
  articleNumbers: string[];
  quantity: Quantity | null;
}

/**
 * Picks the catalog row for an offer among rows sharing its article number.
 * Variants (another pack size) can share one, so a row with the offer's
 * quantity wins; a single row is taken when one side does not know its
 * quantity. Two equal candidates, or only other pack sizes, link nothing.
 */
export function pickByQuantity(
  candidates: { id: number; quantity: Quantity | null }[],
  quantity: Quantity | null
): number | null {
  if (quantity) {
    const same = candidates.filter((c) => sameQuantity(c.quantity, quantity));
    if (same.length > 0) return same.length === 1 ? same[0].id : null;
  }
  if (candidates.length !== 1) return null;
  return quantity && candidates[0].quantity ? null : candidates[0].id;
}

export interface OfferDetails {
  quantity: Quantity | null;
  brand: string | null;
  matchBrand: string | null;
  matchTokens: string;
  imageUrl: string | null;
  ean: string | null;
}

class PostgresProductController {
  private db: PostgresDataContext;

  constructor(db: PostgresDataContext) {
    this.db = db;
    scraperLogger.debug("PostgresProductController initialized.");
  }

  async exists(): Promise<boolean> {
    scraperLogger.debug("Checking if the products table exists.");
    try {
      const result = await this.db.query<{ exists: boolean }>(
        `SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'products'
        )`
      );
      return result.rows[0].exists;
    } catch (error) {
      scraperLogger.error("Error checking if products table exists", error);
      return false;
    }
  }

  async delete(): Promise<void> {
    scraperLogger.debug("Deleting all products from database.");
    try {
      await this.db.query("TRUNCATE TABLE products CASCADE");
      scraperLogger.debug("All products deleted successfully.");
    } catch (error) {
      scraperLogger.error("Error deleting products", error);
      throw error;
    }
  }

  async getProducts(): Promise<ProductModel[]> {
    scraperLogger.debug("Fetching all products.");
    try {
      const result = await this.db.query<ProductModel>(
        "SELECT id, name, category, supermarket, product_url FROM products ORDER BY id"
      );
      return result.rows;
    } catch (error) {
      scraperLogger.error("Error fetching products", error);
      throw error;
    }
  }

  async getProductById(id: number): Promise<ProductModel | null> {
    scraperLogger.debug(`Fetching product with ID: ${id}`);
    try {
      const result = await this.db.query<ProductModel>(
        "SELECT id, name, category, supermarket, product_url FROM products WHERE id = $1",
        [id]
      );
      return result.rows[0] || null;
    } catch (error) {
      scraperLogger.error(`Error fetching product with ID: ${id}`, error);
      throw error;
    }
  }

  async getProductsByCategory(category: string): Promise<ProductModel[]> {
    scraperLogger.debug(`Fetching products in category: ${category}`);
    try {
      const result = await this.db.query<ProductModel>(
        "SELECT id, name, category, supermarket, product_url FROM products WHERE category = $1 ORDER BY name",
        [category]
      );
      return result.rows;
    } catch (error) {
      scraperLogger.error(
        `Error fetching products by category: ${category}`,
        error
      );
      throw error;
    }
  }

  async getProductsBySupermarket(supermarket: string): Promise<ProductModel[]> {
    scraperLogger.debug(`Fetching products from supermarket: ${supermarket}`);
    try {
      const result = await this.db.query<ProductModel>(
        "SELECT id, name, category, supermarket, product_url FROM products WHERE supermarket = $1 ORDER BY category, name",
        [supermarket]
      );
      return result.rows;
    } catch (error) {
      scraperLogger.error(
        `Error fetching products by supermarket: ${supermarket}`,
        error
      );
      throw error;
    }
  }

  async searchProducts(searchTerm: string): Promise<ProductModel[]> {
    scraperLogger.debug(`Searching products with term: ${searchTerm}`);
    try {
      // Use full-text search for better performance
      const result = await this.db.query<ProductModel>(
        `SELECT id, name, category, supermarket, product_url
         FROM products
         WHERE to_tsvector('english', name) @@ plainto_tsquery('english', $1)
         OR name ILIKE $2
         ORDER BY name`,
        [searchTerm, `%${searchTerm}%`]
      );
      return result.rows;
    } catch (error) {
      scraperLogger.error(
        `Error searching products with term: ${searchTerm}`,
        error
      );
      throw error;
    }
  }

  async deleteProduct(productId: number): Promise<boolean> {
    scraperLogger.debug(`Attempting to delete product with ID: ${productId}`);
    try {
      const result = await this.db.query("DELETE FROM products WHERE id = $1", [
        productId,
      ]);

      if (result.rowCount === 0) {
        scraperLogger.warn(`Product with ID: ${productId} not found.`);
        return false;
      }

      scraperLogger.debug(`Product with ID: ${productId} has been deleted.`);
      return true;
    } catch (error) {
      scraperLogger.error(
        `Error deleting product with ID: ${productId}`,
        error
      );
      throw error;
    }
  }

  /**
   * Upserts an offer's product by the supermarket's own product id. With a
   * `link`, the catalog row with the offer's article number wins (Lidl offers
   * have their own id); then an existing row with that id; else an id-less row with the same name is
   * adopted (an offer-only product from before ids were stored); else a new
   * row is created, with the id appended to the name when another product
   * already has that name (the catalog does the same).
   */
  async addProductByExternalId(
    name: string,
    category: string,
    supermarket: string,
    productUrl: string | null,
    externalId: string,
    link?: ArticleLink
  ): Promise<{ id: number; wasCreated: boolean }> {
    // An offer with its own article number lands on its catalog row, which
    // keeps its own id, category and product page.
    const catalogId = link ? await this.findCatalogProductByArticle(supermarket, link) : null;
    if (catalogId !== null) {
      await this.db.query("UPDATE products SET updated_at = CURRENT_TIMESTAMP WHERE id = $1", [catalogId]);
      // An offer-only row stored under the offer's own id before it was linked
      // keeps no active offer next to the catalog row's.
      await this.db.query(
        `UPDATE discounts SET active = false
         WHERE active = true AND product_id IN (
           SELECT id FROM products
           WHERE supermarket = $1 AND external_id = $2 AND id <> $3 AND catalog_updated_at IS NULL)`,
        [supermarket, externalId, catalogId]
      );
      return { id: catalogId, wasCreated: false };
    }

    const byId = await this.db.query<{ id: number }>(
      "SELECT id FROM products WHERE supermarket = $1 AND external_id = $2",
      [supermarket, externalId]
    );
    if (byId.rows.length > 0) {
      await this.db.query(
        `UPDATE products SET category = $2, product_url = COALESCE($3, product_url),
           updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [byId.rows[0].id, category, productUrl]
      );
      return { id: byId.rows[0].id, wasCreated: false };
    }

    const byName = await this.db.query<{ id: number; external_id: string | null }>(
      "SELECT id, external_id FROM products WHERE supermarket = $1 AND name = $2",
      [supermarket, name]
    );
    const sameName = byName.rows[0];
    if (sameName && sameName.external_id === null) {
      await this.db.query(
        `UPDATE products SET external_id = $2, category = $3,
           product_url = COALESCE($4, product_url), updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [sameName.id, externalId, category, productUrl]
      );
      return { id: sameName.id, wasCreated: false };
    }

    const inserted = await this.db.query<{ id: number }>(
      `INSERT INTO products (name, category, supermarket, product_url, external_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [sameName ? `${name} (${externalId})` : name, category, supermarket, productUrl, externalId]
    );
    return { id: inserted.rows[0].id, wasCreated: true };
  }

  /**
   * Stores an offer's pack quantity on a product the catalog does not keep;
   * a catalog row keeps the catalog's quantity.
   */
  /**
   * Fills match_brand / match_tokens for products stored before they existed
   * (migration 005). Runs on startup; a no-op once every row has them.
   */
  async backfillMatchFields(batchSize = 2000): Promise<number> {
    let total = 0;
    for (;;) {
      const rows = await this.db.query<{ id: number; name: string; brand: string | null }>(
        "SELECT id, name, brand FROM products WHERE match_brand IS NULL AND match_tokens IS NULL LIMIT $1",
        [batchSize]
      );
      if (rows.rows.length === 0) return total;
      const fields = rows.rows.map((row) => matchFields(row.name, row.brand));
      await this.db.query(
        `UPDATE products p SET match_brand = f.brand, match_tokens = f.tokens
         FROM UNNEST($1::int[], $2::text[], $3::text[]) AS f(id, brand, tokens)
         WHERE p.id = f.id`,
        [rows.rows.map((r) => r.id), fields.map((f) => f.matchBrand), fields.map((f) => f.matchTokens)]
      );
      total += rows.rows.length;
    }
  }

  /**
   * Details an offer knows about its product. A catalog product keeps its own
   * quantity, brand and match fields (the catalog data is more complete); the
   * image and barcode only fill in what is still missing.
   */
  async setOfferDetails(id: number, details: OfferDetails): Promise<void> {
    await this.db.query(
      `UPDATE products SET
         quantity_value = CASE WHEN catalog_updated_at IS NULL AND $2::numeric IS NOT NULL
                               THEN $2 ELSE quantity_value END,
         quantity_unit = CASE WHEN catalog_updated_at IS NULL AND $2::numeric IS NOT NULL
                              THEN $3 ELSE quantity_unit END,
         brand = CASE WHEN catalog_updated_at IS NULL THEN COALESCE($4, brand) ELSE brand END,
         match_brand = CASE WHEN catalog_updated_at IS NULL THEN $5 ELSE match_brand END,
         match_tokens = CASE WHEN catalog_updated_at IS NULL THEN $6 ELSE match_tokens END,
         image_url = COALESCE(image_url, $7),
         ean = COALESCE(ean, $8)
       WHERE id = $1`,
      [
        id,
        details.quantity?.value ?? null,
        details.quantity?.unit ?? null,
        details.brand,
        details.matchBrand,
        details.matchTokens,
        details.imageUrl,
        details.ean,
      ]
    );
  }

  /**
   * The catalog row of an offer that has its own article number: a catalog
   * product with one of the offer's permanent article numbers and the same
   * pack quantity (see pickByQuantity); null when there is none.
   */
  async findCatalogProductByArticle(supermarket: string, link: ArticleLink): Promise<number | null> {
    if (link.articleNumbers.length === 0) return null;
    const result = await this.db.query<{ id: number; quantity_value: string | null; quantity_unit: string | null }>(
      `SELECT id, quantity_value, quantity_unit FROM products
       WHERE supermarket = $1 AND article_number = ANY($2::text[]) AND catalog_updated_at IS NOT NULL`,
      [supermarket, link.articleNumbers]
    );
    return pickByQuantity(
      result.rows.map((row) => ({
        id: row.id,
        quantity:
          row.quantity_value === null || row.quantity_unit === null
            ? null
            : { value: parseFloat(row.quantity_value), unit: row.quantity_unit as QuantityUnit },
      })),
      link.quantity
    );
  }

  /**
   * Stores the regular price shown next to an offer as the product's regular
   * price, observed now. Price history gets a row for a first or changed price.
   */
  async setRegularPriceFromOffer(id: number, price: number): Promise<boolean> {
    return this.db.transaction(async (client) => {
      const current = await client.query<{ regular_price: string | null }>(
        "SELECT regular_price FROM products WHERE id = $1 FOR UPDATE",
        [id]
      );
      if (current.rows.length === 0) return false;
      await client.query(
        `UPDATE products SET regular_price = $2, price_source = 'supermarket',
           price_observed_at = NOW() WHERE id = $1`,
        [id, price]
      );
      const previous = current.rows[0].regular_price;
      const changed = previous === null || Math.abs(parseFloat(previous) - price) >= 0.005;
      if (changed) {
        await client.query("INSERT INTO price_history (product_id, price) VALUES ($1, $2)", [id, price]);
      }
      return changed;
    });
  }

  async getProductIdByExternalId(externalId: string, supermarket: string, link?: ArticleLink): Promise<number> {
    const catalogId = link ? await this.findCatalogProductByArticle(supermarket, link) : null;
    if (catalogId !== null) return catalogId;
    const result = await this.db.query<{ id: number }>(
      "SELECT id FROM products WHERE supermarket = $1 AND external_id = $2",
      [supermarket, externalId]
    );
    return result.rows[0]?.id ?? -1;
  }

  async getProductId(name: string, supermarket: string): Promise<number> {
    try {
      // Names are only unique per supermarket (UNIQUE(name, supermarket)).
      const result = await this.db.query<{ id: number }>(
        "SELECT id FROM products WHERE name = $1 AND supermarket = $2 LIMIT 1",
        [name, supermarket]
      );

      if (result.rows.length > 0) {
        scraperLogger.debug(
          `Product '${name}' found with ID '${result.rows[0].id}'.`
        );
        return result.rows[0].id;
      } else {
        scraperLogger.error(`Product '${name}' not found.`);
        return -1;
      }
    } catch (error) {
      scraperLogger.error(`Error getting product ID for name: ${name}`, error);
      throw error;
    }
  }

  async addProduct(
    name: string,
    category: string,
    supermarket: string,
    productUrl: string | null = null
  ): Promise<number> {
    try {
      const result = await this.db.query<{ id: number }>(
        `INSERT INTO products (name, category, supermarket, product_url)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (name, supermarket)
         DO UPDATE SET
           category = EXCLUDED.category,
           product_url = EXCLUDED.product_url,
           updated_at = CURRENT_TIMESTAMP
         RETURNING id`,
        [name, category, supermarket, productUrl]
      );

      const id = result.rows[0].id;
      scraperLogger.debug(`Product '${name}' upserted with ID '${id}'.`);
      return id;
    } catch (error) {
      scraperLogger.error(`Error upserting product '${name}'`, error);
      throw error;
    }
  }

  async addProductWithTracking(
    name: string,
    category: string,
    supermarket: string,
    productUrl: string | null = null
  ): Promise<{ id: number; wasCreated: boolean }> {
    try {
      // Check if product exists first to track creation vs update
      const existingProduct = await this.db.query<{ id: number }>(
        "SELECT id FROM products WHERE name = $1 AND supermarket = $2",
        [name, supermarket]
      );

      const wasCreated = existingProduct.rows.length === 0;

      // Use UPSERT to insert or update product
      const result = await this.db.query<{ id: number }>(
        `INSERT INTO products (name, category, supermarket, product_url)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (name, supermarket)
         DO UPDATE SET
           category = EXCLUDED.category,
           product_url = EXCLUDED.product_url,
           updated_at = CURRENT_TIMESTAMP
         RETURNING id`,
        [name, category, supermarket, productUrl]
      );

      const id = result.rows[0].id;
      scraperLogger.debug(
        `Product '${name}' ${
          wasCreated ? "created" : "updated"
        } with ID '${id}'.`
      );
      return { id, wasCreated };
    } catch (error) {
      scraperLogger.error(`Error upserting product '${name}'`, error);
      throw error;
    }
  }

  async updateProduct(
    id: number,
    updates: Partial<Omit<ProductModel, "id">>
  ): Promise<boolean> {
    try {
      const updateFields: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (updates.name !== undefined) {
        updateFields.push(`name = $${paramIndex++}`);
        values.push(updates.name);
      }
      if (updates.category !== undefined) {
        updateFields.push(`category = $${paramIndex++}`);
        values.push(updates.category);
      }
      if (updates.supermarket !== undefined) {
        updateFields.push(`supermarket = $${paramIndex++}`);
        values.push(updates.supermarket);
      }

      if (updateFields.length === 0) {
        scraperLogger.debug("No fields to update.");
        return false;
      }

      values.push(id);
      const query = `UPDATE products SET ${updateFields.join(
        ", "
      )} WHERE id = $${paramIndex}`;

      const result = await this.db.query(query, values);

      if (result.rowCount === 0) {
        scraperLogger.warn(`Product with ID: ${id} not found for update.`);
        return false;
      }

      scraperLogger.debug(`Product ID '${id}' updated successfully.`);
      return true;
    } catch (error) {
      scraperLogger.error(`Error updating product with ID: ${id}`, error);
      throw error;
    }
  }

  async updateProducts(
    key: keyof Omit<ProductModel, "id">,
    updateObjects: Array<{ id: number; [key: string]: any }>
  ): Promise<void> {
    try {
      let changesMade = 0;

      for (const updateObj of updateObjects) {
        if (updateObj[key] !== undefined) {
          const result = await this.db.query(
            `UPDATE products SET ${key} = $1 WHERE id = $2`,
            [updateObj[key], updateObj.id]
          );

          if (result.rowCount && result.rowCount > 0) {
            changesMade++;
            scraperLogger.debug(
              `Product ID '${updateObj.id}' updated: '${key}' set to '${updateObj[key]}'.`
            );
          }
        }
      }

      if (changesMade > 0) {
        scraperLogger.debug(`${changesMade} products updated successfully.`);
      } else {
        scraperLogger.debug("No updates were made to products.");
      }
    } catch (error) {
      scraperLogger.error("Error updating multiple products", error);
      throw error;
    }
  }
}

export default PostgresProductController;
