import { AxiosInstance } from "axios";
import CatalogClient, { CatalogOffers } from "./CatalogClient";
import { hoogvlietDiscounts, hoogvlietOffers } from "../HoogvlietApiClient";
import { ICatalogProduct } from "../../interfaces/ICatalogProduct";
import HoogvlietGraphql, {
  HoogvlietListedProduct,
  hoogvlietBrand,
  hoogvlietEan,
  hoogvlietQuantity,
  hoogvlietUnitPrice,
  hoogvlietUnitSize,
  productUrl,
} from "../hoogvliet/HoogvlietGraphql";

/** Maps one Hoogvliet product to the catalog shape; null when it has no usable price. */
export function mapHoogvlietProduct(product: HoogvlietListedProduct): ICatalogProduct | null {
  const price = product.price_range?.minimum_price?.regular_price?.value;
  if (typeof price !== "number" || price <= 0 || !product.name || !product.sku) return null;
  const sub = product.sub_title_attributes;

  return {
    externalId: product.sku,
    name: product.name.trim(),
    brand: hoogvlietBrand(product),
    category: product.category,
    unitSize: hoogvlietUnitSize(sub),
    quantity: hoogvlietQuantity(sub),
    price,
    priceSource: "supermarket",
    unitPrice: hoogvlietUnitPrice(sub),
    imageUrl: product.small_image?.url ?? null,
    productUrl: productUrl(product),
    ean: hoogvlietEan(product),
  };
}

class HoogvlietCatalogClient extends CatalogClient {
  readonly supermarket = "Hoogvliet";

  private api: HoogvlietGraphql;

  constructor(http?: AxiosInstance) {
    super();
    this.api = new HoogvlietGraphql(http);
  }

  /** Discounts seen by the last fetchCatalog. */
  private discounts: IProductDiscountDetails[] = [];

  async fetchCatalog(onPage: (products: ICatalogProduct[]) => Promise<void>): Promise<void> {
    this.discounts = [];
    await this.api.forEachCategory(async (products) => {
      this.discounts.push(...hoogvlietDiscounts(products));
      const mapped = products
        .map(mapHoogvlietProduct)
        .filter((p): p is ICatalogProduct => p !== null);
      if (mapped.length > 0) await onPage(mapped);
    });
  }

  catalogOffers(): CatalogOffers {
    return hoogvlietOffers(this.discounts);
  }
}

export default HoogvlietCatalogClient;
