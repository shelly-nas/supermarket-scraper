import { AxiosInstance } from "axios";
import moment from "moment";
import ApiClient from "./ApiClient";
import { scraperLogger } from "../utils/Logger";
import { folderExpireDate, promotionPrice } from "../utils/Promotion";
import HoogvlietGraphql, {
  HoogvlietListedProduct,
  hoogvlietBrand,
  hoogvlietEan,
  hoogvlietQuantity,
  hoogvlietUnitPrice,
  productUrl,
} from "./hoogvliet/HoogvlietGraphql";

/**
 * Maps a product on promotion to a discount; null when it is not on a current
 * promotion. The discount price is the price per item, also for multi-buy
 * offers such as "3 voor 6,00".
 */
export function mapHoogvlietDiscount(
  product: HoogvlietListedProduct,
  now: Date = new Date()
): IProductDiscountDetails | null {
  const promotion = product.promotion_meta_data;
  if (!product.is_promotion || !promotion?.valid_to) return null;
  const validTo = moment(promotion.valid_to);
  if (!validTo.isValid() || validTo.toDate() <= now) return null;

  const regular = product.price_range?.minimum_price?.regular_price?.value;
  const final = product.price_range?.minimum_price?.final_price?.value ?? regular;
  if (typeof regular !== "number" || typeof final !== "number") return null;

  return {
    name: product.name.trim(),
    originalPrice: regular,
    // Labels that are not a price promotion ("Op = op") keep the final price.
    discountPrice: promotionPrice(promotion.korting_label, regular, final) ?? Math.round(final * 100) / 100,
    unitPrice: hoogvlietUnitPrice(product.sub_title_attributes),
    quantity: hoogvlietQuantity(product.sub_title_attributes),
    specialDiscount: promotion.korting_label?.trim() ?? "",
    category: product.category,
    supermarket: "Hoogvliet",
    expireDate: validTo.toISOString(true),
    productUrl: productUrl(product),
    externalId: product.sku,
    imageUrl: product.small_image?.url ?? null,
    brand: hoogvlietBrand(product),
    ean: hoogvlietEan(product),
  };
}

export { folderExpireDate };

/** The discounts among a page of Hoogvliet products. */
export function hoogvlietDiscounts(products: HoogvlietListedProduct[]): IProductDiscountDetails[] {
  return products
    .map((product) => mapHoogvlietDiscount(product))
    .filter((d): d is IProductDiscountDetails => d !== null);
}

/** Hoogvliet's offers with the most common end date as run expiry; shared with the catalog run. */
export function hoogvlietOffers(
  discounts: IProductDiscountDetails[]
): { discounts: IProductDiscountDetails[]; expireDate: string } {
  const expireDate = folderExpireDate(discounts);
  scraperLogger.info(`Total Hoogvliet discounts: ${discounts.length}, folder expires: ${expireDate}`);
  return { discounts, expireDate };
}

class HoogvlietApiClient extends ApiClient {
  public name = "Hoogvliet";

  private api: HoogvlietGraphql;

  constructor(http?: AxiosInstance) {
    super();
    this.api = new HoogvlietGraphql(http);
    scraperLogger.debug(`Created a '${this.name}' API Client instance.`);
  }

  public async fetchDiscounts(): Promise<{
    discounts: IProductDiscountDetails[];
    expireDate: string;
  }> {
    scraperLogger.info("Fetching Hoogvliet discounts via the webshop GraphQL API");

    const discounts: IProductDiscountDetails[] = [];
    await this.api.forEachCategory(async (products) => {
      discounts.push(...hoogvlietDiscounts(products));
    });
    return hoogvlietOffers(discounts);
  }
}

export default HoogvlietApiClient;
