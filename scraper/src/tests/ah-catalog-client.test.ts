import { describe, it, expect, vi } from "vitest";
import AhCatalogClient, { describeError, mapAhProduct } from "../clients/catalog/AhCatalogClient";
import { ICatalogProduct } from "../interfaces/ICatalogProduct";
import AhMobileApi from "../clients/ah/AhMobileApi";

vi.mock("../utils/Logger", () => ({
  scraperLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  serverLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// No real waiting between pages in tests.
vi.spyOn(global, "setTimeout").mockImplementation(((fn: () => void) => {
  fn();
  return 0 as any;
}) as any);

const product = (id: number, extra: Record<string, unknown> = {}) => ({
  webshopId: id,
  title: `Product ${id}`,
  brand: "AH",
  salesUnitSize: "1 l",
  unitPriceDescription: "prijs per lt €1.19",
  priceBeforeBonus: 1.19,
  mainCategory: "Zuivel, eieren",
  images: [
    { width: 800, height: 800, url: "https://img/800.jpg" },
    { width: 200, height: 200, url: "https://img/200.jpg" },
  ],
  ...extra,
});

function fakeHttp(pages: Record<string, any>, failFirst?: number) {
  let failures = failFirst ?? 0;
  return {
    defaults: { headers: { common: {} as Record<string, string> } },
    post: vi.fn().mockResolvedValue({ data: { access_token: "token" } }),
    get: vi.fn().mockImplementation(async (url: string, config?: any) => {
      if (failures > 0) {
        failures--;
        throw { response: { status: 401 } };
      }
      const key = `${config.params.taxonomyId}:${config.params.page}`;
      return { data: pages[key] ?? { products: [], page: { totalPages: 0 } } };
    }),
  };
}

describe("AH catalog client", () => {
  it("maps regular price, image, unit size and product url", () => {
    const mapped = mapAhProduct(
      product(42, { currentPrice: 0.99, priceBeforeBonus: 1.19, isBonus: true }),
      "Fallback"
    )!;
    expect(mapped).toEqual({
      externalId: "42",
      name: "Product 42",
      brand: "AH",
      category: "Zuivel, eieren",
      unitSize: "1 l",
      price: 1.19,
      priceSource: "supermarket",
      unitPrice: "prijs per lt €1.19",
      imageUrl: "https://img/200.jpg",
      productUrl: "https://www.ah.nl/producten/product/wi42",
    });
  });

  it("uses currentPrice when there is no bonus and skips products without a price", () => {
    expect(mapAhProduct(product(1, { priceBeforeBonus: undefined, currentPrice: 2.5 }), "x")!.price).toBe(2.5);
    expect(mapAhProduct(product(2, { priceBeforeBonus: undefined }), "x")).toBeNull();
  });

  it("lists the top-level categories without calling AH, which removed its categories endpoint", async () => {
    const http = fakeHttp({});
    const categories = await new AhMobileApi(http as any).categories();

    expect(http.get).not.toHaveBeenCalled();
    expect(categories).toContainEqual({ id: 6401, name: "Groente, aardappelen" });
    expect(categories).toContainEqual({ id: 1045, name: "Drogisterij" });
    expect(new Set(categories.map((c) => c.id)).size).toBe(categories.length);
  });

  it("reads a category past the search limit from both price ends, each product once", async () => {
    // 7 products, the search stops after 4: low to high gives 1-4, high to low 7-4.
    const byPrice = [1, 2, 3, 4, 5, 6, 7];
    const http = fakeHttp({});
    http.get = vi.fn().mockImplementation(async (_url: string, config: any) => {
      const { page, size, sortOn } = config.params;
      if ((page + 1) * size > 4) throw { response: { status: 400 } };
      const order = sortOn === "PRICEHIGHLOW" ? [...byPrice].reverse() : byPrice;
      const ids = order.slice(page * size, (page + 1) * size);
      return { data: { products: ids.map((id) => product(id)), page: { totalPages: 4, totalElements: 7 } } };
    });
    const pages: number[][] = [];
    await new AhMobileApi(http as any).walkCategory(6409, 2, false, async (products) => {
      pages.push(products.map((p) => p.webshopId));
    }, 4);

    expect(pages).toEqual([[1, 2], [3, 4], [7, 6], [5]]);
    expect(http.get.mock.calls.map((c: any) => c[1].params.sortOn)).toEqual([
      "PRICELOWHIGH",
      "PRICELOWHIGH",
      "PRICEHIGHLOW",
      "PRICEHIGHLOW",
    ]);
  });

  it("walks every page of every category", async () => {
    const http = fakeHttp({
      "6401:0": { products: [product(1), product(2)], page: { totalPages: 2 } },
      "6401:1": { products: [product(3)], page: { totalPages: 2 } },
      "1045:0": { products: [product(4)], page: { totalPages: 1 } },
    });
    const client = new AhCatalogClient(http as any);
    const pages: ICatalogProduct[][] = [];
    await client.fetchCatalog(async (p) => {
      pages.push(p);
    });

    expect(pages.map((p) => p.map((x) => x.externalId))).toEqual([["1", "2"], ["3"], ["4"]]);
    expect(http.defaults.headers.common.Authorization).toBe("Bearer token");
  });

  it("re-authenticates once when the token expires mid run", async () => {
    const http = fakeHttp({ "6401:0": { products: [product(1)], page: { totalPages: 1 } } }, 1);
    const client = new AhCatalogClient(http as any);
    const seen: string[] = [];
    await client.fetchCatalog(async (p) => {
      seen.push(...p.map((x) => x.externalId));
    });

    expect(seen).toEqual(["1"]);
    expect(http.post).toHaveBeenCalledTimes(2);
  });

  it("retries the token call on 503 and names the failing step when it keeps failing", async () => {
    const http = fakeHttp({});
    http.post = vi.fn().mockRejectedValue({
      response: { status: 503, data: "<html>Service   Unavailable</html>" },
    });
    const client = new AhCatalogClient(http as any);

    await expect(client.fetchCatalog(async () => {})).rejects.toThrow(
      "AH token: HTTP 503 - <html>Service Unavailable</html>"
    );
    expect(http.post).toHaveBeenCalledTimes(4);
  });

  it("describes network errors without a status", () => {
    expect(describeError("categories", new Error("socket hang up")).message).toBe(
      "AH categories: socket hang up"
    );
  });
});
