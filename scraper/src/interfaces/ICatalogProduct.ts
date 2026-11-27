import { Quantity } from "../utils/Quantity";

/** One product from a supermarket's full assortment, at its regular price. */
export interface ICatalogProduct {
  /** The supermarket's own product id (stable across runs). */
  externalId: string;
  name: string;
  brand: string | null;
  category: string;
  /** Pack size as shown by the supermarket, e.g. "1 l" or "500 g". */
  unitSize: string | null;
  /** Pack quantity in kg, l or stuk; when left out it is read from unitSize. */
  quantity?: Quantity | null;
  /** Regular shelf price, without any promotion; null when the supermarket does not publish it. */
  price: number | null;
  /** Where the price comes from: "supermarket" or an outside dataset such as "checkjebon". */
  priceSource: string | null;
  /** Price per unit as shown by the supermarket, e.g. "€1.09 per liter". */
  unitPrice: string | null;
  imageUrl: string | null;
  productUrl: string | null;
  /** Barcode (EAN), when the supermarket publishes it; checked with utils/ProductMatch.normalizeEan. */
  ean?: string | null;
  /** Permanent article number when it differs from externalId (Lidl `nat`); offers are linked by it. */
  articleNumber?: string | null;
  /**
   * From an outside dataset (checkjebon for Lidl) that may only add products:
   * a row that already exists by external id, article number or name is never
   * changed. A row the dataset added itself is kept in the catalog and gets
   * its price refreshed (PostgresCatalogController).
   */
  addOnly?: boolean;
}
