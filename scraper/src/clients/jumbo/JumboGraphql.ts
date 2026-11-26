import axios, { AxiosInstance } from "axios";
import { scraperLogger } from "../../utils/Logger";
import { parseQuantity, Quantity, unitPriceText } from "../../utils/Quantity";

export { unitPriceText };

// jumbo.com's own GraphQL API (the one its search pages use). It needs the
// web client's Apollo headers; introspection is off, but plain queries work.
// searchProducts with searchType "category" and searchTerms "producten" lists
// the whole assortment, at most 200 per page, paged with offSet.
export const JUMBO_BASE = "https://www.jumbo.com";
const CLIENT_NAME = "JUMBO_WEB-search";
const CLIENT_VERSION = "master-v39.2.0-web";
const PAGE_SIZE = 200;
const REQUEST_DELAY_MS = 300;
const MAX_ATTEMPTS = 4;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";

export interface JumboDay {
  date: number;
  monthShort: string;
}

export interface JumboPromotion {
  id: string;
  tags: { text: string }[] | null;
  start: JumboDay | null;
  end: JumboDay | null;
}

export interface JumboProduct {
  sku: string;
  title: string;
  brand: string | null;
  category: string | null;
  subtitle: string | null;
  image: string | null;
  link: string | null;
  inAssortment: boolean | null;
  /** Barcode; empty for some products (loose fruit, Jumbo's own fresh products). */
  ean?: string | null;
  /** Prices in cents; pricePerUnit follows the current (promotion) price. */
  price: {
    price: number;
    promoPrice: number | null;
    pricePerUnit: { price: number; unit: string | null } | null;
  } | null;
  promotions: JumboPromotion[] | null;
}

const PRODUCT_FIELDS = `sku title brand category: rootCategory subtitle: packSizeDisplay image link inAssortment ean
  price { price promoPrice pricePerUnit { price unit } }
  promotions { id tags { text } start { date monthShort } end { date monthShort } }`;

const SEARCH_QUERY = `query JumboCatalog($input: ProductSearchInput!) {
  searchProducts(input: $input) { count products { ${PRODUCT_FIELDS} } } }`;

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mrt: 2, apr: 3, mei: 4, jun: 5, jul: 6, aug: 7, sep: 8, okt: 9, nov: 10, dec: 11,
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Jumbo's unit words ("kg", "l", "pieces", "wb" = wasbeurt) as quantity units. */
function unitOf(unit: string | null | undefined): Quantity["unit"] | null {
  switch ((unit ?? "").toLowerCase()) {
    case "kg":
      return "kg";
    case "l":
      return "l";
    case "pieces":
    case "wb":
      return "stuk";
    default:
      return null;
  }
}

/**
 * Pack quantity: from the pack size ("6 x 1 L"), else the title ("Komkommer
 * 500 g"), else worked out from the current price and Jumbo's price per unit.
 */
export function jumboQuantity(product: JumboProduct): Quantity | null {
  const fromText = parseQuantity(product.subtitle) ?? parseQuantity(product.title);
  if (fromText) return fromText;

  const perUnit = product.price?.pricePerUnit;
  const unit = unitOf(perUnit?.unit);
  const current = product.price?.promoPrice ?? product.price?.price;
  if (!unit || !perUnit?.price || !current) return null;
  const value = current / perUnit.price;
  // Prices per unit are rounded to cents, so pieces are rounded to whole ones.
  return unit === "stuk"
    ? { value: Math.max(1, Math.round(value)), unit }
    : { value: Math.round(value * 1000) / 1000, unit };
}

/**
 * End of day of a promotion day without year ({ date: 20, monthShort: "okt" }):
 * the next such day from `now` on, allowing for a promotion that ends today.
 */
export function promotionDay(day: JumboDay | null, now: Date = new Date()): Date | null {
  const month = day ? MONTHS[day.monthShort?.toLowerCase()] : undefined;
  if (!day || month === undefined || !day.date) return null;
  const candidate = new Date(now.getFullYear(), month, day.date, 23, 59, 59);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (candidate < startOfToday) candidate.setFullYear(candidate.getFullYear() + 1);
  return candidate;
}

export function jumboProductUrl(product: JumboProduct): string | null {
  return product.link ? `${JUMBO_BASE}${product.link}` : null;
}

class GraphqlError extends Error {}

class JumboGraphql {
  private http: AxiosInstance;

  constructor(http?: AxiosInstance) {
    this.http =
      http ??
      axios.create({
        baseURL: JUMBO_BASE,
        timeout: 60000,
        headers: {
          "User-Agent": USER_AGENT,
          "Content-Type": "application/json",
          "apollographql-client-name": CLIENT_NAME,
          "apollographql-client-version": CLIENT_VERSION,
          "x-source": CLIENT_NAME,
        },
      });
  }

  /**
   * One page. A product with a missing required field (e.g. no title) nulls
   * the whole response; the page is then split until that product is isolated
   * and skipped.
   */
  private async fetchRange(offSet: number, limit: number): Promise<{ count: number; products: JumboProduct[] }> {
    const data = await this.query(offSet, limit);
    if (data) return data;
    if (limit === 1) {
      scraperLogger.warn(`Jumbo: skipped an unreadable product at position ${offSet}`);
      return { count: -1, products: [] };
    }
    const half = Math.ceil(limit / 2);
    const first = await this.fetchRange(offSet, half);
    const second = await this.fetchRange(offSet + half, limit - half);
    return { count: Math.max(first.count, second.count), products: [...first.products, ...second.products] };
  }

  /** Returns null when Jumbo answered with data: null (a broken product in the range). */
  private async query(offSet: number, limit: number): Promise<{ count: number; products: JumboProduct[] } | null> {
    const step = `products ${offSet + 1}-${offSet + limit}`;
    for (let attempt = 1; ; attempt++) {
      try {
        const response = await this.http.post("/api/graphql", {
          query: SEARCH_QUERY,
          variables: { input: { searchType: "category", searchTerms: "producten", offSet, limit } },
        });
        if (response.data?.errors?.length) {
          throw new GraphqlError(`Jumbo ${step}: ${response.data.errors[0].message}`);
        }
        const result = response.data?.data?.searchProducts;
        if (!result) return null;
        return { count: result.count ?? 0, products: result.products ?? [] };
      } catch (error: any) {
        if (error instanceof GraphqlError) throw error;
        const status = error?.response?.status;
        const retryable = !status || status === 429 || status >= 500;
        if (!retryable || attempt >= MAX_ATTEMPTS) {
          throw new Error(`Jumbo ${step}: ${status ? `HTTP ${status}` : error?.message ?? "request failed"}`);
        }
        scraperLogger.warn(`Jumbo: ${step} ${status ?? error?.message}, retry ${attempt}/${MAX_ATTEMPTS - 1}`);
        await sleep(REQUEST_DELAY_MS * 2 ** attempt * 5);
      }
    }
  }

  /** Walks the whole assortment page by page; each product is delivered once. */
  async forEachPage(onPage: (products: JumboProduct[]) => Promise<void>): Promise<void> {
    const seen = new Set<string>();
    let total = Infinity;
    for (let offSet = 0; offSet < total; offSet += PAGE_SIZE) {
      const page = await this.fetchRange(offSet, PAGE_SIZE);
      if (page.count >= 0) total = page.count;
      if (offSet === 0) {
        if (total === 0 || page.products.length === 0) throw new Error("Jumbo: the assortment returned no products");
        scraperLogger.debug(`Jumbo: ${total} products in the assortment`);
      }
      const fresh = page.products.filter((p) => p?.sku && !seen.has(p.sku));
      fresh.forEach((p) => seen.add(p.sku));
      if (fresh.length > 0) await onPage(fresh);
      await sleep(REQUEST_DELAY_MS);
    }
    scraperLogger.info(`Jumbo: ${seen.size} products read`);
  }
}

export default JumboGraphql;
