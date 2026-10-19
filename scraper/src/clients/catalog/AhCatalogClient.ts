import { AxiosInstance } from "axios";
import CatalogClient from "./CatalogClient";
import { ICatalogProduct } from "../../interfaces/ICatalogProduct";
import { scraperLogger } from "../../utils/Logger";
import AhMobileApi, { AhProduct, ahImage, ahProductUrl, REQUEST_DELAY_MS, sleep } from "../ah/AhMobileApi";

export { describeError } from "../ah/AhMobileApi";

// Products are listed per top-level category (taxonomy) of the AH mobile API.
const PAGE_SIZE = 200;

/** Maps one AH product to the catalog shape; null when it has no usable price. */
export function mapAhProduct(product: AhProduct, category: string): ICatalogProduct | null {
  // During a bonus, currentPrice is the offer price and priceBeforeBonus the
  // regular one; otherwise only one of them may be present.
  const price = product.priceBeforeBonus ?? product.currentPrice;
  if (price === undefined || price === null || !product.title) return null;

  return {
    externalId: String(product.webshopId),
    name: product.title.trim(),
    brand: product.brand?.trim() || null,
    category: product.mainCategory?.trim() || category,
    unitSize: product.salesUnitSize?.trim() || null,
    price,
    priceSource: "supermarket",
    unitPrice: product.unitPriceDescription?.trim() || null,
    imageUrl: ahImage(product),
    productUrl: ahProductUrl(product),
  };
}

class AhCatalogClient extends CatalogClient {
  readonly supermarket = "Albert Heijn";

  private api: AhMobileApi;

  constructor(http?: AxiosInstance) {
    super();
    this.api = new AhMobileApi(http);
  }

  async fetchCatalog(onPage: (products: ICatalogProduct[]) => Promise<void>): Promise<void> {
    await this.api.authenticate();
    const categories = await this.api.categories();
    if (categories.length === 0) throw new Error("AH: no product categories returned");
    scraperLogger.info(`AH catalog: ${categories.length} categories`);

    for (const category of categories) {
      let page = 0;
      let totalPages = 1;
      while (page < totalPages) {
        const data = await this.api.searchPage(category.id, page, PAGE_SIZE);
        totalPages = data.page?.totalPages ?? 0;
        const products = (data.products ?? [])
          .map((p) => mapAhProduct(p, category.name))
          .filter((p): p is ICatalogProduct => p !== null);
        scraperLogger.info(
          `AH catalog: '${category.name}' page ${page + 1}/${Math.max(totalPages, 1)}: ${products.length} products`
        );
        if (products.length > 0) await onPage(products);
        page++;
        await sleep(REQUEST_DELAY_MS);
      }
    }
  }
}

export default AhCatalogClient;
