import { AxiosInstance } from "axios";
import ApiClient from "./ApiClient";
import { scraperLogger } from "../utils/Logger";
import { folderExpireDate, promotionPrice } from "../utils/Promotion";
import { unitPriceText } from "../utils/Quantity";
import DirkGraphql, {
  DirkOffer,
  DirkProduct,
  dirkImageUrl,
  dirkProductUrl,
  dirkQuantity,
} from "./dirk/DirkGraphql";

const DIRK_OFFERS_URL = "https://www.dirk.nl/aanbiedingen";

const offerLabel = (offer: DirkOffer) =>
  [offer.subText, offer.promotionText].filter(Boolean).join(" ").trim();

/**
 * One discount per product an offer covers ("Hak groente of appelmoes" covers
 * 29 jars), linked by Dirk's product id. The offer price is per item; a
 * multi-buy label is worked out per item from the product's regular price.
 */
export function mapDirkOfferProduct(
  offer: DirkOffer,
  product: DirkProduct,
  category: string
): IProductDiscountDetails | null {
  const name = product.productInformation?.headerText?.trim();
  if (!name) return null;
  const regular = product.normalPrice && product.normalPrice > 0 ? product.normalPrice : offer.normalPrice;
  const offered = product.offerPrice && product.offerPrice > 0 ? product.offerPrice : offer.offerPrice;
  if (!offered || offered <= 0) return null;

  const label = offerLabel(offer);
  const quantity = dirkQuantity(product);
  const discountPrice = regular > 0 ? promotionPrice(label, regular, offered) ?? offered : offered;
  return {
    name,
    originalPrice: regular > 0 ? regular : 0,
    discountPrice,
    unitPrice: unitPriceText(discountPrice, quantity),
    quantity,
    specialDiscount: label,
    category: product.productInformation?.department?.trim() || category,
    supermarket: "Dirk",
    expireDate: offer.endDate,
    productUrl: dirkProductUrl(product),
    externalId: String(product.productId),
    imageUrl: dirkImageUrl(product),
    brand: product.productInformation?.brand?.trim() || null,
  };
}

/** An offer none of whose products could be looked up, as one discount by name. */
export function mapDirkOffer(offer: DirkOffer, category: string): IProductDiscountDetails {
  return {
    name: [offer.headerText, offer.packaging].filter(Boolean).join(" ").trim(),
    originalPrice: offer.normalPrice,
    discountPrice: offer.offerPrice,
    unitPrice: null,
    specialDiscount: offerLabel(offer),
    productUrl: DIRK_OFFERS_URL,
    category,
    supermarket: "Dirk",
    expireDate: offer.endDate,
  };
}

class DirkApiClient extends ApiClient {
  public name = "Dirk";

  private api: DirkGraphql;

  constructor(http?: AxiosInstance) {
    super();
    this.api = new DirkGraphql(http);
    scraperLogger.debug(`Created a '${this.name}' API Client instance.`);
  }

  public async fetchDiscounts(): Promise<{
    discounts: IProductDiscountDetails[];
    expireDate: string;
  }> {
    scraperLogger.debug(`Fetching Dirk discounts via GraphQL API`);

    const departments = await this.api.departments();
    scraperLogger.debug(`Found ${departments.length} departments`);

    const offers: { offer: DirkOffer; category: string }[] = [];
    for (const dept of departments) {
      const found = await this.api.offers(dept.id);
      if (found.length === 0) continue;
      scraperLogger.debug(`Department '${dept.description}': ${found.length} offers`);
      offers.push(...found.map((offer) => ({ offer, category: dept.description })));
    }

    const productIds = [...new Set(offers.flatMap(({ offer }) => offer.productIds ?? []))];
    const products = new Map((await this.api.products(productIds)).map((p) => [p.productId, p]));

    const discounts: IProductDiscountDetails[] = [];
    const seen = new Set<string>();
    for (const { offer, category } of offers) {
      const covered = (offer.productIds ?? [])
        .map((id) => products.get(id))
        .map((product) => (product ? mapDirkOfferProduct(offer, product, category) : null))
        .filter((d): d is IProductDiscountDetails => d !== null);

      if (covered.length === 0) {
        discounts.push(mapDirkOffer(offer, category));
        continue;
      }
      // A product in two offers (e.g. listed in two departments) is kept once.
      for (const discount of covered) {
        if (seen.has(discount.externalId!)) continue;
        seen.add(discount.externalId!);
        discounts.push(discount);
      }
    }

    const expireDate = folderExpireDate(discounts);
    scraperLogger.debug(
      `Total Dirk discounts: ${discounts.length} for ${offers.length} offers, folder expires: ${expireDate}`
    );
    return { discounts, expireDate };
  }
}

export default DirkApiClient;
