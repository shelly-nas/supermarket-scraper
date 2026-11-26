import axios, { AxiosInstance } from "axios";
import { scraperLogger } from "../../utils/Logger";
import { parseQuantity, Quantity } from "../../utils/Quantity";
import { normalizeEan } from "../../utils/ProductMatch";

// Hoogvliet's webshop (Next.js on Magento 2) exposes Magento's public GraphQL
// API. categoryList lists the products per category but leaves Hoogvliet's own
// fields empty; products(filter: sku in [...]) fills them: pack size, price
// per kilo/liter/piece and the current promotion.
export const HOOGVLIET_BASE = "https://hoogvliet.nl";
const STORE_CODE = "hoogvliet_nl";
const ROOT_CATEGORY_ID = "2";
const LIST_PAGE_SIZE = 200;
const DETAIL_BATCH_SIZE = 300;
const REQUEST_DELAY_MS = 200;
const MAX_ATTEMPTS = 4;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
// Seasonal and collection categories (offers, theme shops) repeat products
// from the regular shelves; they are read last so a product keeps its regular
// category, and still catch products that are only listed there.
const COLLECTION_CATEGORY = /^(alles-voor-|feestdagen|aanbiedingen|themashops)/;
const MAX_CATEGORIES = 100;

export interface HoogvlietCategory {
  uid: string;
  name: string;
  url_path: string;
}

export interface HoogvlietSubTitle {
  volume: string | null;
  unit: string | null;
  qty_unit: string | null;
  price_per_qty_unit: string | null;
}

export interface HoogvlietPromotion {
  korting_label: string | null;
  valid_from: string | null;
  valid_to: string | null;
}

export interface HoogvlietProduct {
  sku: string;
  name: string;
  url_key: string | null;
  small_image?: { url: string | null } | null;
  price_range: {
    minimum_price: { regular_price: { value: number }; final_price: { value: number } };
  };
  sub_title_attributes: HoogvlietSubTitle | null;
  is_promotion: boolean | null;
  /** "GroupedProduct" is a folder entry bundling several products ("Kitkat, Bros of Smarties"). */
  __typename?: string;
  promotion_meta_data: HoogvlietPromotion | null;
  /** Label texts; "bijsluiter" links to the GDSN label image, whose path holds the GTIN. */
  product_information?: { title: string | null; content: unknown }[] | null;
}

/** A product with the top-level category it was listed under. */
export interface HoogvlietListedProduct extends HoogvlietProduct {
  category: string;
}

class GraphqlError extends Error {}

const DETAIL_FIELDS = `sku name url_key small_image { url }
  price_range { minimum_price { regular_price { value } final_price { value } } }
  sub_title_attributes { volume unit qty_unit price_per_qty_unit }
  is_promotion promotion_meta_data { korting_label valid_from valid_to }
  product_information { title content } __typename`;

const compact = (text: string) =>
  text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

/**
 * Hoogvliet names leave the brand out ("Vol" for Chocomel Vol), but the url
 * key is brand + name + sku ("chocomel-vol-076401000"): the brand is what is
 * left of it before the name. Null when the name already is the whole key.
 */
export function hoogvlietBrand(product: Pick<HoogvlietProduct, "sku" | "name" | "url_key">): string | null {
  if (!product.url_key || !product.name) return null;
  const slug = product.url_key.replace(new RegExp(`-${product.sku}$`), "").replace(/-apos-/g, "'");
  const segments = slug.split("-").filter(Boolean);
  const name = compact(product.name);
  for (let i = 1; i < segments.length; i++) {
    if (compact(segments.slice(i).join("")) === name) {
      return segments
        .slice(0, i)
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join(" ");
    }
  }
  return null;
}

/** The barcode in the GDSN label link (".../08712800188322/528/Media/..."), if any. */
export function hoogvlietEan(product: Pick<HoogvlietProduct, "product_information">): string | null {
  const label = product.product_information?.find((info) => info?.title === "bijsluiter")?.content;
  if (typeof label !== "string") return null;
  return normalizeEan(label.match(/\/(\d{14})\//)?.[1]);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Pack quantity from e.g. { volume: "500", unit: "Gram" }. */
export function hoogvlietQuantity(sub: HoogvlietSubTitle | null): Quantity | null {
  if (!sub?.volume || !sub.unit) return null;
  return parseQuantity(`${sub.volume} ${sub.unit}`);
}

/** Pack size as shown, e.g. "500 gram". */
export function hoogvlietUnitSize(sub: HoogvlietSubTitle | null): string | null {
  if (!sub?.volume || !sub.unit) return null;
  return `${sub.volume} ${sub.unit.toLowerCase()}`;
}

/** Hoogvliet's own unit price, e.g. "€5.18 per kilo" from "Prijs per kilo" / "5.1800". */
export function hoogvlietUnitPrice(sub: HoogvlietSubTitle | null): string | null {
  const value = parseFloat(sub?.price_per_qty_unit ?? "");
  if (!Number.isFinite(value) || value <= 0) return null;
  const per = (sub?.qty_unit ?? "").replace(/^prijs\s+/i, "").trim().toLowerCase() || "per stuk";
  return `€${value.toFixed(2)} ${per}`;
}

export function productUrl(product: HoogvlietProduct): string | null {
  return product.url_key ? `${HOOGVLIET_BASE}/product/${product.url_key}` : null;
}

class HoogvlietGraphql {
  private http: AxiosInstance;

  constructor(http?: AxiosInstance) {
    this.http =
      http ??
      axios.create({
        baseURL: HOOGVLIET_BASE,
        timeout: 60000,
        headers: { "User-Agent": USER_AGENT, "Content-Type": "application/json", Store: STORE_CODE },
      });
  }

  /** One GraphQL call; HTTP 429/5xx and network errors are retried, GraphQL errors are not. */
  private async query<T>(step: string, query: string, variables?: Record<string, unknown>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        const response = await this.http.post("/graphql", { query, variables });
        if (response.data?.errors?.length) {
          throw new GraphqlError(`Hoogvliet ${step}: ${response.data.errors[0].message}`);
        }
        return response.data.data as T;
      } catch (error: any) {
        if (error instanceof GraphqlError) throw error;
        const status = error?.response?.status;
        const retryable = !status || status === 429 || status >= 500;
        if (!retryable || attempt >= MAX_ATTEMPTS) {
          throw new Error(`Hoogvliet ${step}: ${status ? `HTTP ${status}` : error?.message ?? "request failed"}`);
        }
        scraperLogger.warn(`Hoogvliet: ${step} ${status ?? error?.message}, retry ${attempt}/${MAX_ATTEMPTS - 1}`);
        await sleep(REQUEST_DELAY_MS * 2 ** attempt * 5);
      }
    }
  }

  /**
   * Top-level product categories, collection categories last. categoryList
   * stops at 20 results, so the paged categories query is used.
   */
  async categories(): Promise<HoogvlietCategory[]> {
    const data = await this.query<{ categories: { items: HoogvlietCategory[] } | null }>(
      "categories",
      `{ categories(filters: { parent_id: { eq: "${ROOT_CATEGORY_ID}" } }, pageSize: ${MAX_CATEGORIES}) {
         items { uid name url_path } } }`
    );
    const categories = data.categories?.items ?? [];
    const collection = (c: HoogvlietCategory) => COLLECTION_CATEGORY.test(c.url_path ?? "");
    return [...categories.filter((c) => !collection(c)), ...categories.filter(collection)];
  }

  /** SKUs of every product in one category, all pages. */
  async listSkus(category: HoogvlietCategory): Promise<string[]> {
    const skus: string[] = [];
    for (let page = 1, totalPages = 1; page <= totalPages; page++) {
      const data = await this.query<{
        categoryList: { products: { page_info: { total_pages: number }; items: { sku: string }[] } }[];
      }>(
        `category ${category.name} page ${page}`,
        `query($uid: String!, $page: Int!) { categoryList(filters: { category_uid: { eq: $uid } }) {
           products(pageSize: ${LIST_PAGE_SIZE}, currentPage: $page) { page_info { total_pages } items { sku } } } }`,
        { uid: category.uid, page }
      );
      const products = data.categoryList?.[0]?.products;
      totalPages = products?.page_info?.total_pages ?? 0;
      skus.push(...(products?.items ?? []).map((i) => i.sku).filter(Boolean));
      await sleep(REQUEST_DELAY_MS);
    }
    return skus;
  }

  /** Full product details (pack size, unit price, promotion) for a list of SKUs. */
  async details(skus: string[]): Promise<HoogvlietProduct[]> {
    const products: HoogvlietProduct[] = [];
    for (let i = 0; i < skus.length; i += DETAIL_BATCH_SIZE) {
      const batch = skus.slice(i, i + DETAIL_BATCH_SIZE);
      const data = await this.query<{ products: { items: HoogvlietProduct[] } | null }>(
        `details ${i + 1}-${i + batch.length}`,
        `query($skus: [String]) { products(filter: { sku: { in: $skus } }, pageSize: ${DETAIL_BATCH_SIZE}) {
           items { ${DETAIL_FIELDS} } } }`,
        { skus: batch }
      );
      products.push(...(data.products?.items ?? []));
      await sleep(REQUEST_DELAY_MS);
    }
    return products;
  }

  /**
   * Walks every category and delivers its products not seen in an earlier
   * category, with details, one category at a time.
   */
  async forEachCategory(onCategory: (products: HoogvlietListedProduct[]) => Promise<void>): Promise<void> {
    const categories = await this.categories();
    if (categories.length === 0) throw new Error("Hoogvliet: no product categories returned");
    scraperLogger.debug(`Hoogvliet: ${categories.length} categories`);

    const seen = new Set<string>();
    for (const category of categories) {
      const skus = (await this.listSkus(category)).filter((sku) => !seen.has(sku));
      skus.forEach((sku) => seen.add(sku));
      // Promotion groups (GroupedProduct) only exist in the offers category;
      // the products they bundle carry the promotion themselves.
      const products = (await this.details(skus)).filter((p) => p.__typename !== "GroupedProduct");
      scraperLogger.debug(`Hoogvliet: '${category.name}': ${products.length} new products`);
      if (products.length > 0) await onCategory(products.map((p) => ({ ...p, category: category.name })));
    }
  }
}

export default HoogvlietGraphql;
