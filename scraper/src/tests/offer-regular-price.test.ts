import { describe, it, expect, vi } from "vitest";
import { pickByQuantity } from "../controllers/PostgresProductController";
import { keepsObservedPrice, OBSERVED_PRICE_MAX_AGE_DAYS } from "../controllers/PostgresCatalogController";
import { offerReplacesPrice } from "../controllers/PostgresProductController";
import PostgresDataManager from "../data/PostgresDataManager";

vi.mock("../data/PostgresDataContext", () => ({
  default: { getInstance: vi.fn().mockReturnValue({}) },
}));
vi.mock("../config/database", () => ({ getDatabaseConfig: vi.fn().mockReturnValue({}) }));
vi.mock("../utils/Logger", () => ({
  scraperLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  serverLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const kg = (value: number) => ({ value, unit: "kg" as const });

describe("pickByQuantity", () => {
  it("takes the variant with the offer's pack quantity", () => {
    const rows = [
      { id: 1, quantity: kg(0.5) },
      { id: 2, quantity: kg(1) },
    ];
    expect(pickByQuantity(rows, kg(1))).toBe(2);
    expect(pickByQuantity(rows, kg(0.75))).toBeNull();
    expect(pickByQuantity(rows, null)).toBeNull();
  });

  it("takes a single row when one side does not know its quantity", () => {
    expect(pickByQuantity([{ id: 1, quantity: null }], kg(1))).toBe(1);
    expect(pickByQuantity([{ id: 1, quantity: kg(1) }], null)).toBe(1);
    expect(pickByQuantity([{ id: 1, quantity: kg(0.5) }], kg(1))).toBeNull();
    expect(pickByQuantity([], kg(1))).toBeNull();
  });

  it("links nothing when two rows have the same quantity", () => {
    expect(pickByQuantity([{ id: 1, quantity: kg(1) }, { id: 2, quantity: kg(1) }], kg(1))).toBeNull();
  });
});

describe("keepsObservedPrice", () => {
  const now = new Date("2026-10-17T12:00:00Z");
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);
  const observed = (days: number) => ({
    regular_price: "1.65",
    price_source: "supermarket",
    price_observed_at: daysAgo(days),
  });

  it("keeps a recent price of the supermarket's own over a lower checkjebon price or none", () => {
    expect(keepsObservedPrice(observed(10), { price: 1.38, priceSource: "checkjebon" }, now)).toBe(true);
    expect(keepsObservedPrice(observed(10), { price: 1.65, priceSource: "checkjebon" }, now)).toBe(true);
    expect(keepsObservedPrice(observed(10), { price: null, priceSource: null }, now)).toBe(true);
  });

  it("lets a higher checkjebon price replace it: the worst case, prices mostly go up", () => {
    expect(keepsObservedPrice(observed(10), { price: 1.79, priceSource: "checkjebon" }, now)).toBe(false);
  });

  it("takes the catalog's own price and lets an old observation go", () => {
    expect(keepsObservedPrice(observed(10), { price: 1.49, priceSource: "supermarket" }, now)).toBe(false);
    const old = observed(OBSERVED_PRICE_MAX_AGE_DAYS + 1);
    expect(keepsObservedPrice(old, { price: 1.38, priceSource: "checkjebon" }, now)).toBe(false);
  });

  it("does not keep a checkjebon price or a row without a price", () => {
    const checkjebon = { ...observed(1), price_source: "checkjebon" };
    expect(keepsObservedPrice(checkjebon, { price: 1.38, priceSource: "checkjebon" }, now)).toBe(false);
    const empty = { ...observed(1), regular_price: null };
    expect(keepsObservedPrice(empty, { price: 1.38, priceSource: "checkjebon" }, now)).toBe(false);
  });
});

describe("offer with a regular price and its own article number", () => {
  const offer: IProductDiscountDetails = {
    name: "Yakult",
    originalPrice: 3.94,
    discountPrice: 2.99,
    unitPrice: null,
    specialDiscount: "",
    category: "Kaas, zuivelproducten & eieren",
    supermarket: "Lidl",
    expireDate: "2026-10-18T23:59:59+02:00",
    productUrl: null,
    externalId: "11305717",
    quantity: { value: 0.52, unit: "l" },
    articleNumbers: ["6611698"],
    regularPrice: 3.94,
  };

  const makeDataManager = () => {
    const dm = new PostgresDataManager();
    (dm as any).productController = {
      addProductByExternalId: vi.fn().mockResolvedValue({ id: 42, wasCreated: false }),
      getProductIdByExternalId: vi.fn().mockResolvedValue(42),
      setRegularPriceFromOffer: vi.fn().mockResolvedValue(true),
      setOfferDetails: vi.fn().mockResolvedValue(undefined),
    };
    (dm as any).discountController = { addDiscountSmart: vi.fn().mockResolvedValue(7) };
    (dm as any).scraperRunController = { getLastSuccessfulRunBySupermarket: vi.fn().mockResolvedValue(null) };
    return dm;
  };

  it("links the product by article number and stores the regular price on it", async () => {
    const dm = makeDataManager();
    await dm.addProductDb("Lidl", [offer]);
    const products = (dm as any).productController;
    expect(products.addProductByExternalId).toHaveBeenCalledWith(
      "Yakult", offer.category, "Lidl", null, "11305717",
      { articleNumbers: ["6611698"], quantity: { value: 0.52, unit: "l" } }
    );
    expect(products.setRegularPriceFromOffer).toHaveBeenCalledWith(42, 3.94);
  });

  it("finds the same product for the discount", async () => {
    const dm = makeDataManager();
    await dm.addDiscountDb([offer], "Lidl", new Date());
    expect((dm as any).productController.getProductIdByExternalId).toHaveBeenCalledWith(
      "11305717", "Lidl", { articleNumbers: ["6611698"], quantity: { value: 0.52, unit: "l" } }
    );
    expect((dm as any).discountController.addDiscountSmart.mock.calls[0][0]).toBe(42);
  });

  it("stores no regular price for an offer without one", async () => {
    const dm = makeDataManager();
    await dm.addProductDb("Lidl", [{ ...offer, regularPrice: null, articleNumbers: undefined }]);
    const products = (dm as any).productController;
    expect(products.setRegularPriceFromOffer).not.toHaveBeenCalled();
    expect(products.addProductByExternalId.mock.calls[0][5]).toBeUndefined();
  });
});

describe("offerReplacesPrice", () => {
  it("lets the regular price Lidl shows next to an offer replace the stored one", () => {
    expect(offerReplacesPrice({ regular_price: null, price_source: null }, 2.49)).toBe(true);
    expect(offerReplacesPrice({ regular_price: "2.29", price_source: "checkjebon" }, 2.49)).toBe(true);
    expect(offerReplacesPrice({ regular_price: "2.79", price_source: "supermarket" }, 2.49)).toBe(true);
  });

  it("keeps a higher price from an outside dataset", () => {
    expect(offerReplacesPrice({ regular_price: "2.79", price_source: "checkjebon" }, 2.49)).toBe(false);
  });
});
