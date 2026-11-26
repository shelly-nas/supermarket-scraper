import { ICatalogProduct } from "../../interfaces/ICatalogProduct";

/** The offers a catalog run saw, in the shape of an offers run. */
export interface CatalogOffers {
  discounts: IProductDiscountDetails[];
  expireDate: string;
}

/**
 * Fetches a supermarket's full assortment at regular prices.
 *
 * Results are delivered page by page through [onPage] so a catalog of tens of
 * thousands of products never has to be held in memory at once. Implementations
 * may deliver the same product twice (e.g. listed in two categories); the
 * storage layer deduplicates on externalId.
 */
abstract class CatalogClient {
  abstract readonly supermarket: string;

  abstract fetchCatalog(
    onPage: (products: ICatalogProduct[]) => Promise<void>
  ): Promise<void>;

  /**
   * The offers the last fetchCatalog saw, for a catalog whose source also
   * carries the promotions (AH, Jumbo, Hoogvliet, PLUS), so one run fetches
   * both. Null when the offers come from elsewhere: the run then uses the
   * supermarket's offers client.
   */
  catalogOffers(): CatalogOffers | null {
    return null;
  }
}

export default CatalogClient;
