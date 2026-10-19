import { AxiosInstance } from "axios";
import moment from "moment";
import ApiClient from "./ApiClient";
import { scraperLogger } from "../utils/Logger";
import { folderExpireDate, promotionPrice } from "../utils/Promotion";
import { parseQuantity, Quantity, unitPriceText } from "../utils/Quantity";
import AhMobileApi, {
  AhProduct,
  ahImage,
  ahProductUrl,
  REQUEST_DELAY_MS,
  sleep,
} from "./ah/AhMobileApi";

const PAGE_SIZE = 200;

// Long-running webshop deals (perfume, gadgets) that are flagged as national
// bonus but are not part of the weekly bonus.
const EXCLUDED_SEGMENTS = new Set(["voordeelshop"]);

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Price per item during the bonus. AH sets currentPrice for discounts that
 * change the shelf price (percentage, "voor 0.99", euro off); for multi-buy
 * bonuses it leaves it empty and the price per item follows from the label:
 *
 *   "3 voor 5.00" -> 1.67           "2e gratis"      -> regular / 2
 *   "2+1 gratis"  -> regular * 2/3  "2e halve prijs" -> regular * .75
 *   "per 100 gram voor 2.39" -> 2.39 per 100 g times the pack weight
 *
 * Returns null when no price below the regular price can be worked out.
 */
export function ahBonusPrice(product: AhProduct, regular: number, quantity: Quantity | null): number | null {
  const current = product.currentPrice;
  if (typeof current === "number" && current > 0 && current < regular - 0.001) return round2(current);

  const label = product.discountLabels?.[0];
  const count = label?.count ?? 0;
  let price: number | null = null;
  switch (label?.code) {
    case "DISCOUNT_X_FOR_Y":
      if (count > 0 && label.price) price = label.price / count;
      break;
    case "DISCOUNT_ONE_FREE":
      if (count > 1) price = (regular * (count - 1)) / count;
      break;
    case "DISCOUNT_X_PLUS_Y_FREE":
      if (count > 0 && label.freeCount) price = (regular * count) / (count + label.freeCount);
      break;
    case "DISCOUNT_ONE_HALF_PRICE":
      if (count > 1) price = (regular * (count - 0.5)) / count;
      break;
    case "DISCOUNT_PERCENTAGE":
      if (label.percentage) price = regular * (1 - label.percentage / 100);
      break;
    case "DISCOUNT_FIXED_PRICE":
      if (label.price) price = label.price;
      break;
    case "DISCOUNT_AMOUNT":
      if (label.amount) price = regular - label.amount;
      break;
    case "DISCOUNT_WEIGHT":
      // "per 100 GRAM voor 2.39" on a pack of about 120 g.
      if (label.price && count > 0 && label.unit === "GRAM" && quantity?.unit === "kg") {
        price = (label.price * quantity.value * 1000) / count;
      }
      break;
  }
  if (price === null) price = promotionPrice(product.bonusMechanism, regular);
  if (price === null || !Number.isFinite(price) || price <= 0 || price >= regular - 0.001) return null;
  return round2(price);
}

/**
 * Maps one product with a bonus to a discount; null when it is not part of
 * the weekly bonus in the stores (online-only, Etos, Gall & Gall, webshop
 * deals, standing volume discounts), has ended, or has no usable price.
 */
export function mapAhDiscount(product: AhProduct, now: Date = new Date()): IProductDiscountDetails | null {
  if (!product.isBonus || product.promotionType !== "NATIONAL" || !product.title) return null;
  if (EXCLUDED_SEGMENTS.has((product.bonusSegmentDescription ?? "").trim().toLowerCase())) return null;
  if (!product.bonusEndDate) return null;
  const end = moment(product.bonusEndDate, "YYYY-MM-DD").endOf("day");
  if (!end.isValid() || end.toDate() < now) return null;

  const regular = product.priceBeforeBonus ?? product.currentPrice;
  if (typeof regular !== "number" || regular <= 0) return null;

  const quantity = parseQuantity(product.salesUnitSize);
  const discountPrice = ahBonusPrice(product, regular, quantity);
  if (discountPrice === null) return null;

  const specialDiscount = [
    product.bonusMechanism?.trim(),
    product.bonusPeriodDescription?.trim(),
    product.bonusSegmentDescription?.trim(),
  ]
    .filter(Boolean)
    .join(" | ");

  return {
    name: product.title.trim(),
    originalPrice: regular,
    discountPrice,
    unitPrice: unitPriceText(discountPrice, quantity),
    quantity,
    specialDiscount,
    category: product.mainCategory?.trim() || "Overig",
    supermarket: "Albert Heijn",
    expireDate: end.toISOString(true),
    productUrl: ahProductUrl(product),
    externalId: String(product.webshopId),
    imageUrl: ahImage(product),
    brand: product.brand?.trim() || null,
  };
}

/**
 * Albert Heijn's weekly bonus, one discount per product: the AH mobile API
 * lists every product with a bonus per category, with its regular price,
 * bonus details and pack size. No browser needed. Products are linked to
 * their catalog row by webshopId.
 */
class AhApiClient extends ApiClient {
  public name = "Albert Heijn";

  private api: AhMobileApi;

  constructor(http?: AxiosInstance) {
    super();
    this.api = new AhMobileApi(http);
    scraperLogger.debug(`Created a '${this.name}' API Client instance.`);
  }

  public async fetchDiscounts(): Promise<{
    discounts: IProductDiscountDetails[];
    expireDate: string;
  }> {
    scraperLogger.info("Fetching Albert Heijn bonus products via the AH mobile API");
    await this.api.authenticate();
    const categories = await this.api.categories();
    if (categories.length === 0) throw new Error("AH: no product categories returned");

    const now = new Date();
    const discounts = new Map<string, IProductDiscountDetails>();
    let seen = 0;

    for (const category of categories) {
      let page = 0;
      let totalPages = 1;
      while (page < totalPages) {
        const data = await this.api.searchPage(category.id, page, PAGE_SIZE, true);
        totalPages = data.page?.totalPages ?? 0;
        for (const product of data.products ?? []) {
          seen++;
          const discount = mapAhDiscount(product, now);
          if (discount && !discounts.has(discount.externalId!)) discounts.set(discount.externalId!, discount);
        }
        page++;
        await sleep(REQUEST_DELAY_MS);
      }
      scraperLogger.info(`AH bonus: '${category.name}' done, ${discounts.size} bonus products so far`);
    }

    const result = Array.from(discounts.values());
    const expireDate = folderExpireDate(result);
    scraperLogger.info(
      `Total Albert Heijn bonus products: ${result.length} of ${seen} with any bonus, expire: ${expireDate}`
    );
    return { discounts: result, expireDate };
  }
}

export default AhApiClient;
