import moment from "moment";
import ApiClient from "./ApiClient";
import { scraperLogger } from "../utils/Logger";
import { folderExpireDate, promotionPrice } from "../utils/Promotion";
import { unitPriceText } from "../utils/Quantity";
import PlusSite, {
  PLUS_OFFER_FILTER,
  PlusProduct,
  plusCategory,
  plusImageUrl,
  plusPrice,
  plusProductUrl,
  plusQuantity,
} from "./plus/PlusSite";

/**
 * The offers among PLUS products with the most common end date as run expiry.
 * Shared by the offers run (products on offer) and the catalog run (all
 * products; the ones without a promotion map to null).
 */
export function plusOffers(
  products: PlusProduct[],
  now: Date = new Date()
): { discounts: IProductDiscountDetails[]; expireDate: string } {
  const discounts = products
    .map((product) => mapPlusDiscount(product, now))
    .filter((d): d is IProductDiscountDetails => d !== null);
  if (discounts.length === 0) throw new Error("PLUS: no discounts found");

  const expireDate = folderExpireDate(discounts);
  scraperLogger.info(
    `Total PLUS discounts: ${discounts.length} of ${products.length} products, folder expires: ${expireDate}`
  );
  return { discounts, expireDate };
}

/**
 * Maps a product on offer to a discount, linked by its SKU; null for labels
 * that are not about the price ("Gratis bezorging bij 10.00 euro"). The price
 * per item comes from NewPrice when PLUS gives one, else from the label
 * ("2 VOOR 6.00", "1+1 GRATIS", "2E HALVE PRIJS").
 */
export function mapPlusDiscount(product: PlusProduct, now: Date = new Date()): IProductDiscountDetails | null {
  const name = product.Name?.trim();
  const regular = plusPrice(product.OriginalPrice);
  if (!name || !product.SKU || regular === null || product.IsFreeDeliveryOffer) return null;

  const label = [product.PromotionLabel, product.PromotionBasedLabel].map((l) => l?.trim()).filter(Boolean).join(" | ");
  const discountPrice = promotionPrice(product.PromotionLabel, regular, plusPrice(product.NewPrice));
  if (discountPrice === null) return null;

  const end = moment(product.PromotionEndDate, "YYYY-MM-DD", true);
  const expireDate = end.isValid() && end.year() > 1900
    ? end.endOf("day").toISOString(true)
    : moment(now).endOf("isoWeek").toISOString(true);
  if (new Date(expireDate) < now) return null;
  const quantity = plusQuantity(product);

  return {
    name,
    originalPrice: regular,
    discountPrice,
    unitPrice: unitPriceText(discountPrice, quantity),
    quantity,
    specialDiscount: label,
    category: plusCategory(product),
    supermarket: "PLUS",
    expireDate,
    productUrl: plusProductUrl(product),
    externalId: product.SKU,
    imageUrl: plusImageUrl(product),
    brand: product.Brand?.trim() || null,
  };
}

class PlusApiClient extends ApiClient {
  public name = "PLUS";

  private createSite: () => PlusSite;

  constructor(createSite: () => PlusSite = () => new PlusSite()) {
    super();
    this.createSite = createSite;
    scraperLogger.debug(`Created a '${this.name}' API Client instance.`);
  }

  public async fetchDiscounts(): Promise<{
    discounts: IProductDiscountDetails[];
    expireDate: string;
  }> {
    scraperLogger.debug(`Fetching PLUS discounts via the plus.nl product list (offers filter)`);

    const site = this.createSite();
    const onOffer: PlusProduct[] = [];
    try {
      await site.open();
      await site.forEachPage(PLUS_OFFER_FILTER, async (products) => {
        onOffer.push(...products);
      });
    } finally {
      await site.close();
    }

    return plusOffers(onOffer);
  }
}

export default PlusApiClient;
