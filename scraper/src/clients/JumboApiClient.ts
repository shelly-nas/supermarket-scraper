import { AxiosInstance } from "axios";
import moment from "moment";
import ApiClient from "./ApiClient";
import { scraperLogger } from "../utils/Logger";
import { folderExpireDate, promotionPrice } from "../utils/Promotion";
import JumboGraphql, {
  JumboProduct,
  jumboProductUrl,
  jumboQuantity,
  promotionDay,
  unitPriceText,
} from "./jumbo/JumboGraphql";

/** The end date of each promotion that has one, as ISO strings. */
function promotionEnds(products: JumboProduct[], now: Date): string[] {
  const ends: string[] = [];
  for (const product of products) {
    for (const promotion of product.promotions ?? []) {
      const end = promotionDay(promotion.end, now);
      if (end) ends.push(moment(end).toISOString(true));
    }
  }
  return ends;
}

export const hasJumboPromotion = (product: JumboProduct) => (product.promotions ?? []).length > 0;

/**
 * The offers among promoted Jumbo products, with the folder end as run
 * expiry. Shared by the offers run and the catalog run, which sees the same
 * products.
 */
export function jumboOffers(
  onPromotion: JumboProduct[],
  now: Date = new Date()
): { discounts: IProductDiscountDetails[]; expireDate: string } {
  const folderEnd = folderExpireDate(promotionEnds(onPromotion, now).map((expireDate) => ({ expireDate })));
  const discounts = onPromotion
    .map((product) => mapJumboDiscount(product, folderEnd, now))
    .filter((d): d is IProductDiscountDetails => d !== null);
  scraperLogger.info(
    `Total Jumbo discounts: ${discounts.length} of ${onPromotion.length} promoted products, folder expires: ${folderEnd}`
  );
  return { discounts, expireDate: folderEnd };
}

/**
 * Maps a product with a current price promotion to a discount; null when it
 * has none. Labels that are not about the price ("Gratis bezorging", "€2,00
 * bezorgkorting") are skipped. Promotions without dates (standing multi-buy
 * offers) get the end of the weekly folder.
 */
export function mapJumboDiscount(
  product: JumboProduct,
  folderEnd: string,
  now: Date = new Date()
): IProductDiscountDetails | null {
  const cents = product.price?.price;
  if (typeof cents !== "number" || cents <= 0 || !product.title) return null;
  const regular = cents / 100;
  const promoPrice = typeof product.price?.promoPrice === "number" ? product.price.promoPrice / 100 : null;

  for (const promotion of product.promotions ?? []) {
    const label = (promotion.tags ?? []).map((t) => t.text?.replace(/​/g, "").trim()).filter(Boolean).join(" | ");
    const discountPrice = promotionPrice(label, regular, promoPrice);
    if (discountPrice === null) continue;

    const end = promotionDay(promotion.end, now);
    const expireDate = end ? moment(end).toISOString(true) : folderEnd;
    if (new Date(expireDate) < now) continue;

    return {
      name: product.title.trim(),
      originalPrice: regular,
      discountPrice,
      unitPrice: unitPriceText(discountPrice, jumboQuantity(product)),
      quantity: jumboQuantity(product),
      specialDiscount: label,
      category: product.category?.trim() || "Overig",
      supermarket: "Jumbo",
      expireDate,
      productUrl: jumboProductUrl(product),
      externalId: product.sku,
      imageUrl: product.image ?? null,
      brand: product.brand?.trim() || null,
      ean: product.ean ?? null,
    };
  }
  return null;
}

class JumboApiClient extends ApiClient {
  public name = "Jumbo";

  private api: JumboGraphql;

  constructor(http?: AxiosInstance) {
    super();
    this.api = new JumboGraphql(http);
    scraperLogger.debug(`Created a '${this.name}' API Client instance.`);
  }

  public async fetchDiscounts(): Promise<{
    discounts: IProductDiscountDetails[];
    expireDate: string;
  }> {
    scraperLogger.info("Fetching Jumbo discounts via the jumbo.com GraphQL API");

    const onPromotion: JumboProduct[] = [];
    await this.api.forEachPage(async (products) => {
      onPromotion.push(...products.filter(hasJumboPromotion));
    });
    return jumboOffers(onPromotion);
  }
}

export default JumboApiClient;
