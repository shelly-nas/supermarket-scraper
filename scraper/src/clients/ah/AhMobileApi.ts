import axios, { AxiosInstance } from "axios";
import { scraperLogger } from "../../utils/Logger";

// Albert Heijn's mobile app API. An anonymous token is enough to read the
// products, their regular and bonus prices. Headers and client id follow the
// current iOS app; the API answers outdated app versions with errors such as 503.
const API_BASE = "https://api.ah.nl";
const CLIENT_ID = "appie-ios";
const CLIENT_VERSION = "9.28";
const MAX_ATTEMPTS = 4;
export const REQUEST_DELAY_MS = 300;

export interface AhCategory {
  id: number;
  name: string;
}

export interface AhImage {
  width: number;
  height: number;
  url: string;
}

/** One promotion label of a bonus product, e.g. "3 voor 5.00" (count 3, price 5). */
export interface AhDiscountLabel {
  code: string;
  defaultDescription?: string | null;
  amount?: number | null;
  count?: number | null;
  freeCount?: number | null;
  price?: number | null;
  percentage?: number | null;
  unit?: string | null;
}

export interface AhProduct {
  webshopId: number;
  title: string;
  brand?: string;
  salesUnitSize?: string;
  unitPriceDescription?: string;
  /** The bonus price when the bonus sets one; missing for multi-buy bonuses. */
  currentPrice?: number | null;
  priceBeforeBonus?: number | null;
  isBonus?: boolean;
  mainCategory?: string;
  subCategory?: string;
  images?: AhImage[];
  // Bonus details, present when isBonus is true.
  bonusStartDate?: string | null;
  bonusEndDate?: string | null;
  /** NATIONAL (the weekly bonus), AHONLINE (online only), ETOS, GALL, GALLCARD, PERPETUAL. */
  promotionType?: string | null;
  bonusMechanism?: string | null;
  /** The group the bonus covers, e.g. "Alle Felix". */
  bonusSegmentDescription?: string | null;
  /** E.g. "vanaf 22 okt" for a bonus that starts later in the week. */
  bonusPeriodDescription?: string | null;
  discountLabels?: AhDiscountLabel[] | null;
}

export interface AhSearchResponse {
  products?: AhProduct[];
  page?: { totalPages: number; number: number; totalElements: number };
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Turns an HTTP failure into an error that says which call failed and why. */
export function describeError(step: string, error: any): Error {
  const status = error?.response?.status;
  if (!status) return new Error(`AH ${step}: ${error?.message ?? "request failed"}`);
  const body = error.response.data;
  const text = (typeof body === "string" ? body : JSON.stringify(body ?? ""))
    .replace(/\s+/g, " ")
    .slice(0, 200);
  return new Error(`AH ${step}: HTTP ${status}${text && text !== '""' ? ` - ${text}` : ""}`);
}

/** A product image of at least 200px wide (the smallest such), else the first one. */
export function ahImage(product: Pick<AhProduct, "images">): string | null {
  const image = [...(product.images ?? [])].sort((a, b) => a.width - b.width)
    .find((i) => i.width >= 200) ?? product.images?.[0];
  return image?.url ?? null;
}

export const ahProductUrl = (product: Pick<AhProduct, "webshopId">) =>
  `https://www.ah.nl/producten/product/wi${product.webshopId}`;

/** Thin client for the AH mobile API: anonymous login, categories and product search. */
export default class AhMobileApi {
  private http: AxiosInstance;

  constructor(http?: AxiosInstance) {
    this.http =
      http ??
      axios.create({
        baseURL: API_BASE,
        timeout: 30000,
        headers: {
          "User-Agent": `Appie/${CLIENT_VERSION} (iPhone17,3; iPhone; CPU OS 26_1 like Mac OS X)`,
          "x-client-name": CLIENT_ID,
          "x-client-version": CLIENT_VERSION,
          "x-application": "AHWEBSHOP",
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });
  }

  /**
   * Runs one API call. A run takes a while: renew an expired token and back
   * off on rate limiting or server errors before giving up. The final error
   * names the step, the HTTP status and the start of the response body.
   */
  private async request<T>(step: string, call: () => Promise<{ data: T }>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        const response = await call();
        return response.data;
      } catch (error: any) {
        const status = error?.response?.status;
        const retryable = status === 401 || status === 429 || (status >= 500 && status < 600);
        if (!retryable || attempt >= MAX_ATTEMPTS) throw describeError(step, error);
        scraperLogger.warn(`AH: ${step} HTTP ${status}, retry ${attempt}/${MAX_ATTEMPTS - 1}`);
        if (status === 401 && step !== "token") await this.authenticate();
        await sleep(REQUEST_DELAY_MS * 2 ** attempt * 5);
      }
    }
  }

  async authenticate(): Promise<void> {
    const data = await this.request<{ access_token?: string }>("token", () =>
      this.http.post("/mobile-auth/v1/auth/token/anonymous", { clientId: CLIENT_ID })
    );
    const token = data?.access_token;
    if (!token) throw new Error("AH: no anonymous access token returned");
    this.http.defaults.headers.common.Authorization = `Bearer ${token}`;
  }

  async categories(): Promise<AhCategory[]> {
    const data = await this.request<AhCategory[]>("categories", () =>
      this.http.get("/mobile-services/v1/product-shelves/categories")
    );
    return data ?? [];
  }

  /**
   * One page of products in a top-level category. With `bonusOnly` the API
   * returns only products with a bonus (all kinds: also online-only, Etos and
   * Gall & Gall). A search stops at 10,000 results, so search per category.
   */
  async searchPage(
    categoryId: number,
    page: number,
    size: number,
    bonusOnly = false
  ): Promise<AhSearchResponse> {
    const params: Record<string, string | number> = { taxonomyId: categoryId, page, size, sortOn: "RELEVANCE" };
    if (bonusOnly) params.filters = "bonus=Bonus";
    const data = await this.request<AhSearchResponse>(
      `search${bonusOnly ? " bonus" : ""} category ${categoryId} page ${page}`,
      () => this.http.get("/mobile-services/product/search/v2", { params })
    );
    return data ?? {};
  }
}
