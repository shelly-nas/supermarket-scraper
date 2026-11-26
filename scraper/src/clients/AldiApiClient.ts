import { AxiosInstance } from "axios";
import moment from "moment";
import ApiClient from "./ApiClient";
import { scraperLogger } from "../utils/Logger";
import { folderExpireDate, promotionPrice } from "../utils/Promotion";
import { unitPriceText } from "../utils/Quantity";
import AldiAlgolia, {
  AldiProduct,
  aldiCategory,
  aldiImageUrl,
  aldiName,
  aldiProductUrl,
  aldiQuantity,
  isAldiOffer,
} from "./aldi/AldiAlgolia";
import { aldiFoodFilter } from "./aldi/AldiFood";

/**
 * The regular product an offer belongs to: the same article id, or the id
 * without the leading 9 that some offer articles carry; null for offer
 * articles of their own (e.g. a week-only multipack).
 */
export function aldiLinkedId(offerId: string, regular: Map<string, AldiProduct>): string | null {
  if (regular.has(offerId)) return offerId;
  if (offerId.startsWith("9") && regular.has(offerId.slice(1))) return offerId.slice(1);
  return null;
}

/**
 * Maps a product of the current folder to a discount, valid until the end of
 * its folder category ("Vanaf woensdag" 14-10 to 18-10). The regular price is
 * the struck-through price, else the linked product's price when higher.
 * "2 VOOR" with price 2.00 is 1.00 per item.
 */
export function mapAldiDiscount(
  offer: AldiProduct,
  regular: Map<string, AldiProduct>,
  endDate: string,
  now: Date = new Date()
): IProductDiscountDetails | null {
  const name = aldiName(offer);
  const price = offer.currentPrice;
  if (!name || !price || typeof price.priceValue !== "number" || price.priceValue <= 0) return null;
  if (offer.isAvailable === false) return null;

  const end = moment(endDate, "YYYY-MM-DD", true);
  if (!end.isValid()) return null;
  const expireDate = end.endOf("day").toISOString(true);
  if (new Date(expireDate) < now) return null;

  const linkedId = aldiLinkedId(offer.objectID, regular);
  const linked = linkedId ? regular.get(linkedId)! : null;

  const label = [price.priceTagLabels?.promoText1, price.priceTagLabels?.promoText2]
    .map((t) => t?.trim())
    .filter(Boolean)
    .join(" ");
  const multiBuy = /^\d+\s*voor$/i.test(label)
    ? promotionPrice(`${label} ${price.priceValue}`, price.priceValue)
    : null;
  const discountPrice = multiBuy ?? price.priceValue;
  const strike = price.strikePrice?.strikePriceValue;
  const linkedPrice = linked?.currentPrice?.priceValue;
  const regularPrice = typeof strike === "number" && strike > discountPrice
    ? strike
    : typeof linkedPrice === "number" && linkedPrice > discountPrice
      ? linkedPrice
      : 0;
  const quantity = aldiQuantity(offer);

  return {
    name,
    originalPrice: regularPrice,
    discountPrice,
    unitPrice: unitPriceText(discountPrice, quantity),
    quantity,
    specialDiscount: label,
    category: aldiCategory(linked ?? offer),
    supermarket: "Aldi",
    expireDate,
    productUrl: aldiProductUrl(offer),
    externalId: linkedId ?? offer.objectID,
    imageUrl: aldiImageUrl(offer),
    brand: offer.brandName?.trim() || null,
  };
}

class AldiApiClient extends ApiClient {
  public name = "Aldi";

  private api: AldiAlgolia;

  constructor(http?: AxiosInstance, web?: AxiosInstance) {
    super();
    this.api = new AldiAlgolia(http, web);
    scraperLogger.debug(`Created a '${this.name}' API Client instance.`);
  }

  public async fetchDiscounts(): Promise<{
    discounts: IProductDiscountDetails[];
    expireDate: string;
  }> {
    scraperLogger.debug(`Fetching Aldi discounts via the aldi.nl offers page`);

    const folder = await this.api.folder();
    const regular = new Map((await this.api.all()).filter((p) => !isAldiOffer(p)).map((p) => [p.objectID, p]));

    // Only food and drink: an offer of a regular product follows that
    // product's category, other offers are judged by name and brand.
    const isFood = aldiFoodFilter([...regular.values()]);
    const nonFood = new Set<string>();

    const now = new Date();
    const discounts: IProductDiscountDetails[] = [];
    const seen = new Set<string>();
    for (const category of folder.categories) {
      for (const id of category.productIds) {
        const product = folder.products.get(id);
        if (!product || seen.has(id) || nonFood.has(id)) continue;
        if (!isFood(regular.get(aldiLinkedId(product.objectID, regular) ?? "") ?? product)) {
          nonFood.add(id);
          continue;
        }
        const discount = mapAldiDiscount(product, regular, category.endDate, now);
        if (!discount) continue;
        seen.add(id);
        discounts.push(discount);
      }
    }
    if (discounts.length === 0) throw new Error("Aldi: no current offers found");
    scraperLogger.debug(`Aldi: ${nonFood.size} folder products skipped as non-food`);

    const expireDate = folderExpireDate(discounts);
    scraperLogger.debug(
      `Total Aldi discounts: ${discounts.length} in ${folder.categories.length} folder categories, folder expires: ${expireDate}`
    );
    return { discounts, expireDate };
  }
}

export default AldiApiClient;
