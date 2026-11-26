import axios, { AxiosInstance } from "axios";
import moment from "moment";
import ApiClient from "./ApiClient";
import { scraperLogger } from "../utils/Logger";
import { folderExpireDate } from "../utils/Promotion";
import { parseQuantity, Quantity } from "../utils/Quantity";
import {
  decodeEntities,
  extractGridData,
  extractUnitSize,
  LidlGridData,
  lidlArticleNumbers,
  lidlCategory,
} from "./catalog/LidlCatalogClient";

const LIDL_BASE = "https://www.lidl.nl";
// Stable URL — redirects to the current week's offers page
const LIDL_URL = `${LIDL_BASE}/aanbiedingen`;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";

type LidlOfferPrice = { price?: number; oldPrice?: number; packaging?: { text?: string } };

/** An offer tile: the catalog tile JSON plus the offer period and pack size. */
export type LidlOfferTile = Omit<LidlGridData, "price"> & {
  title?: string;
  /** End of the offer in the shop, unix seconds (last second of the day). */
  storeEndDate?: number;
  price?: LidlOfferPrice;
  /** Lidl Plus offers: `price` is then empty and the offer price is here. */
  lidlPlus?: { price?: LidlOfferPrice; lidlPlusText?: string }[];
  /** Per region; a Lidl Plus offer keeps its regular (old) price here. */
  regionsPrices?: Record<string, { currentPrice?: LidlOfferPrice; currentLidlPlusPrice?: { price?: LidlOfferPrice } }>;
};

/**
 * The offer's price, regular price, pack size and label. A Lidl Plus offer
 * has no plain price; its price comes from `lidlPlus`, its regular price from
 * the region prices.
 */
export function lidlOfferPrice(tile: LidlOfferTile): {
  price: number | null;
  oldPrice: number | null;
  packaging: string | null;
  label: string;
} {
  const plus = tile.lidlPlus?.find((p) => typeof p.price?.price === "number");
  const region = Object.values(tile.regionsPrices ?? {})[0];
  const regionPrice = region?.currentPrice ?? region?.currentLidlPlusPrice?.price;
  const usePlus = typeof tile.price?.price !== "number" && plus !== undefined;
  const main = usePlus ? plus.price : tile.price;
  const number = (value: unknown) => (typeof value === "number" && value > 0 ? value : null);
  return {
    price: number(main?.price),
    oldPrice: number(main?.oldPrice) ?? number(regionPrice?.oldPrice),
    packaging: main?.packaging?.text ?? regionPrice?.packaging?.text ?? null,
    label: usePlus ? plus.lidlPlusText?.trim() || "met Lidl Plus" : "",
  };
}

/**
 * Pack quantity of an offer: the size Lidl prints under the price ("400 g",
 * "6x500 ml"), else from the key facts ("32 rollen") or the title.
 */
export function lidlOfferQuantity(tile: LidlOfferTile): Quantity | null {
  const description = decodeEntities((tile.keyfacts?.description ?? "").replace(/<[^>]+>/g, " "));
  return (
    parseQuantity(lidlOfferPrice(tile).packaging) ??
    parseQuantity(extractUnitSize(tile.keyfacts?.description)) ??
    parseQuantity(tile.fullTitle) ??
    parseQuantity(description)
  );
}

/**
 * Maps one offer tile to a discount; null without a name or price. An offer
 * has its own article number (externalId); the permanent one (nat/ians)
 * links it to the catalog row, which also gets the regular price shown next
 * to the offer. A tile without an end date gets an empty expireDate, filled
 * in with the folder's end date by the caller.
 */
export function mapLidlOffer(tile: LidlOfferTile): IProductDiscountDetails | null {
  const name = (tile.fullTitle ?? tile.title)?.trim();
  const { price, oldPrice, label } = lidlOfferPrice(tile);
  if (!name || price === null) return null;

  const externalId = tile.erpNumber ?? (tile.productId ? String(tile.productId) : null);
  const regularPrice = oldPrice !== null && oldPrice > price ? oldPrice : null;
  return {
    name,
    originalPrice: regularPrice ?? 0,
    regularPrice,
    articleNumbers: lidlArticleNumbers(tile),
    discountPrice: price,
    unitPrice: null,
    specialDiscount: label,
    productUrl: tile.canonicalUrl ? `${LIDL_BASE}${tile.canonicalUrl}` : LIDL_URL,
    category: lidlCategory(tile as LidlGridData),
    supermarket: "Lidl",
    expireDate: tile.storeEndDate ? moment.unix(tile.storeEndDate).toISOString(true) : "",
    externalId,
    quantity: lidlOfferQuantity(tile),
    imageUrl: tile.image ?? null,
    brand: tile.brand?.showBrand && tile.brand.name ? tile.brand.name.trim() : null,
  };
}

/**
 * Lidl's weekly offers from the server-rendered offers page: every tile
 * carries the same `data-grid-data` JSON as the assortment pages, with the
 * article number, offer and regular price, pack size and offer period. No
 * browser needed.
 */
class LidlApiClient extends ApiClient {
  public name = "Lidl";

  private http: AxiosInstance;

  constructor(http?: AxiosInstance) {
    super();
    this.http =
      http ??
      axios.create({
        timeout: 60000,
        headers: { "User-Agent": USER_AGENT, "Accept-Language": "nl-NL,nl;q=0.9" },
      });
    scraperLogger.debug(`Created a '${this.name}' API Client instance.`);
  }

  public async fetchDiscounts(): Promise<{
    discounts: IProductDiscountDetails[];
    expireDate: string;
  }> {
    scraperLogger.debug(`Fetching Lidl discounts from ${LIDL_URL}`);
    const response = await this.http.get<string>(LIDL_URL, { responseType: "text" });
    const tiles = extractGridData(response.data) as LidlOfferTile[];
    if (tiles.length === 0) {
      throw new Error("Lidl: no offer tiles found on the offers page");
    }

    const discounts: IProductDiscountDetails[] = [];
    const seen = new Set<string>();
    for (const tile of tiles) {
      const discount = mapLidlOffer(tile);
      if (!discount) continue;
      // A product listed twice (e.g. in two themes) is kept once.
      const key = discount.externalId ?? discount.name;
      if (seen.has(key)) continue;
      seen.add(key);
      discounts.push(discount);
    }

    // Some offers run for weeks; the folder's end date drives the next run.
    const expireDate = folderExpireDate(discounts.filter((d) => d.expireDate));
    for (const discount of discounts) {
      if (!discount.expireDate) discount.expireDate = expireDate;
    }

    scraperLogger.debug(
      `Total Lidl discounts: ${discounts.length} of ${tiles.length} tiles, expire: ${expireDate}`
    );
    return { discounts, expireDate };
  }
}

export default LidlApiClient;
