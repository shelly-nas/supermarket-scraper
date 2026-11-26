import axios, { AxiosInstance } from "axios";
import { scraperLogger } from "../../utils/Logger";
import { parseQuantity, Quantity } from "../../utils/Quantity";

// Dirk's web gateway (Hot Chocolate GraphQL, the one dirk.nl itself uses).
// Introspection is off, but the site's own queries work without a login:
// listDepartments lists departments with their web groups, and
// listWebGroupProducts returns every product of a web group with its price at
// one store. Products the store does not sell come back as null. listOffers
// lists the folder offers per department with the products they cover.
export const DIRK_BASE = "https://www.dirk.nl";
const GRAPHQL_URL = "https://web-gateway.dirk.nl/graphql";
const IMAGE_BASE = "https://web-fileserver.dirk.nl/";
const IMAGE_WIDTH = 400;
// dirk.nl's default store; prices are the same in every store.
export const DIRK_STORE_ID = 66;
const REQUEST_DELAY_MS = 300;
const MAX_ATTEMPTS = 4;
const PRODUCTS_PER_REQUEST = 100;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";

export interface DirkWebGroup {
  webGroupId: number;
  description: string;
}

export interface DirkDepartment {
  id: number;
  description: string;
  webGroups: DirkWebGroup[] | null;
}

/** A product at one store. offerPrice is 0 without an offer. */
export interface DirkProduct {
  productId: number;
  normalPrice: number | null;
  offerPrice: number | null;
  startDate: string | null;
  endDate: string | null;
  productOffer: { textPriceSign: string | null; startDate: string | null; endDate: string | null } | null;
  productInformation: {
    headerText: string | null;
    subText: string | null;
    packaging: string | null;
    image: string | null;
    department: string | null;
    webgroup: string | null;
    brand: string | null;
  } | null;
}

export interface DirkOffer {
  offerId: number;
  headerText: string;
  subText: string | null;
  promotionText: string | null;
  normalPrice: number;
  offerPrice: number;
  startDate: string;
  endDate: string;
  type: string;
  packaging: string | null;
  productIds: number[] | null;
}

const PRODUCT_FIELDS = `productId normalPrice offerPrice startDate endDate
  productOffer { textPriceSign startDate endDate }
  productInformation { headerText subText packaging image department webgroup brand }`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const slug = (text: string | null | undefined) =>
  (text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** The product page, e.g. /boodschappen/aardappelen-groente-fruit/groente/komkommer/4463. */
export function dirkProductUrl(product: DirkProduct): string {
  const info = product.productInformation;
  const parts = [slug(info?.department), slug(info?.webgroup), slug(info?.headerText)].map((p) => p || "product");
  return `${DIRK_BASE}/boodschappen/${parts.join("/")}/${product.productId}`;
}

/** The product image at 400 px wide: the file server scales on request (the original is ~1 MB). */
export function dirkImageUrl(product: DirkProduct): string | null {
  const image = product.productInformation?.image;
  return image ? `${IMAGE_BASE}${image}?width=${IMAGE_WIDTH}` : null;
}

/** Pack quantity from the packaging ("340 g", "6 x 330 ml"), else the title. */
export function dirkQuantity(product: DirkProduct): Quantity | null {
  const info = product.productInformation;
  return parseQuantity(info?.packaging) ?? parseQuantity(info?.headerText);
}

class GraphqlError extends Error {}

class DirkGraphql {
  private http: AxiosInstance;

  constructor(http?: AxiosInstance) {
    this.http =
      http ??
      axios.create({
        timeout: 60000,
        headers: {
          "Content-Type": "application/json",
          "User-Agent": USER_AGENT,
          Origin: DIRK_BASE,
          Referer: `${DIRK_BASE}/`,
        },
      });
  }

  private async query<T>(step: string, query: string): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        const response = await this.http.post(GRAPHQL_URL, { query });
        if (response.data?.errors?.length) {
          throw new GraphqlError(`Dirk ${step}: ${response.data.errors[0].message}`);
        }
        if (!response.data?.data) throw new GraphqlError(`Dirk ${step}: empty response`);
        return response.data.data as T;
      } catch (error: any) {
        if (error instanceof GraphqlError) throw error;
        const status = error?.response?.status;
        const retryable = !status || status === 429 || status >= 500;
        if (!retryable || attempt >= MAX_ATTEMPTS) {
          throw new Error(`Dirk ${step}: ${status ? `HTTP ${status}` : error?.message ?? "request failed"}`);
        }
        scraperLogger.warn(`Dirk: ${step} ${status ?? error?.message}, retry ${attempt}/${MAX_ATTEMPTS - 1}`);
        await sleep(REQUEST_DELAY_MS * 2 ** attempt * 5);
      }
    }
  }

  async departments(): Promise<DirkDepartment[]> {
    const data = await this.query<{ listDepartments: { departments: DirkDepartment[] | null } | null }>(
      "departments",
      "{ listDepartments { departments { id description webGroups { webGroupId description } } } }"
    );
    return data.listDepartments?.departments ?? [];
  }

  /** The products of one web group sold at the store. */
  async webGroupProducts(webGroupId: number): Promise<DirkProduct[]> {
    const data = await this.query<{ listWebGroupProducts: { productAssortment: (DirkProduct | null)[] | null } | null }>(
      `web group ${webGroupId}`,
      `{ listWebGroupProducts(webGroupId: ${Math.trunc(webGroupId)}) {
        productAssortment(storeId: ${DIRK_STORE_ID}) { ${PRODUCT_FIELDS} } } }`
    );
    return (data.listWebGroupProducts?.productAssortment ?? []).filter((p): p is DirkProduct => !!p?.productId);
  }

  /** Products by id at the store; ids the store does not sell are left out. */
  async products(productIds: number[]): Promise<DirkProduct[]> {
    const products: DirkProduct[] = [];
    for (let i = 0; i < productIds.length; i += PRODUCTS_PER_REQUEST) {
      const ids = productIds.slice(i, i + PRODUCTS_PER_REQUEST).map((id) => Math.trunc(id));
      const data = await this.query<{ products: (DirkProduct | null)[] | null }>(
        `products ${i + 1}-${i + ids.length}`,
        `{ products(storeId: ${DIRK_STORE_ID}, productIds: [${ids.join(",")}]) { ${PRODUCT_FIELDS} } }`
      );
      products.push(...(data.products ?? []).filter((p): p is DirkProduct => !!p?.productId));
      await sleep(REQUEST_DELAY_MS);
    }
    return products;
  }

  async offers(departmentId: number): Promise<DirkOffer[]> {
    const data = await this.query<{ listOffers: { currentOffers: DirkOffer[] | null } | null }>(
      `offers of department ${departmentId}`,
      `{ listOffers(department: ${Math.trunc(departmentId)}) { currentOffers {
        offerId headerText subText promotionText normalPrice offerPrice startDate endDate type packaging productIds } } }`
    );
    return data.listOffers?.currentOffers ?? [];
  }

  /** Walks every web group; each product is delivered once. */
  async forEachWebGroup(onPage: (products: DirkProduct[]) => Promise<void>): Promise<void> {
    const departments = await this.departments();
    const webGroups = departments.flatMap((d) => d.webGroups ?? []);
    if (webGroups.length === 0) throw new Error("Dirk: no web groups found");
    scraperLogger.debug(`Dirk: ${departments.length} departments, ${webGroups.length} web groups`);

    const seen = new Set<number>();
    for (const group of webGroups) {
      const products = await this.webGroupProducts(group.webGroupId);
      const fresh = products.filter((p) => !seen.has(p.productId));
      fresh.forEach((p) => seen.add(p.productId));
      if (fresh.length > 0) await onPage(fresh);
      await sleep(REQUEST_DELAY_MS);
    }
    if (seen.size === 0) throw new Error("Dirk: the assortment returned no products");
    scraperLogger.info(`Dirk: ${seen.size} products in the assortment`);
  }
}

export default DirkGraphql;
