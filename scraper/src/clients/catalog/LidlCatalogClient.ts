import axios, { AxiosInstance } from "axios";
import CatalogClient from "./CatalogClient";
import { ICatalogProduct } from "../../interfaces/ICatalogProduct";
import { scraperLogger } from "../../utils/Logger";
import { parseQuantity } from "../../utils/Quantity";
import { sameQuantity } from "../../utils/ProductMatch";

// Lidl publishes its food assortment on lidl.nl as server-rendered pages under
// "Assortiment > Producten", one page per shelf (kaas, vleeswaren, ...). Every
// product tile carries its data as JSON in a data-grid-data attribute. Since
// November 2026 the shelf pages live under /c/store/ (the old paths redirect)
// and the start page only links to them; a page is known by its id (a10008017). Lidl
// does not publish regular prices online (only current offers have one), so
// prices come from the open checkjebon.nl dataset (MIT), matched on the Lidl
// article number and, failing that, on a unique product name. The regular
// price Lidl shows next to an offer is stored on the catalog row by the offer
// scraper (linked by the permanent article number) and is kept over the
// checkjebon price for a while (PostgresCatalogController.keepsObservedPrice).
const LIDL_BASE = "https://www.lidl.nl";
const START_PATH = "/c/assortiment-producten/s10008015";
// Lidl's site search over its food tree ("Eten en drinken", 10068374), the
// source of the newer /h/ category pages. It finds food that no shelf page
// shows; the shelf pages find some the search misses, so both are read.
const SEARCH_URL = `${LIDL_BASE}/q/api/search?category.id=10068374&assortment=NL&locale=nl_NL&version=v2.0.0`;
const SEARCH_PAGE_SIZE = 100;
// The search reports at most 10,000 results; the food tree holds a few hundred.
const MAX_SEARCH_RESULTS = 5000;
const CHECKJEBON_URL =
  "https://raw.githubusercontent.com/supermarkt/checkjebon/main/data/supermarkets.json";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
// Assortment pages are linked from the start page and from each other; the
// cap keeps a change in Lidl's navigation from turning into a site crawl.
const MAX_PAGES = 80;
const REQUEST_DELAY_MS = 500;
const MAX_ATTEMPTS = 3;
const FOOD_CATEGORIES = new Set(["Food", "F+V"]);
// checkjebon has the odd bogus price (e.g. a 400 g fish fillet at 0.01).
const MIN_CHECKJEBON_PRICE = 0.05;
// Lidl's taxonomy path is "Werelden van nood/<world>/<category>/...". Only the
// food worlds are reliable for food tiles, and they mix two naming schemes.
const FOOD_WORLDS = new Set(["Eten en dichtbij voedsel", "Wijn, bier en sterke drank"]);
const CATEGORY_ALIASES: Record<string, string> = {
  "Kaas en zuivelproducten (incl. boter en kaas)": "Kaas, zuivelproducten & eieren",
  "Snacks en snoepgoed": "Snoep & snacks",
  "Diepvriesvoeding (Diepvriesvoeding)": "Diepvries",
  "Worst & Vlees": "Vlees & gevogelte",
  "Brood & gebak": "Bakkerij",
  "Voedselvoorraad": "Voorraadkast",
  "Eieren & basisvoedingsmiddelen (pasta, bloem, peulvruchten etc.)": "Voorraadkast",
  "Geesten": "Sterke drank",
};

/** One page of Lidl's site search; each item carries the same data as a page tile. */
interface LidlSearchPage {
  numFound?: number;
  items?: Array<{ gridbox?: { data?: LidlGridData } }>;
}

export interface LidlGridData {
  erpNumber?: string;
  productId?: number;
  fullTitle?: string;
  category?: string;
  canonicalUrl?: string;
  image?: string;
  brand?: { name?: string; showBrand?: boolean };
  price?: { price?: number; oldPrice?: number };
  keyfacts?: { description?: string; wonCategoryPrimary?: string };
  /**
   * The permanent article number. erpNumber changes per listing (an offer
   * gets its own); the assortment tile and the offer tile share nat/ians.
   */
  nat?: string;
  ians?: string[];
}

/** The tile's permanent article numbers (nat first, then ians), without leading zeros. */
export function lidlArticleNumbers(tile: Pick<LidlGridData, "nat" | "ians">): string[] {
  const numbers = [tile.nat, ...(tile.ians ?? [])]
    .map((n) => (typeof n === "string" ? n.trim().replace(/^0+/, "") : ""))
    .filter((n) => n !== "");
  return [...new Set(numbers)];
}

/** One Lidl product in the checkjebon dataset: name, article number, price, size. */
export interface CheckjebonProduct {
  n: string;
  l: string;
  p: number;
  s: string;
}

export interface PriceIndex {
  byId: Map<string, CheckjebonProduct>;
  byName: Map<string, CheckjebonProduct[]>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const NAMED_ENTITIES: Record<string, string> = {
  quot: '"',
  amp: "&",
  lt: "<",
  gt: ">",
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1] === "x" || entity[1] === "X"
        ? parseInt(entity.slice(2), 16)
        : parseInt(entity.slice(1), 10);
      return Number.isNaN(code) ? match : String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** The product tiles of one lidl.nl page. */
export function extractGridData(html: string): LidlGridData[] {
  const products: LidlGridData[] = [];
  for (const match of html.matchAll(/data-grid-data="([^"]*)"/g)) {
    try {
      products.push(JSON.parse(decodeEntities(match[1])));
    } catch {
      scraperLogger.debug("Lidl catalog: skipped an unreadable product tile");
    }
  }
  return products;
}

/**
 * Links to further assortment pages, as paths: /c/assortiment-kaas/a10009593
 * or, since November 2026, /c/store/assortiment-kaas/a10009593.
 */
export function findAssortmentLinks(html: string): string[] {
  const paths = new Set<string>();
  for (const match of html.matchAll(/href="(?:https:\/\/www\.lidl\.nl)?(\/c\/[^"#?]+)/g)) {
    const path = match[1];
    if (/^\/c\/(?:store\/)?[^/]*(assortiment|wijn)[^/]*\/[as]\d+$/.test(path)) paths.add(path);
  }
  return [...paths];
}

/** The page id at the end of an assortment path (a10009593), the same under every path. */
export const assortmentPageId = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** Some assortment URLs answer with a meta refresh to their current path. */
export function metaRefreshTarget(html: string): string | null {
  const match = html.match(/http-equiv="refresh"\s+content="\d+;\s*url=([^"]+)"/i);
  return match ? decodeEntities(match[1]) : null;
}

const normalizeName = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const normalizeSize = (size: string | null | undefined) =>
  (size ?? "").toLowerCase().replace(/\s+/g, "").replace(",", ".");

export function buildPriceIndex(products: CheckjebonProduct[]): PriceIndex {
  const byId = new Map<string, CheckjebonProduct>();
  const byName = new Map<string, CheckjebonProduct[]>();
  for (const product of products) {
    if (!product?.n || typeof product.p !== "number" || product.p < MIN_CHECKJEBON_PRICE) continue;
    if (product.l) byId.set(String(product.l).replace(/^0+/, ""), product);
    const key = normalizeName(product.n);
    byName.set(key, [...(byName.get(key) ?? []), product]);
  }
  return { byId, byName };
}

/** Both sides know the pack size and it differs ("500 g" and "0,5 kg" are the same). */
function sizesDiffer(ownSize: string | null, theirSize: string | null): boolean {
  const own = parseQuantity(ownSize);
  const theirs = parseQuantity(theirSize);
  if (own && theirs) return !sameQuantity(own, theirs);
  const a = normalizeSize(ownSize);
  const b = normalizeSize(theirSize);
  return a !== "" && b !== "" && a !== b;
}

/**
 * Finds the checkjebon entry for a Lidl product: by the tile's article number
 * (erpNumber), else by its permanent article number (nat, which checkjebon
 * mostly uses), else by a name that occurs once in the dataset. Variants can
 * share a permanent number and a name, so those matches are rejected when
 * both sides know the pack size and it differs.
 */
export function findPrice(
  index: PriceIndex,
  articleNumber: string,
  name: string,
  unitSize: string | null,
  permanentNumbers: string[] = []
): CheckjebonProduct | null {
  const byId = index.byId.get(articleNumber.replace(/^0+/, ""));
  if (byId) return byId;

  for (const number of permanentNumbers) {
    const byNat = index.byId.get(number.replace(/^0+/, ""));
    if (byNat && !sizesDiffer(unitSize, byNat.s)) return byNat;
  }

  const candidates = index.byName.get(normalizeName(name)) ?? [];
  if (candidates.length !== 1) return null;
  const candidate = candidates[0];
  if (sizesDiffer(unitSize, candidate.s)) return null;
  return candidate;
}

/** Pack size from a tile description such as "<ul><li>150 g</li></ul>". */
export function extractUnitSize(description: string | undefined): string | null {
  if (!description) return null;
  const text = decodeEntities(description.replace(/<[^>]+>/g, " "));
  const match = text.match(
    /\b(\d+(?:[.,]\d+)?\s*(?:x\s*\d+(?:[.,]\d+)?\s*)?(?:kg|g|ml|cl|l|liter|stuks|stuk|st))\b/i
  );
  return match ? match[1].replace(/\s+/g, " ").trim() : null;
}

/** Category from "Werelden van nood/Eten en dichtbij voedsel/Kaas, zuivelproducten & eieren/Kaas". */
export function lidlCategory(tile: LidlGridData): string {
  const [, world, category] = (tile.keyfacts?.wonCategoryPrimary ?? "").split("/").map((s) => s.trim());
  if (world && category && FOOD_WORLDS.has(world)) return CATEGORY_ALIASES[category] ?? category;
  return tile.category === "F+V" ? "Groenten & fruit" : "Overig";
}

/** Maps one product tile to the catalog shape; null for non-food or unusable tiles. */
export function mapLidlProduct(tile: LidlGridData, index: PriceIndex): ICatalogProduct | null {
  const articleNumber = tile.erpNumber ?? (tile.productId ? String(tile.productId) : null);
  const name = tile.fullTitle?.trim();
  if (!articleNumber || !name || !FOOD_CATEGORIES.has(tile.category ?? "")) return null;

  const unitSize = extractUnitSize(tile.keyfacts?.description);
  const category = lidlCategory(tile);

  // Lidl's own price wins when it shows the regular price next to an offer;
  // otherwise use checkjebon; a Lidl price without an offer is the shelf price.
  let price: number | null = null;
  let priceSource: string | null = null;
  let checkjebonSize: string | null = null;
  const own = tile.price;
  if (typeof own?.oldPrice === "number" && own.oldPrice > 0) {
    price = own.oldPrice;
    priceSource = "supermarket";
  } else {
    const match = findPrice(index, articleNumber, name, unitSize, lidlArticleNumbers(tile));
    if (match) {
      price = match.p;
      priceSource = "checkjebon";
      checkjebonSize = match.s?.trim() || null;
    } else if (typeof own?.price === "number" && own.price > 0) {
      price = own.price;
      priceSource = "supermarket";
    }
  }

  return {
    externalId: articleNumber,
    name,
    brand: tile.brand?.showBrand && tile.brand.name ? tile.brand.name.trim() : null,
    category,
    unitSize: unitSize ?? checkjebonSize,
    price,
    priceSource,
    unitPrice: null,
    imageUrl: tile.image ?? null,
    productUrl: tile.canonicalUrl ? `${LIDL_BASE}${tile.canonicalUrl}` : null,
    articleNumber: lidlArticleNumbers(tile)[0] ?? null,
  };
}

class LidlCatalogClient extends CatalogClient {
  readonly supermarket = "Lidl";

  private http: AxiosInstance;

  constructor(http?: AxiosInstance) {
    super();
    this.http =
      http ??
      axios.create({
        timeout: 60000,
        headers: { "User-Agent": USER_AGENT, "Accept-Language": "nl-NL,nl;q=0.9" },
      });
  }

  private async get<T>(url: string, responseType: "text" | "json"): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        const response = await this.http.get<T>(url, { responseType });
        return response.data;
      } catch (error: any) {
        const status = error?.response?.status;
        const retryable = !status || status === 429 || status >= 500;
        if (!retryable || attempt >= MAX_ATTEMPTS) {
          const failure = new Error(`Lidl ${url}: ${status ? `HTTP ${status}` : error?.message ?? "request failed"}`);
          throw Object.assign(failure, { status });
        }
        scraperLogger.warn(`Lidl catalog: ${url} ${status ?? error?.message}, retry ${attempt}/${MAX_ATTEMPTS - 1}`);
        await sleep(REQUEST_DELAY_MS * 2 ** attempt * 2);
      }
    }
  }

  /** Without the price dataset the catalog is still useful; products then have no price. */
  private async loadPriceIndex(): Promise<PriceIndex> {
    try {
      const data = await this.get<Array<{ n: string; d: CheckjebonProduct[] }>>(CHECKJEBON_URL, "json");
      const lidl = (Array.isArray(data) ? data : []).find((s) => s.n === "lidl");
      const index = buildPriceIndex(lidl?.d ?? []);
      scraperLogger.debug(`Lidl catalog: ${index.byId.size} checkjebon prices loaded`);
      return index;
    } catch (error: any) {
      scraperLogger.warn(`Lidl catalog: checkjebon prices unavailable (${error?.message}), continuing without prices`);
      return buildPriceIndex([]);
    }
  }

  private async fetchPage(path: string): Promise<string> {
    const html = await this.get<string>(`${LIDL_BASE}${path}`, "text");
    const target = metaRefreshTarget(html);
    if (!target) return html;
    const next = target.startsWith("http") ? target : `${LIDL_BASE}${target}`;
    return this.get<string>(next, "text");
  }

  async fetchCatalog(onPage: (products: ICatalogProduct[]) => Promise<void>): Promise<void> {
    const index = await this.loadPriceIndex();
    const queue = [START_PATH];
    const visited = new Set<string>(); // page ids
    const seen = new Set<string>();
    let withPrice = 0;

    while (queue.length > 0 && visited.size < MAX_PAGES) {
      const path = queue.shift()!;
      if (visited.has(assortmentPageId(path))) continue;
      visited.add(assortmentPageId(path));

      let html: string;
      try {
        html = await this.fetchPage(path);
      } catch (error: any) {
        // A shelf Lidl took away is skipped; a missing start page fails the run.
        if (path === START_PATH || (error?.status !== 404 && error?.status !== 410)) throw error;
        scraperLogger.debug(`Lidl catalog: ${path} is gone (HTTP ${error.status}), skipped`);
        continue;
      }
      for (const link of findAssortmentLinks(html)) {
        if (!visited.has(assortmentPageId(link))) queue.push(link);
      }

      const products: ICatalogProduct[] = [];
      for (const tile of extractGridData(html)) {
        const product = mapLidlProduct(tile, index);
        if (!product || seen.has(product.externalId)) continue;
        seen.add(product.externalId);
        if (product.price !== null) withPrice++;
        products.push(product);
      }
      scraperLogger.debug(`Lidl catalog: ${path}: ${products.length} new products`);
      if (products.length > 0) await onPage(products);
      await sleep(REQUEST_DELAY_MS);
    }

    if (queue.length > 0) {
      scraperLogger.warn(`Lidl catalog: stopped at ${MAX_PAGES} pages, ${queue.length} links not visited`);
    }
    const fromPages = seen.size;

    // Food the search finds that no shelf page showed. A failing search leaves
    // the shelf products in place.
    for (let offset = 0; offset < MAX_SEARCH_RESULTS; ) {
      let page: LidlSearchPage;
      try {
        page = await this.get<LidlSearchPage>(`${SEARCH_URL}&fetchsize=${SEARCH_PAGE_SIZE}&offset=${offset}`, "json");
      } catch (error: any) {
        scraperLogger.warn(`Lidl catalog: search failed at ${offset}, keeping the shelf products: ${error?.message}`);
        break;
      }
      const items = page?.items ?? [];
      const products: ICatalogProduct[] = [];
      for (const item of items) {
        const product = item?.gridbox?.data ? mapLidlProduct(item.gridbox.data, index) : null;
        if (!product || seen.has(product.externalId)) continue;
        seen.add(product.externalId);
        if (product.price !== null) withPrice++;
        products.push(product);
      }
      if (products.length > 0) await onPage(products);
      offset += items.length;
      if (items.length === 0 || offset >= (page?.numFound ?? 0)) break;
      await sleep(REQUEST_DELAY_MS);
    }

    scraperLogger.info(
      `Lidl catalog: ${seen.size} food products (${fromPages} from ${visited.size} pages, ` +
        `${seen.size - fromPages} more from the search), ${withPrice} with a price`
    );
  }
}

export default LidlCatalogClient;
