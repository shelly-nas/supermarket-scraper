import { describe, it, expect, vi } from "vitest";
import LidlCatalogClient, {
  buildPriceIndex,
  extractGridData,
  extractUnitSize,
  findAssortmentLinks,
  findPrice,
  lidlArticleNumbers,
  lidlCategory,
  mapLidlProduct,
  metaRefreshTarget,
  LidlGridData,
} from "../clients/catalog/LidlCatalogClient";
import { ICatalogProduct } from "../interfaces/ICatalogProduct";

vi.mock("../utils/Logger", () => ({
  scraperLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  serverLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// No real waiting between pages in tests.
vi.spyOn(global, "setTimeout").mockImplementation(((fn: () => void) => {
  fn();
  return 0 as any;
}) as any);

const tile = (id: string, extra: Partial<LidlGridData> = {}): LidlGridData => ({
  erpNumber: id,
  fullTitle: `Product ${id}`,
  category: "Food",
  canonicalUrl: `/p/product-${id}/p${id}`,
  image: `https://img/${id}.jpg`,
  brand: { name: "Milbona", showBrand: true },
  price: {},
  keyfacts: {
    description: "<ul><li>Minimaal 5 weken gerijpt</li><li>450 g</li></ul>",
    wonCategoryPrimary: "Werelden van nood/Eten en dichtbij voedsel/Kaas, zuivelproducten & eieren/Kaas",
  },
  ...extra,
});

/** A product tile as lidl.nl renders it: JSON, HTML-escaped, in data-grid-data. */
const tileHtml = (data: LidlGridData) =>
  `<div data-grid-data="${JSON.stringify(data).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"></div>`;

const page = (tiles: LidlGridData[], links: string[] = []) =>
  `<html>${links.map((l) => `<a href="${l}">x</a>`).join("")}${tiles.map(tileHtml).join("")}</html>`;

const prices = buildPriceIndex([
  { n: "Product 100", l: "0100", p: 3.99, s: "450 g" },
  { n: "Unieke kaas", l: "999", p: 2.49, s: "200 g" },
  { n: "Dubbel", l: "1", p: 1, s: "" },
  { n: "Dubbel", l: "2", p: 2, s: "" },
]);

describe("Lidl catalog parsing", () => {
  it("reads HTML-escaped product tiles", () => {
    const html = page([tile("1", { fullTitle: "Ham & kaas \"extra\"" })]);
    expect(extractGridData(html).map((t) => t.fullTitle)).toEqual(['Ham & kaas "extra"']);
  });

  it("follows only assortment and wine pages", () => {
    const html = page([], [
      "/c/assortiment-kaas/a10009593",
      "/c/store/assortiment-groente-en-fruit/a10008017",
      "https://www.lidl.nl/c/assortiment-wijn/a10008469#10031991",
      "/c/wijnen/s10052442",
      "/c/klussen-tuin/s10067761",
      "/h/kaas-zuivel-eieren/h10095761",
    ]);
    expect(findAssortmentLinks(html).sort()).toEqual([
      "/c/assortiment-kaas/a10009593",
      "/c/assortiment-wijn/a10008469",
      "/c/store/assortiment-groente-en-fruit/a10008017",
      "/c/wijnen/s10052442",
    ]);
  });

  it("detects a meta refresh to the current page path", () => {
    expect(
      metaRefreshTarget('<meta http-equiv="refresh" content="0; url=/c/assortiment-zuivel/a10008400">')
    ).toBe("/c/assortiment-zuivel/a10008400");
    expect(metaRefreshTarget("<html></html>")).toBeNull();
  });

  it("extracts the pack size from the description", () => {
    expect(extractUnitSize("<ul><li>Minimaal 5 weken gerijpt</li><li>450 g</li></ul>")).toBe("450 g");
    expect(extractUnitSize("<li>6 x 0,33 l</li>")).toBe("6 x 0,33 l");
    expect(extractUnitSize("<li>Lekker mals</li>")).toBeNull();
  });

  it("uses food categories, merges Lidl's two naming schemes and drops other worlds", () => {
    const withPath = (path: string) => tile("1", { keyfacts: { wonCategoryPrimary: path } });
    expect(lidlCategory(withPath("Werelden van nood/Eten en dichtbij voedsel/Snacks en snoepgoed"))).toBe(
      "Snoep & snacks"
    );
    expect(lidlCategory(withPath("Werelden van nood/Mode & Accessoires/Damesmode"))).toBe("Overig");
    expect(lidlCategory(tile("1", { category: "F+V", keyfacts: {} }))).toBe("Groenten & fruit");
  });
});

describe("Lidl price matching", () => {
  it("matches on article number, ignoring leading zeros", () => {
    expect(findPrice(prices, "100", "Iets anders", null)?.p).toBe(3.99);
  });

  it("ignores implausibly low dataset prices", () => {
    const index = buildPriceIndex([{ n: "Fijnproeversfilet", l: "3944", p: 0.01, s: "400 g" }]);
    expect(findPrice(index, "3944", "Fijnproeversfilet", "400 g")).toBeNull();
  });

  it("matches a unique name only when the pack sizes agree", () => {
    expect(findPrice(prices, "5", "Unieke kaas", null)?.p).toBe(2.49);
    expect(findPrice(prices, "5", "Unieke kaas", "200 g")?.p).toBe(2.49);
    expect(findPrice(prices, "5", "Unieke kaas", "500 g")).toBeNull();
    expect(findPrice(prices, "5", "Dubbel", null)).toBeNull();
  });

  it("maps a tile with a checkjebon price", () => {
    expect(mapLidlProduct(tile("100"), prices)).toEqual({
      externalId: "100",
      name: "Product 100",
      brand: "Milbona",
      category: "Kaas, zuivelproducten & eieren",
      unitSize: "450 g",
      price: 3.99,
      priceSource: "checkjebon",
      unitPrice: null,
      imageUrl: "https://img/100.jpg",
      productUrl: "https://www.lidl.nl/p/product-100/p100",
      articleNumber: null,
    });
  });

  it("reads the permanent article number from nat and ians", () => {
    expect(lidlArticleNumbers({ nat: "0080846", ians: ["80846", "80847"] })).toEqual(["80846", "80847"]);
    expect(lidlArticleNumbers({ ians: ["6611698"] })).toEqual(["6611698"]);
    expect(lidlArticleNumbers({})).toEqual([]);
    expect(mapLidlProduct(tile("11305717", { nat: "6611698" }), prices)?.articleNumber).toBe("6611698");
  });

  it("matches checkjebon on the permanent article number when the pack size agrees", () => {
    const index = buildPriceIndex([
      { n: "Yakult", l: "6611698", p: 3.97, s: "8 x 65 ml" },
      { n: "Penne", l: "19089", p: 0.89, s: "500 g" },
    ]);
    expect(findPrice(index, "11305717", "Yakult", "8 x 65 ml", ["6611698"])?.p).toBe(3.97);
    expect(findPrice(index, "819089", "Penne", "0,5 kg", ["19089"])?.p).toBe(0.89);
    // Another pack under the same permanent number is not this product.
    expect(findPrice(index, "819089", "Penne", "1 kg", ["19089"])).toBeNull();
  });

  it("prefers Lidl's own regular price next to an offer, and keeps products without a price", () => {
    const onOffer = mapLidlProduct(tile("100", { price: { price: 2.99, oldPrice: 4.29 } }), prices)!;
    expect([onOffer.price, onOffer.priceSource]).toEqual([4.29, "supermarket"]);

    const unknown = mapLidlProduct(tile("7"), prices)!;
    expect([unknown.price, unknown.priceSource]).toEqual([null, null]);
  });

  it("skips non-food tiles", () => {
    expect(mapLidlProduct(tile("1", { category: "Assortiment/Mode/Herenmode" }), prices)).toBeNull();
  });
});

describe("Lidl catalog client", () => {
  const checkjebon = [{ n: "ah", d: [] }, { n: "lidl", d: [{ n: "Product 1", l: "1", p: 1.5, s: "" }] }];

  /** `search`: the food tree's search results, two per page; "fail" for a search that fails. */
  function fakeHttp(
    pages: Record<string, string>,
    options: { failPrices?: boolean; search?: LidlGridData[] | "fail" } = {}
  ) {
    return {
      get: vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("checkjebon")) {
          if (options.failPrices) throw { response: { status: 404 } };
          return { data: checkjebon };
        }
        if (url.includes("/q/api/search")) {
          if (options.search === "fail") throw { response: { status: 404 } };
          const all = options.search ?? [];
          const offset = Number(new URL(url).searchParams.get("offset"));
          const items = all.slice(offset, offset + 2).map((data) => ({ gridbox: { data } }));
          return { data: { numFound: all.length, items } };
        }
        const path = url.replace("https://www.lidl.nl", "");
        if (!(path in pages)) throw { response: { status: 404 } };
        return { data: pages[path] };
      }),
    };
  }

  it("crawls linked assortment pages once and delivers each product once", async () => {
    const http = fakeHttp({
      "/c/assortiment-producten/s10008015": page([], ["/c/assortiment-kaas/a1", "/c/assortiment-vlees/a2"]),
      "/c/assortiment-kaas/a1": page([tile("1"), tile("2")], ["/c/assortiment-vlees/a2"]),
      "/c/assortiment-vlees/a2": page([tile("2"), tile("3")], ["/c/assortiment-kaas/a1"]),
    });
    const pages: ICatalogProduct[][] = [];
    await new LidlCatalogClient(http as any).fetchCatalog(async (p) => {
      pages.push(p);
    });

    expect(pages.map((p) => p.map((x) => x.externalId))).toEqual([["1", "2"], ["3"]]);
    expect(pages[0][0]).toMatchObject({ price: 1.5, priceSource: "checkjebon" });
  });

  it("reads a page once under its old and its /c/store/ path, and skips dead links", async () => {
    const http = fakeHttp({
      "/c/assortiment-producten/s10008015": page([], [
        "/c/assortiment-nieuw/a9", // gone: 404
        "/c/assortiment-kaas/a1",
        "/c/store/assortiment-kaas/a1",
      ]),
      "/c/assortiment-kaas/a1": page([tile("1")], ["/c/store/assortiment-vlees/a2"]),
      "/c/store/assortiment-vlees/a2": page([tile("2")]),
    });
    const seen: string[] = [];
    await new LidlCatalogClient(http as any).fetchCatalog(async (p) => {
      seen.push(...p.map((x) => x.externalId));
    });
    expect(seen).toEqual(["1", "2"]);
    const fetched = http.get.mock.calls.map((c: any[]) => c[0]).filter((u: string) => u.includes("lidl.nl"));
    expect(fetched.filter((u: string) => u.endsWith("/a1"))).toHaveLength(1);
  });

  it("adds the food the search finds but no shelf page shows", async () => {
    const http = fakeHttp(
      {
        "/c/assortiment-producten/s10008015": page([], ["/c/assortiment-kaas/a1"]),
        "/c/assortiment-kaas/a1": page([tile("1"), tile("2")]),
      },
      { search: [tile("2"), tile("3"), tile("4", { category: "NonFood" }), tile("5")] }
    );
    const pages: string[][] = [];
    await new LidlCatalogClient(http as any).fetchCatalog(async (p) => {
      pages.push(p.map((x) => x.externalId));
    });
    expect(pages).toEqual([["1", "2"], ["3"], ["5"]]);
  });

  it("keeps the shelf products when the search fails", async () => {
    const http = fakeHttp(
      {
        "/c/assortiment-producten/s10008015": page([], ["/c/assortiment-kaas/a1"]),
        "/c/assortiment-kaas/a1": page([tile("1")]),
      },
      { search: "fail" }
    );
    const seen: string[] = [];
    await new LidlCatalogClient(http as any).fetchCatalog(async (p) => {
      seen.push(...p.map((x) => x.externalId));
    });
    expect(seen).toEqual(["1"]);
  });

  it("follows a meta refresh", async () => {
    const http = fakeHttp({
      "/c/assortiment-producten/s10008015": page([], ["/c/assortiment-zuivel-oud/a3"]),
      "/c/assortiment-zuivel-oud/a3": '<meta http-equiv="refresh" content="0; url=/c/assortiment-zuivel/a3">',
      "/c/assortiment-zuivel/a3": page([tile("4")]),
    });
    const seen: string[] = [];
    await new LidlCatalogClient(http as any).fetchCatalog(async (p) => {
      seen.push(...p.map((x) => x.externalId));
    });
    expect(seen).toEqual(["4"]);
  });

  it("still delivers the assortment when the price dataset is unavailable", async () => {
    const http = fakeHttp(
      {
        "/c/assortiment-producten/s10008015": page([], ["/c/assortiment-kaas/a1"]),
        "/c/assortiment-kaas/a1": page([tile("1")]),
      },
      { failPrices: true }
    );
    const products: ICatalogProduct[] = [];
    await new LidlCatalogClient(http as any).fetchCatalog(async (p) => {
      products.push(...p);
    });
    expect(products.map((p) => [p.externalId, p.price])).toEqual([["1", null]]);
  });

  it("fails the run when the start page is gone", async () => {
    const http = fakeHttp({});
    await expect(new LidlCatalogClient(http as any).fetchCatalog(async () => {})).rejects.toThrow(
      "HTTP 404"
    );
  });
});
