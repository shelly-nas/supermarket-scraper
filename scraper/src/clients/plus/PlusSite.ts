import axios, { AxiosInstance } from "axios";
import { scraperLogger } from "../../utils/Logger";
import { parseQuantity, Quantity } from "../../utils/Quantity";

// plus.nl is an OutSystems app. Its product list pages call the screen action
// below; without a category slug it lists the whole assortment (12 products
// per page, the server's fixed page size), and the "Nu in de aanbieding"
// filter narrows it to the products on offer. Plain HTTP is enough, no
// browser:
// - anonymous OutSystems requests carry the platform's fixed anonymous CSRF
//   token, the same for every visitor;
// - the request names the module and api versions, which change with every
//   release of the site. They are read from the site itself: the module
//   version from /moduleservices/moduleversioninfo, the api version from the
//   product list screen's script listed in /moduleservices/moduleinfo. When
//   the server says a version changed, they are read again.
export const PLUS_BASE = "https://www.plus.nl";
const PRODUCT_LIST_ACTION =
  "screenservices/ECP_Composition_CW/ProductLists/PLP_Content/DataActionGetProductListAndCategoryInfo";
const PRODUCT_LIST_SCRIPT = /ECP_Composition_CW\.ProductLists\.PLP_Content\.mvc\.js$/;
const VIEW_NAME = "MainFlow.ProductListPage";
const ANONYMOUS_CSRF_TOKEN = "T6C+9iB49TLra4jEsMeSckDMNhQ=";
export const PLUS_OFFER_FILTER = "&tn_fk_ae-is_aanbieding=Nu%20in%20de%20aanbieding";
const REQUEST_DELAY_MS = 250;
const MAX_ATTEMPTS = 4;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";

/** One product tile; prices are strings, NewPrice is "0" without a single promotion price. */
export interface PlusProduct {
  SKU: string;
  Brand: string;
  Name: string;
  Product_Subtitle: string;
  Slug: string;
  ImageURL: string;
  OriginalPrice: string;
  NewPrice: string;
  Categories: { List: { Name: string }[] } | null;
  IsAvailable: boolean;
  PromotionLabel: string;
  PromotionBasedLabel: string;
  PromotionStartDate: string;
  PromotionEndDate: string;
  IsFreeDeliveryOffer: boolean;
}

export interface PlusPage {
  totalPages: number;
  totalItems: number;
  products: PlusProduct[];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const plusPrice = (text: string | null | undefined): number | null => {
  const value = parseFloat(text ?? "");
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null;
};

/** "Per 1000 ml" -> "1000 ml"; "Per kilo" stays. */
export function plusUnitSize(product: PlusProduct): string | null {
  const text = product.Product_Subtitle?.trim();
  if (!text) return null;
  return /^per\s+\d/i.test(text) ? text.replace(/^per\s+/i, "") : text;
}

export function plusQuantity(product: PlusProduct): Quantity | null {
  return parseQuantity(product.Product_Subtitle) ?? parseQuantity(product.Name);
}

/**
 * The product image at 400 px as WebP: PLUS images are on Contentful, whose
 * image API scales on request (the original PNG is often over 1 MB).
 */
export function plusImageUrl(product: PlusProduct): string | null {
  const url = product.ImageURL?.trim();
  if (!url) return null;
  return /images\.ctfassets\.net/.test(url) && !url.includes("?") ? `${url}?w=400&fm=webp` : url;
}

export function plusProductUrl(product: PlusProduct): string | null {
  return product.Slug ? `${PLUS_BASE}/product/${product.Slug}` : null;
}

export function plusCategory(product: PlusProduct): string {
  return product.Categories?.List?.[0]?.Name?.trim() || "Overig";
}

export interface PlusVersions {
  moduleVersion: string;
  apiVersion: string;
}

/** The api version of the product list action in the screen's script, or null. */
export function plusApiVersion(script: string): string | null {
  // callDataAction("...", "screenservices/.../DataActionGetProductListAndCategoryInfo", "<apiVersion>", ...)
  const escaped = PRODUCT_LIST_ACTION.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return script.match(new RegExp(`"${escaped}"\\s*,\\s*"([^"]+)"`))?.[1] ?? null;
}

class PlusSite {
  private http: AxiosInstance;
  private versions: PlusVersions | null = null;

  constructor(http?: AxiosInstance) {
    this.http =
      http ??
      axios.create({
        baseURL: PLUS_BASE,
        timeout: 60000,
        headers: { "User-Agent": USER_AGENT, "Accept-Language": "nl-NL,nl;q=0.9" },
      });
  }

  /** Reads the current module and api versions from the site. */
  async open(): Promise<void> {
    const versionInfo = await this.get<{ versionToken?: string }>("/moduleservices/moduleversioninfo", "module version");
    const moduleVersion = versionInfo?.versionToken;
    if (!moduleVersion) throw new Error("PLUS: no module version on plus.nl");

    const moduleInfo = await this.get<{ manifest?: { urlVersions?: Record<string, string> } }>(
      `/moduleservices/moduleinfo?${encodeURIComponent(moduleVersion)}`,
      "module info"
    );
    const urls = moduleInfo?.manifest?.urlVersions ?? {};
    const script = Object.keys(urls).find((url) => PRODUCT_LIST_SCRIPT.test(url));
    if (!script) throw new Error("PLUS: product list script not found in the module info");
    const source = await this.get<string>(`${script}${urls[script]}`, "product list script", "text");
    const apiVersion = plusApiVersion(source);
    if (!apiVersion) throw new Error("PLUS: api version of the product list not found");

    this.versions = { moduleVersion, apiVersion };
    scraperLogger.debug(`PLUS: versions ${JSON.stringify(this.versions)}`);
  }

  /** Nothing to release without a browser; kept for the clients' open/close flow. */
  async close(): Promise<void> {
    this.versions = null;
  }

  private async get<T>(url: string, step: string, responseType: "json" | "text" = "json"): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return (await this.http.get<T>(url, { responseType })).data;
      } catch (error: any) {
        const status = error?.response?.status;
        const retryable = status === undefined || status === 429 || status >= 500;
        if (!retryable || attempt >= MAX_ATTEMPTS) {
          throw new Error(`PLUS ${step}: ${status ? `HTTP ${status}` : error?.message ?? "request failed"}`);
        }
        scraperLogger.warn(`PLUS: ${step} ${status ? `HTTP ${status}` : error?.message}, retry ${attempt}/${MAX_ATTEMPTS - 1}`);
        await sleep(REQUEST_DELAY_MS * 2 ** attempt * 5);
      }
    }
  }

  /** One page of the assortment (no slug, so every category), optionally filtered. */
  async listPage(pageNumber: number, filterQuery = ""): Promise<PlusPage> {
    if (!this.versions) throw new Error("PLUS: site not opened");
    const step = `page ${pageNumber}${filterQuery ? " (offers)" : ""}`;
    let versionsRenewed = false;

    for (let attempt = 1; ; attempt++) {
      const body = {
        versionInfo: this.versions,
        viewName: VIEW_NAME,
        screenData: {
          variables: {
            PageNumber: pageNumber,
            CategorySlug: "",
            SearchKeyword: "",
            IsSearch: false,
            FilterQueryURL: filterQuery,
          },
        },
      };
      let response;
      try {
        response = await this.http.post(`/${PRODUCT_LIST_ACTION}`, body, {
          headers: {
            "Content-Type": "application/json; charset=UTF-8",
            Accept: "application/json",
            "x-csrftoken": ANONYMOUS_CSRF_TOKEN,
            "outsystems-locale": "nl-NL",
          },
        });
      } catch (error: any) {
        const status = error?.response?.status;
        const retryable = status === undefined || status === 429 || status >= 500;
        if (!retryable || attempt >= MAX_ATTEMPTS) {
          const text = typeof error?.response?.data === "string" ? error.response.data : JSON.stringify(error?.response?.data ?? "");
          throw new Error(`PLUS ${step}: ${status ? `HTTP ${status} ${text.slice(0, 120)}` : error?.message}`);
        }
        scraperLogger.warn(`PLUS: ${step} ${status ? `HTTP ${status}` : error?.message}, retry ${attempt}/${MAX_ATTEMPTS - 1}`);
        await sleep(REQUEST_DELAY_MS * 2 ** attempt * 5);
        continue;
      }

      const json = response.data ?? {};
      // A new release of the site: read the versions again, once per page.
      if (json.versionInfo?.hasApiVersionChanged || json.versionInfo?.hasModuleVersionChanged) {
        if (versionsRenewed) throw new Error(`PLUS ${step}: the site version keeps changing`);
        scraperLogger.info("PLUS: the site has a new version, reading the versions again");
        await this.open();
        versionsRenewed = true;
        continue;
      }
      if (json.exception) throw new Error(`PLUS ${step}: ${json.exception.message ?? "server error"}`);
      const data = json.data ?? {};
      return {
        totalPages: data.TotalPages ?? 0,
        totalItems: data.TotalNumberItems ?? 0,
        products: (data.ProductList?.List ?? []).map((item: any) => item.PLP_Str).filter((p: any) => p?.SKU),
      };
    }
  }

  /** Walks every page; each product is delivered once. Returns the number of products. */
  async forEachPage(filterQuery: string, onPage: (products: PlusProduct[]) => Promise<void>): Promise<number> {
    const seen = new Set<string>();
    let totalPages = 1;
    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
      const page = await this.listPage(pageNumber, filterQuery);
      if (pageNumber === 1) {
        totalPages = page.totalPages;
        scraperLogger.info(`PLUS: ${page.totalItems} products on ${totalPages} pages${filterQuery ? " (offers)" : ""}`);
      }
      const fresh = page.products.filter((p) => !seen.has(p.SKU));
      fresh.forEach((p) => seen.add(p.SKU));
      if (fresh.length > 0) await onPage(fresh);
      await sleep(REQUEST_DELAY_MS);
    }
    return seen.size;
  }
}

export default PlusSite;
