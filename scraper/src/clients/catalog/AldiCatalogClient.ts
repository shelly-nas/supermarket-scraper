import { AxiosInstance } from "axios";
import CatalogClient from "./CatalogClient";
import { ICatalogProduct } from "../../interfaces/ICatalogProduct";
import { unitPriceText } from "../../utils/Quantity";
import { scraperLogger } from "../../utils/Logger";
import AldiAlgolia, {
  AldiProduct,
  aldiCategory,
  aldiImageUrl,
  aldiName,
  aldiProductUrl,
  aldiQuantity,
  isAldiOffer,
} from "../aldi/AldiAlgolia";
import { aldiFoodFilter } from "../aldi/AldiFood";

/** Maps one regular Aldi product to the catalog shape; null for offers and unusable ones. */
export function mapAldiProduct(product: AldiProduct): ICatalogProduct | null {
  const name = aldiName(product);
  const price = product.currentPrice?.priceValue;
  if (!name || isAldiOffer(product) || product.isAvailable === false) return null;
  if (typeof price !== "number" || price <= 0) return null;

  const quantity = aldiQuantity(product);
  return {
    externalId: product.objectID,
    name,
    brand: product.brandName?.trim() || null,
    category: aldiCategory(product),
    unitSize: product.salesUnit?.trim() || null,
    quantity,
    price,
    priceSource: "supermarket",
    unitPrice: unitPriceText(price, quantity),
    imageUrl: aldiImageUrl(product),
    productUrl: aldiProductUrl(product),
  };
}

class AldiCatalogClient extends CatalogClient {
  readonly supermarket = "Aldi";

  private api: AldiAlgolia;

  constructor(http?: AxiosInstance) {
    super();
    this.api = new AldiAlgolia(http);
  }

  async fetchCatalog(onPage: (products: ICatalogProduct[]) => Promise<void>): Promise<void> {
    const regular = (await this.api.all()).filter((p) => !isAldiOffer(p));
    // Only food and drink is kept from Aldi.
    const isFood = aldiFoodFilter(regular);
    const food = regular.filter(isFood);
    scraperLogger.debug(`Aldi catalog: ${regular.length - food.length} of ${regular.length} products skipped as non-food`);
    const products = food.map(mapAldiProduct).filter((p): p is ICatalogProduct => p !== null);
    if (products.length === 0) throw new Error("Aldi: no catalog products with a price");
    scraperLogger.info(`Aldi catalog: ${products.length} products with a price`);
    // Delivered in chunks like the paged catalogs, so each upsert stays small.
    for (let i = 0; i < products.length; i += 500) await onPage(products.slice(i, i + 500));
  }
}

export default AldiCatalogClient;
