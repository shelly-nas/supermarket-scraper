import { describe, it, expect, vi } from "vitest";
import moment from "moment";
import AhApiClient, { ahBonusPrice, mapAhDiscount } from "../clients/AhApiClient";
import { AhProduct } from "../clients/ah/AhMobileApi";
import { parseQuantity } from "../utils/Quantity";

vi.mock("../utils/Logger", () => ({
  scraperLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  serverLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// No real waiting between pages in tests.
vi.spyOn(global, "setTimeout").mockImplementation(((fn: () => void) => {
  fn();
  return 0 as any;
}) as any);

const NOW = new Date("2026-10-20T12:00:00+02:00");
// End of the bonus day in the local time zone, as the client writes it.
const END = moment("2026-10-25", "YYYY-MM-DD").endOf("day").toISOString(true);

const bonus = (id: number, extra: Partial<AhProduct> = {}): AhProduct => ({
  webshopId: id,
  title: `Felix product ${id}`,
  brand: "Felix",
  salesUnitSize: "6 x 48 g",
  mainCategory: "Huisdier",
  isBonus: true,
  promotionType: "NATIONAL",
  bonusStartDate: "2026-10-19",
  bonusEndDate: "2026-10-25",
  bonusMechanism: "35% korting",
  bonusSegmentDescription: "Alle Felix",
  bonusPeriodDescription: "",
  currentPrice: 1.94,
  priceBeforeBonus: 2.99,
  discountLabels: [{ code: "DISCOUNT_PERCENTAGE", percentage: 35 }],
  images: [
    { width: 800, height: 800, url: "https://img/800.jpg" },
    { width: 400, height: 400, url: "https://img/400.jpg" },
  ],
  ...extra,
});

describe("AH bonus price per item", () => {
  const price = (extra: Partial<AhProduct>, regular = 2.0) =>
    ahBonusPrice(bonus(1, { currentPrice: null, ...extra }), regular, parseQuantity(extra.salesUnitSize ?? "400 g"));

  it("uses the bonus price AH sets", () => {
    expect(ahBonusPrice(bonus(1), 2.99, null)).toBe(1.94);
  });

  it("works out multi-buy labels per item", () => {
    expect(price({ discountLabels: [{ code: "DISCOUNT_X_FOR_Y", count: 3, price: 5 }] }, 2.29)).toBe(1.67);
    expect(price({ discountLabels: [{ code: "DISCOUNT_ONE_FREE", count: 2 }] }, 2.29)).toBe(1.15);
    expect(price({ discountLabels: [{ code: "DISCOUNT_X_PLUS_Y_FREE", count: 2, freeCount: 1 }] }, 2.99)).toBe(1.99);
    expect(price({ discountLabels: [{ code: "DISCOUNT_ONE_HALF_PRICE", count: 2 }] }, 3.79)).toBe(2.84);
    expect(price({ discountLabels: [{ code: "DISCOUNT_PERCENTAGE", percentage: 25 }] }, 4.0)).toBe(3);
    expect(price({ discountLabels: [{ code: "DISCOUNT_FIXED_PRICE", price: 0.99 }] }, 1.99)).toBe(0.99);
    expect(price({ discountLabels: [{ code: "DISCOUNT_AMOUNT", amount: 1 }] }, 6.99)).toBe(5.99);
  });

  it("prices a per-100-gram bonus by the pack weight", () => {
    expect(
      price(
        { salesUnitSize: "ca. 120 g", discountLabels: [{ code: "DISCOUNT_WEIGHT", count: 100, price: 2.39, unit: "GRAM" }] },
        3.79
      )
    ).toBe(2.87);
  });

  it("falls back to the mechanism text and gives up without a lower price", () => {
    expect(price({ discountLabels: [], bonusMechanism: "2 voor 3.00" }, 2.0)).toBe(1.5);
    expect(price({ discountLabels: [{ code: "DISCOUNT_BONUS" }], bonusMechanism: "BONUS" }, 2.0)).toBeNull();
    expect(price({ discountLabels: [{ code: "DISCOUNT_X_FOR_Y", count: 2, price: 5 }] }, 2.0)).toBeNull();
  });
});

describe("AH bonus product to discount", () => {
  it("maps one product of a group bonus with pack size and price per unit", () => {
    expect(mapAhDiscount(bonus(450751), NOW)).toEqual({
      name: "Felix product 450751",
      originalPrice: 2.99,
      discountPrice: 1.94,
      unitPrice: "€6.74 per kilo",
      quantity: { value: 0.288, unit: "kg" },
      specialDiscount: "35% korting | Alle Felix",
      category: "Huisdier",
      supermarket: "Albert Heijn",
      expireDate: END,
      productUrl: "https://www.ah.nl/producten/product/wi450751",
      externalId: "450751",
      imageUrl: "https://img/400.jpg",
      brand: "Felix",
    });
  });

  it("keeps a bonus that starts later this week, with its start in the label", () => {
    const mapped = mapAhDiscount(bonus(2, { bonusPeriodDescription: "vanaf 22 okt" }), NOW);
    expect(mapped?.specialDiscount).toBe("35% korting | vanaf 22 okt | Alle Felix");
  });

  it("skips bonuses outside the weekly store bonus", () => {
    expect(mapAhDiscount(bonus(3, { promotionType: "AHONLINE" }), NOW)).toBeNull();
    expect(mapAhDiscount(bonus(4, { promotionType: "ETOS" }), NOW)).toBeNull();
    expect(mapAhDiscount(bonus(5, { promotionType: "PERPETUAL", bonusEndDate: null }), NOW)).toBeNull();
    expect(mapAhDiscount(bonus(6, { bonusSegmentDescription: "Voordeelshop" }), NOW)).toBeNull();
    expect(mapAhDiscount(bonus(7, { bonusEndDate: "2026-10-18" }), NOW)).toBeNull();
    expect(mapAhDiscount(bonus(8, { isBonus: false }), NOW)).toBeNull();
  });

  it("has no price per unit when the pack size is not a quantity", () => {
    const mapped = mapAhDiscount(bonus(9, { salesUnitSize: "4 pers | 30 min" }), NOW);
    expect(mapped?.quantity).toBeNull();
    expect(mapped?.unitPrice).toBeNull();
  });
});

describe("AH offers client", () => {
  it("lists the bonus products of every category once, with the folder end as run expiry", async () => {
    const pages: Record<string, any> = {
      "1:0": { products: [bonus(1), bonus(2)], page: { totalPages: 2 } },
      "1:1": { products: [bonus(3, { promotionType: "AHONLINE" })], page: { totalPages: 2 } },
      "2:0": { products: [bonus(2), bonus(4, { bonusEndDate: "2026-12-27" })], page: { totalPages: 1 } },
    };
    const http = {
      defaults: { headers: { common: {} as Record<string, string> } },
      post: vi.fn().mockResolvedValue({ data: { access_token: "token" } }),
      get: vi.fn().mockImplementation(async (url: string, config?: any) => {
        if (url.endsWith("/categories")) return { data: [{ id: 1, name: "Huisdier" }, { id: 2, name: "Speelgoed" }] };
        expect(config.params.filters).toBe("bonus=Bonus");
        return { data: pages[`${config.params.taxonomyId}:${config.params.page}`] };
      }),
    };

    const { discounts, expireDate } = await new AhApiClient(http as any).fetchDiscounts();

    expect(discounts.map((d) => d.externalId)).toEqual(["1", "2", "4"]);
    expect(expireDate).toBe(END);
    expect(http.defaults.headers.common.Authorization).toBe("Bearer token");
  });
});
