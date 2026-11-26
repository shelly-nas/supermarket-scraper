import { describe, it, expect, vi } from "vitest";
import JumboGraphql, { JumboProduct, jumboQuantity, promotionDay } from "../clients/jumbo/JumboGraphql";
import JumboCatalogClient, { mapJumboProduct } from "../clients/catalog/JumboCatalogClient";
import { mapJumboDiscount } from "../clients/JumboApiClient";
import { ICatalogProduct } from "../interfaces/ICatalogProduct";

vi.mock("../utils/Logger", () => ({
  scraperLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  serverLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// No real waiting between requests in tests.
vi.spyOn(global, "setTimeout").mockImplementation(((fn: () => void) => {
  fn();
  return 0 as any;
}) as any);

const product = (sku: string, extra: Partial<JumboProduct> = {}): JumboProduct => ({
  sku,
  title: `Jumbo Product ${sku} 400 g`,
  brand: "Jumbo",
  category: "Zuivel, boter en eieren",
  subtitle: "400 g",
  image: `https://img/${sku}.png`,
  link: `/producten/product-${sku}`,
  inAssortment: true,
  price: { price: 379, promoPrice: null, pricePerUnit: { price: 948, unit: "kg" } },
  promotions: [],
  ...extra,
});

const promo = (tags: string[], end: { date: number; monthShort: string } | null = { date: 20, monthShort: "okt" }) => ({
  id: "1",
  tags: tags.map((text) => ({ text })),
  start: end ? { date: 14, monthShort: "okt" } : null,
  end,
});

const NOW = new Date(2026, 9, 16, 10, 0, 0); // 16 Oct 2026
const FOLDER_END = "2026-10-20T23:59:59.000+02:00";

describe("Jumbo product fields", () => {
  it("reads the quantity from pack size, title or price per unit", () => {
    expect(jumboQuantity(product("1"))).toEqual({ value: 0.4, unit: "kg" });
    expect(jumboQuantity(product("1", { subtitle: null, title: "Komkommer 6 x 1 L" }))).toEqual({ value: 6, unit: "l" });
    // 4.99 at 6.65 per kg -> 0.75 kg; pieces are rounded to whole ones.
    expect(
      jumboQuantity(product("1", {
        subtitle: null,
        title: "Zespri Kiwi",
        price: { price: 659, promoPrice: 499, pricePerUnit: { price: 665, unit: "kg" } },
      }))
    ).toEqual({ value: 0.75, unit: "kg" });
    expect(
      jumboQuantity(product("1", {
        subtitle: null,
        title: "Bananen",
        price: { price: 169, promoPrice: null, pricePerUnit: { price: 34, unit: "pieces" } },
      }))
    ).toEqual({ value: 5, unit: "stuk" });
  });

  it("dates a promotion day without a year to its next occurrence", () => {
    expect(promotionDay({ date: 20, monthShort: "okt" }, NOW)).toEqual(new Date(2026, 9, 20, 23, 59, 59));
    expect(promotionDay({ date: 10, monthShort: "jan" }, NOW)).toEqual(new Date(2027, 0, 10, 23, 59, 59));
    expect(promotionDay(null, NOW)).toBeNull();
  });

  it("maps a catalog product at its regular price", () => {
    expect(mapJumboProduct(product("746550DS"))).toEqual<ICatalogProduct>({
      externalId: "746550DS",
      name: "Jumbo Product 746550DS 400 g",
      brand: "Jumbo",
      category: "Zuivel, boter en eieren",
      unitSize: "400 g",
      quantity: { value: 0.4, unit: "kg" },
      price: 3.79,
      priceSource: "supermarket",
      unitPrice: "€9.48 per kilo",
      imageUrl: "https://img/746550DS.png",
      productUrl: "https://www.jumbo.com/producten/product-746550DS",
      ean: null,
    });
    expect(mapJumboProduct(product("1", { inAssortment: false }))).toBeNull();
  });
});

describe("Jumbo discounts", () => {
  it("prices multi-buy offers per item", () => {
    const d = mapJumboDiscount(product("1", { promotions: [promo(["3 voor 6,00"])] }), FOLDER_END, NOW)!;
    expect(d).toMatchObject({
      originalPrice: 3.79,
      discountPrice: 2,
      specialDiscount: "3 voor 6,00",
      unitPrice: "€5.00 per kilo",
      supermarket: "Jumbo",
      externalId: "1",
      productUrl: "https://www.jumbo.com/producten/product-1",
    });
    expect(d.expireDate.startsWith("2026-10-20")).toBe(true);
  });

  it("uses the promotion price when Jumbo gives one", () => {
    const p = product("1", {
      price: { price: 219, promoPrice: 199, pricePerUnit: { price: 199, unit: "kg" } },
      promotions: [promo(["voor 1,99", "Alleen online"])],
    });
    expect(mapJumboDiscount(p, FOLDER_END, NOW)).toMatchObject({ discountPrice: 1.99, specialDiscount: "voor 1,99 | Alleen online" });
  });

  it("skips promotions that are not about the price", () => {
    const p = product("1", { promotions: [promo(["€2,00 bezorgkorting", "Bij elk stuk"]), promo(["Gratis bezorging​", "Vanaf € 12,00"])] });
    expect(mapJumboDiscount(p, FOLDER_END, NOW)).toBeNull();
  });

  it("gives standing offers without dates the folder end", () => {
    const p = product("1", { promotions: [promo(["2 voor 5,00"], null)] });
    expect(mapJumboDiscount(p, FOLDER_END, NOW)).toMatchObject({ discountPrice: 2.5, expireDate: FOLDER_END });
  });
});

describe("Jumbo catalog client", () => {
  it("pages through the assortment and skips a product Jumbo cannot return", async () => {
    // 5 products in the assortment; the one at position 3 nulls every page it is on.
    const all = ["a", "b", "c", "d", "e"].map((s) => product(s));
    const http = {
      post: vi.fn().mockImplementation(async (_url: string, body: any) => {
        const { offSet, limit } = body.variables.input;
        const range = all.slice(offSet, offSet + limit);
        if (offSet <= 3 && offSet + limit > 3) {
          return { data: { data: null, extensions: { valueCompletion: [{ message: "Cannot return null" }] } } };
        }
        return { data: { data: { searchProducts: { count: all.length, products: range } } } };
      }),
    };
    const pages: ICatalogProduct[][] = [];
    await new JumboCatalogClient(http as any).fetchCatalog(async (p) => {
      pages.push(p);
    });
    expect(pages.flat().map((p) => p.externalId)).toEqual(["a", "b", "c", "e"]);
  });

  it("keeps the offers it saw on the way, so one run fetches both", async () => {
    const all = [product("a", { promotions: [promo(["3 voor 6,00"])] }), product("b")];
    const http = {
      post: vi.fn().mockResolvedValue({ data: { data: { searchProducts: { count: all.length, products: all } } } }),
    };
    const client = new JumboCatalogClient(http as any);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    try {
      await client.fetchCatalog(async () => {});
      const { discounts, expireDate } = client.catalogOffers();
      expect(discounts.map((d) => d.externalId)).toEqual(["a"]);
      expect(expireDate).toBe(FOLDER_END);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry GraphQL errors", async () => {
    const http = { post: vi.fn().mockResolvedValue({ data: { errors: [{ message: "No client headers set" }] } }) };
    await expect(new JumboGraphql(http as any).forEachPage(async () => {})).rejects.toThrow(
      "Jumbo products 1-200: No client headers set"
    );
    expect(http.post).toHaveBeenCalledTimes(1);
  });
});
