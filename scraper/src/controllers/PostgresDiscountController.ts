import PostgresDataContext from "../data/PostgresDataContext";
import { DiscountModel } from "../models/DiscountModel";
import { scraperLogger } from "../utils/Logger";

interface DiscountRow {
  id: number;
  product_id: number;
  original_price: string;
  discount_price: string;
  unit_price: string | null;
  special_discount: string;
  expire_date: Date;
  active: boolean;
}

class PostgresDiscountController {
  private db: PostgresDataContext;

  constructor(db: PostgresDataContext) {
    this.db = db;
    scraperLogger.debug("PostgresDiscountController initialized.");
  }

  async exists(): Promise<boolean> {
    scraperLogger.debug("Checking if the discounts table exists.");
    try {
      const result = await this.db.query<{ exists: boolean }>(
        `SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'discounts'
        )`
      );
      return result.rows[0].exists;
    } catch (error) {
      scraperLogger.error("Error checking if discounts table exists", error);
      return false;
    }
  }

  async delete(): Promise<void> {
    scraperLogger.debug("Deleting all discounts from database.");
    try {
      await this.db.query("TRUNCATE TABLE discounts CASCADE");
      scraperLogger.debug("All discounts deleted successfully.");
    } catch (error) {
      scraperLogger.error("Error deleting discounts", error);
      throw error;
    }
  }

  async getDiscounts(): Promise<DiscountModel[]> {
    scraperLogger.debug("Fetching all discounts.");
    try {
      const result = await this.db.query<DiscountRow>(
        "SELECT product_id, original_price, discount_price, unit_price, special_discount, expire_date, active FROM discounts ORDER BY expire_date DESC"
      );

      return result.rows.map(
        (row: DiscountRow) =>
          new DiscountModel(
            row.product_id,
            parseFloat(row.original_price),
            parseFloat(row.discount_price),
            row.unit_price ?? null,
            row.special_discount,
            row.expire_date.toISOString(),
            row.active
          )
      );
    } catch (error) {
      scraperLogger.error("Error fetching discounts", error);
      throw error;
    }
  }

  async getDiscountsByProductId(productId: number): Promise<DiscountModel[]> {
    scraperLogger.debug(`Fetching discounts for product ID: ${productId}`);
    try {
      const result = await this.db.query<DiscountRow>(
        `SELECT product_id, original_price, discount_price, unit_price, special_discount, expire_date, active
         FROM discounts
         WHERE product_id = $1
         ORDER BY expire_date DESC`,
        [productId]
      );

      return result.rows.map(
        (row: DiscountRow) =>
          new DiscountModel(
            row.product_id,
            parseFloat(row.original_price),
            parseFloat(row.discount_price),
            row.unit_price ?? null,
            row.special_discount,
            row.expire_date.toISOString(),
            row.active
          )
      );
    } catch (error) {
      scraperLogger.error(
        `Error fetching discounts for product ID: ${productId}`,
        error
      );
      throw error;
    }
  }

  async getActiveDiscounts(): Promise<DiscountModel[]> {
    scraperLogger.debug(
      "Fetching active discounts (active=true and not expired)."
    );
    try {
      const result = await this.db.query<DiscountRow>(
        `SELECT product_id, original_price, discount_price, unit_price, special_discount, expire_date, active
         FROM discounts
         WHERE active = true AND expire_date > NOW()
         ORDER BY expire_date ASC`
      );

      return result.rows.map(
        (row: DiscountRow) =>
          new DiscountModel(
            row.product_id,
            parseFloat(row.original_price),
            parseFloat(row.discount_price),
            row.unit_price ?? null,
            row.special_discount,
            row.expire_date.toISOString(),
            row.active
          )
      );
    } catch (error) {
      scraperLogger.error("Error fetching active discounts", error);
      throw error;
    }
  }

  async getExpiredDiscounts(): Promise<DiscountModel[]> {
    scraperLogger.debug("Fetching expired discounts.");
    try {
      const result = await this.db.query<DiscountRow>(
        `SELECT product_id, original_price, discount_price, unit_price, special_discount, expire_date, active
         FROM discounts
         WHERE expire_date <= NOW()
         ORDER BY expire_date DESC`
      );

      return result.rows.map(
        (row: DiscountRow) =>
          new DiscountModel(
            row.product_id,
            parseFloat(row.original_price),
            parseFloat(row.discount_price),
            row.unit_price ?? null,
            row.special_discount,
            row.expire_date.toISOString(),
            row.active
          )
      );
    } catch (error) {
      scraperLogger.error("Error fetching expired discounts", error);
      throw error;
    }
  }

  async getDiscountsByPriceRange(
    minPrice: number,
    maxPrice: number
  ): Promise<DiscountModel[]> {
    scraperLogger.debug(
      `Fetching discounts in price range: ${minPrice} - ${maxPrice}`
    );
    try {
      const result = await this.db.query<DiscountRow>(
        `SELECT product_id, original_price, discount_price, unit_price, special_discount, expire_date, active
         FROM discounts
         WHERE discount_price BETWEEN $1 AND $2
         AND active = true
         AND expire_date > NOW()
         ORDER BY discount_price ASC`,
        [minPrice, maxPrice]
      );

      return result.rows.map(
        (row: DiscountRow) =>
          new DiscountModel(
            row.product_id,
            parseFloat(row.original_price),
            parseFloat(row.discount_price),
            row.unit_price ?? null,
            row.special_discount,
            row.expire_date.toISOString(),
            row.active
          )
      );
    } catch (error) {
      scraperLogger.error(
        `Error fetching discounts by price range: ${minPrice} - ${maxPrice}`,
        error
      );
      throw error;
    }
  }

  async addDiscount(
    productId: number,
    originalPrice: number,
    discountPrice: number,
    unitPrice: string | null,
    specialDiscount: string,
    expireDate: string
  ): Promise<number> {
    try {
      const result = await this.db.query<{ id: number }>(
        `INSERT INTO discounts (product_id, original_price, discount_price, unit_price, special_discount, expire_date, active)
         VALUES ($1, $2, $3, $4, $5, $6, true)
         RETURNING id`,
        [productId, originalPrice, discountPrice, unitPrice, specialDiscount, expireDate]
      );

      const newId = result.rows[0].id;
      scraperLogger.debug(
        `New discount added for product ID '${productId}' with discount ID '${newId}'.`
      );
      return newId;
    } catch (error) {
      scraperLogger.error(
        `Error adding discount for product ID: ${productId}`,
        error
      );
      throw error;
    }
  }

  /**
   * Check if a discount exists for a product (regardless of expire date)
   */
  async hasDiscount(productId: number): Promise<boolean> {
    scraperLogger.debug(
      `Checking if discount exists for product ID: ${productId}`
    );
    try {
      const result = await this.db.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM discounts WHERE product_id = $1`,
        [productId]
      );
      return parseInt(result.rows[0].count, 10) > 0;
    } catch (error) {
      scraperLogger.error(
        `Error checking discount existence for product ID: ${productId}`,
        error
      );
      throw error;
    }
  }

  /**
   * Get the most recent discount for a product
   */
  async getLatestDiscountByProductId(
    productId: number
  ): Promise<DiscountModel | null> {
    scraperLogger.debug(
      `Fetching latest discount for product ID: ${productId}`
    );
    try {
      const result = await this.db.query<DiscountRow>(
        `SELECT product_id, original_price, discount_price, unit_price, special_discount, expire_date, active
         FROM discounts
         WHERE product_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [productId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return new DiscountModel(
        row.product_id,
        parseFloat(row.original_price),
        parseFloat(row.discount_price),
        row.unit_price ?? null,
        row.special_discount,
        row.expire_date.toISOString(),
        row.active
      );
    } catch (error) {
      scraperLogger.error(
        `Error fetching latest discount for product ID: ${productId}`,
        error
      );
      throw error;
    }
  }

  /**
   * Check if a product has an active discount that hasn't expired yet
   */
  async hasActiveNonExpiredDiscount(productId: number): Promise<boolean> {
    scraperLogger.debug(
      `Checking if product ID ${productId} has an active non-expired discount`
    );
    try {
      const result = await this.db.query<{ count: string }>(
        `SELECT COUNT(*) as count 
         FROM discounts 
         WHERE product_id = $1 
         AND active = true 
         AND expire_date > NOW()`,
        [productId]
      );
      const hasActive = parseInt(result.rows[0].count, 10) > 0;
      scraperLogger.debug(
        `Product ID ${productId} has active non-expired discount: ${hasActive}`
      );
      return hasActive;
    } catch (error) {
      scraperLogger.error(
        `Error checking active discount for product ID: ${productId}`,
        error
      );
      throw error;
    }
  }

  /**
   * Smart add discount with new logic:
   * - Add discount if product_id doesn't exist in discount table
   * - Add discount if product_id exists but the discount is deactivated (active = false)
   * - Skip if product_id exists and discount is active (active = true)
   * - Note: Discounts are automatically deactivated when expire_date passes (handled by scheduler)
   *
   * @param productId The product ID
   * @param originalPrice Original price
   * @param discountPrice Discount price
   * @param specialDiscount Special discount text
   * @param expireDate Expire date for this discount
   * @param previousBatchExpireDate The expire date from the previous successful batch run (not used in new logic)
   * @param currentBatchRunDate The date of the current batch run (not used in new logic)
   * @returns The discount ID if created, -1 if skipped
   */
  async addDiscountSmart(
    productId: number,
    originalPrice: number,
    discountPrice: number,
    unitPrice: string | null,
    specialDiscount: string,
    expireDate: string,
    previousBatchExpireDate: Date | null,
    currentBatchRunDate: Date
  ): Promise<number> {
    scraperLogger.debug(`Smart add discount for product ID: ${productId}`);

    try {
      // Check if product has an active, non-expired discount
      const hasActive = await this.hasActiveNonExpiredDiscount(productId);

      if (hasActive) {
        // Skip: Product already has an active discount
        scraperLogger.debug(
          `Product ID ${productId} already has an active discount. Skipping.`
        );
        return -1;
      }

      // Add discount: Either no discount exists or existing discount is deactivated/expired
      scraperLogger.debug(
        `Product ID ${productId} has no active discount. Adding new discount.`
      );
      return await this.addDiscount(
        productId,
        originalPrice,
        discountPrice,
        unitPrice,
        specialDiscount,
        expireDate
      );
    } catch (error) {
      scraperLogger.error(
        `Error in smart add discount for product ID: ${productId}`,
        error
      );
      throw error;
    }
  }

  async deleteDiscount(productId: number): Promise<boolean> {
    scraperLogger.debug(
      `Attempting to delete discounts for product ID: ${productId}`
    );
    try {
      const result = await this.db.query(
        "DELETE FROM discounts WHERE product_id = $1",
        [productId]
      );

      if (result.rowCount === 0) {
        scraperLogger.warn(`No discounts found for product ID: ${productId}.`);
        return false;
      }

      scraperLogger.debug(
        `Discounts for product ID: ${productId} have been deleted (${result.rowCount} records).`
      );
      return true;
    } catch (error) {
      scraperLogger.error(
        `Error deleting discounts for product ID: ${productId}`,
        error
      );
      throw error;
    }
  }

  async deleteExpiredDiscounts(): Promise<number> {
    scraperLogger.debug("Deleting expired discounts.");
    try {
      const result = await this.db.query(
        "DELETE FROM discounts WHERE expire_date <= NOW()"
      );

      const deletedCount = result.rowCount || 0;
      scraperLogger.debug(`Deleted ${deletedCount} expired discounts.`);
      return deletedCount;
    } catch (error) {
      scraperLogger.error("Error deleting expired discounts", error);
      throw error;
    }
  }

  /**
   * @deprecated This method updates existing discounts, which is not aligned with the historic table approach.
   * Use addDiscountSmart() instead to add new discount records over time.
   */
  async updateDiscount(
    productId: number,
    originalPrice: number,
    discountPrice: number,
    specialDiscount: string,
    expireDate: string
  ): Promise<boolean> {
    scraperLogger.debug(`Updating discount for product ID: ${productId}`);
    try {
      const result = await this.db.query(
        `UPDATE discounts 
         SET original_price = $2, discount_price = $3, special_discount = $4, expire_date = $5, active = true
         WHERE product_id = $1`,
        [productId, originalPrice, discountPrice, specialDiscount, expireDate]
      );

      if (result.rowCount === 0) {
        scraperLogger.warn(
          `No discount found for product ID: ${productId} to update.`
        );
        return false;
      }

      scraperLogger.debug(
        `Discount for product ID: ${productId} updated successfully.`
      );
      return true;
    } catch (error) {
      scraperLogger.error(
        `Error updating discount for product ID: ${productId}`,
        error
      );
      throw error;
    }
  }

  async deactivateDiscountsByProductIds(productIds: number[]): Promise<number> {
    scraperLogger.debug(
      `Deactivating discounts for ${productIds.length} products`
    );
    try {
      if (productIds.length === 0) {
        return 0;
      }

      const result = await this.db.query(
        `UPDATE discounts 
         SET active = false 
         WHERE product_id = ANY($1) AND active = true`,
        [productIds]
      );

      const deactivatedCount = result.rowCount || 0;
      scraperLogger.debug(`Deactivated ${deactivatedCount} discounts.`);
      return deactivatedCount;
    } catch (error) {
      scraperLogger.error("Error deactivating discounts", error);
      throw error;
    }
  }

  async deactivateDiscountsBySupermarket(supermarket: string): Promise<number> {
    scraperLogger.debug(
      `Deactivating all active discounts for supermarket: ${supermarket}`
    );
    try {
      const result = await this.db.query(
        `UPDATE discounts 
         SET active = false 
         WHERE active = true 
         AND product_id IN (
           SELECT id FROM products WHERE supermarket = $1
         )`,
        [supermarket]
      );

      const deactivatedCount = result.rowCount || 0;
      scraperLogger.debug(
        `Deactivated ${deactivatedCount} discounts for ${supermarket}.`
      );
      return deactivatedCount;
    } catch (error) {
      scraperLogger.error(
        `Error deactivating discounts for ${supermarket}`,
        error
      );
      throw error;
    }
  }

  /**
   * Deactivate all discounts that have passed their expire_date
   * This ensures the active flag reflects the actual validity of the discount
   */
  async deactivateExpiredDiscounts(): Promise<number> {
    scraperLogger.debug(
      "Deactivating discounts that have passed their expire_date"
    );
    try {
      const result = await this.db.query(
        `UPDATE discounts 
         SET active = false 
         WHERE active = true 
         AND expire_date <= NOW()`
      );

      const deactivatedCount = result.rowCount || 0;
      if (deactivatedCount > 0) {
        scraperLogger.debug(
          `Deactivated ${deactivatedCount} expired discounts.`
        );
      } else {
        scraperLogger.debug("No expired discounts to deactivate.");
      }
      return deactivatedCount;
    } catch (error) {
      scraperLogger.error("Error deactivating expired discounts", error);
      throw error;
    }
  }
}

export default PostgresDiscountController;
