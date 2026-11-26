import PostgresDiscountController from "../controllers/PostgresDiscountController";
import PostgresProductController, { ArticleLink } from "../controllers/PostgresProductController";
import PostgresScraperRunController from "../controllers/PostgresScraperRunController";
import PostgresScheduledRunController from "../controllers/PostgresScheduledRunController";
import { scraperLogger } from "../utils/Logger";
import { parseQuantity } from "../utils/Quantity";
import { matchFields, normalizeEan } from "../utils/ProductMatch";
import PostgresDataContext from "./PostgresDataContext";
import { getDatabaseConfig } from "../config/database";

/** Offers are matched on the supermarket's product id when known, else on name. */
const productKey = (item: IProductDiscountDetails) =>
  item.externalId ? `id:${item.externalId}` : `name:${item.name}`;

const offerQuantity = (item: IProductDiscountDetails) =>
  item.quantity !== undefined ? item.quantity : parseQuantity(item.name);

/** Article numbers and quantity to find the offer's catalog row, when it has them. */
const articleLink = (item: IProductDiscountDetails): ArticleLink | undefined =>
  item.articleNumbers?.length
    ? { articleNumbers: item.articleNumbers, quantity: offerQuantity(item) }
    : undefined;

export class PostgresDataManager {
  private productController: PostgresProductController;
  private discountController: PostgresDiscountController;
  private scraperRunController: PostgresScraperRunController;
  private scheduledRunController: PostgresScheduledRunController;
  public db: PostgresDataContext;

  constructor() {
    const config = getDatabaseConfig();
    this.db = PostgresDataContext.getInstance(config);

    this.productController = new PostgresProductController(this.db);
    this.discountController = new PostgresDiscountController(this.db);
    this.scraperRunController = new PostgresScraperRunController(this.db);
    this.scheduledRunController = new PostgresScheduledRunController(this.db);

    scraperLogger.debug("PostgresDataManager initialized.");
  }

  public getProductController(): PostgresProductController {
    return this.productController;
  }

  public getDiscountController(): PostgresDiscountController {
    return this.discountController;
  }

  public getScraperRunController(): PostgresScraperRunController {
    return this.scraperRunController;
  }

  public getScheduledRunController(): PostgresScheduledRunController {
    return this.scheduledRunController;
  }

  public async testConnection(): Promise<boolean> {
    return await this.db.testConnection();
  }

  public async addProductDb(
    supermarket: string,
    products: IProductDiscountDetails[]
  ): Promise<{ created: number; updated: number }> {
    scraperLogger.debug("Add to Product database.");

    // Deduplicate products by id (or name without one) - keep first occurrence
    const uniqueProducts = new Map<string, IProductDiscountDetails>();
    for (const product of products) {
      if (!uniqueProducts.has(productKey(product))) {
        uniqueProducts.set(productKey(product), product);
      } else {
        scraperLogger.debug(
          `Duplicate product '${product.name}' found in scraped data. Using first occurrence.`
        );
      }
    }

    let created = 0;
    let updated = 0;

    const uniqueProductArray = Array.from(uniqueProducts.values());
    let regularPrices = 0;
    for (const product of uniqueProductArray) {
      const quantity = offerQuantity(product);
      const result = product.externalId
        ? await this.productController.addProductByExternalId(
            product.name,
            product.category,
            supermarket,
            product.productUrl ?? null,
            product.externalId,
            articleLink(product)
          )
        : await this.productController.addProductWithTracking(
            product.name,
            product.category,
            supermarket,
            product.productUrl ?? null
          );
      if (typeof product.regularPrice === "number" && product.regularPrice > 0) {
        await this.productController.setRegularPriceFromOffer(result.id, product.regularPrice);
        regularPrices++;
      }
      const match = matchFields(product.name, product.brand);
      await this.productController.setOfferDetails(result.id, {
        quantity,
        brand: product.brand?.trim() || null,
        matchBrand: match.matchBrand,
        matchTokens: match.matchTokens,
        imageUrl: product.imageUrl || null,
        ean: normalizeEan(product.ean),
      });
      if (result.wasCreated) {
        created++;
      } else {
        updated++;
      }
    }
    scraperLogger.debug(
      `Processed '${uniqueProductArray.length}' unique products: ${created} created, ${updated} updated (from ${products.length} scraped items).`
    );
    if (regularPrices > 0) {
      scraperLogger.debug(`Stored ${regularPrices} regular prices shown next to ${supermarket} offers.`);
    }

    return { created, updated };
  }

  public async addDiscountDb(
    discounts: IProductDiscountDetails[],
    supermarket: string,
    currentBatchRunDate: Date
  ): Promise<{ created: number; skipped: number }> {
    scraperLogger.debug("Add to Discount database with smart logic.");

    // Deduplicate discounts by product id (or name without one) - keep first occurrence
    const uniqueDiscounts = new Map<string, IProductDiscountDetails>();
    for (const discount of discounts) {
      if (!uniqueDiscounts.has(productKey(discount))) {
        uniqueDiscounts.set(productKey(discount), discount);
      } else {
        scraperLogger.debug(
          `Duplicate discount for '${discount.name}' found in scraped data. Using first occurrence.`
        );
      }
    }

    // Get the previous successful batch run's promotion expire date
    const lastSuccessfulRun =
      await this.scraperRunController.getLastSuccessfulRunBySupermarket(
        supermarket
      );
    const previousBatchExpireDate =
      lastSuccessfulRun?.promotionExpireDate || null;

    scraperLogger.debug(
      `Previous batch expire date for ${supermarket}: ${
        previousBatchExpireDate ? previousBatchExpireDate.toISOString() : "none"
      }`
    );

    let discountsCreated = 0;
    let discountsSkipped = 0;

    const uniqueDiscountArray = Array.from(uniqueDiscounts.values());
    for (const discount of uniqueDiscountArray) {
      const productId = discount.externalId
        ? await this.productController.getProductIdByExternalId(
            discount.externalId,
            supermarket,
            articleLink(discount)
          )
        : await this.productController.getProductId(discount.name, supermarket);

      if (productId === -1) {
        scraperLogger.warn(
          `Product '${discount.name}' not found. Skipping discount.`
        );
        discountsSkipped++;
        continue;
      }

      const discountId = await this.discountController.addDiscountSmart(
        productId,
        discount.originalPrice,
        discount.discountPrice,
        discount.unitPrice ?? null,
        discount.specialDiscount,
        discount.expireDate,
        previousBatchExpireDate,
        currentBatchRunDate
      );

      if (discountId === -1) {
        discountsSkipped++;
      } else {
        discountsCreated++;
      }
    }

    scraperLogger.debug(
      `Processed '${uniqueDiscountArray.length}' unique discounts: ${discountsCreated} created, ${discountsSkipped} skipped (from ${discounts.length} scraped items).`
    );

    return { created: discountsCreated, skipped: discountsSkipped };
  }

  public async getSupermarketDiscountsVerbose(
    supermarket: string
  ): Promise<IProductDiscountDetails[]> {
    scraperLogger.debug(
      "Combine databases to create a ProductDiscountDetails structure."
    );

    try {
      const products = await this.productController.getProductsBySupermarket(
        supermarket
      );
      const productDiscounts: IProductDiscountDetails[] = [];

      for (const product of products) {
        const discounts = await this.discountController.getDiscountsByProductId(
          product.id
        );

        for (const discount of discounts) {
          const details: IProductDiscountDetails = {
            name: product.name,
            originalPrice: discount.originalPrice,
            discountPrice: discount.discountPrice,
            unitPrice: discount.unitPrice,
            specialDiscount: discount.specialDiscount,
            category: product.category,
            supermarket: product.supermarket,
            expireDate: discount.expireDate,
            productUrl: product.product_url ?? null,
          };
          productDiscounts.push(details);
        }
      }

      scraperLogger.debug(
        `Found ${productDiscounts.length} discounts for supermarket '${supermarket}'.`
      );
      return productDiscounts;
    } catch (error) {
      scraperLogger.error("Error retrieving supermarket discounts:", error);
      throw new Error("Failed to retrieve supermarket discounts.");
    }
  }

  public async getSupermarketExpireDate(supermarket: string): Promise<string> {
    scraperLogger.debug("Fetching data to determine supermarket expire date.");

    try {
      const products = await this.productController.getProductsBySupermarket(
        supermarket
      );

      if (products.length === 0) {
        scraperLogger.warn(
          `No products found for supermarket '${supermarket}'.`
        );
        return "";
      }

      const discounts = await this.discountController.getDiscountsByProductId(
        products[0].id
      );

      if (discounts.length > 0 && discounts[0].expireDate) {
        scraperLogger.debug(
          `Expire date for supermarket '${supermarket}' is '${discounts[0].expireDate}'.`
        );
        return discounts[0].expireDate;
      } else {
        scraperLogger.warn(
          `No matching discounts found for supermarket '${supermarket}'.`
        );
        return "";
      }
    } catch (error) {
      scraperLogger.error(
        `Error getting expire date for supermarket '${supermarket}':`,
        error
      );
      return "";
    }
  }

  public async deleteRecordsBySupermarket(
    supermarket: string
  ): Promise<number> {
    scraperLogger.debug(
      `Deactivating discounts for '${supermarket}' (products will be updated, not deleted).`
    );

    try {
      // Deactivate all active discounts for this supermarket
      const deactivatedCount =
        await this.discountController.deactivateDiscountsBySupermarket(
          supermarket
        );

      scraperLogger.debug(
        `Deactivated ${deactivatedCount} discount records for '${supermarket}'. Products will be updated during the next scrape.`
      );

      return deactivatedCount;
    } catch (error) {
      scraperLogger.error("Error during deactivation:", error);
      throw new Error("Failed to deactivate discounts for supermarket.");
    }
  }

  public async close(): Promise<void> {
    await this.db.close();
  }
}

export default PostgresDataManager;
