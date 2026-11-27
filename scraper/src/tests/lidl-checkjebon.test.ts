import { describe, it, expect, vi } from "vitest";

vi.mock("../utils/Logger", () => ({
  scraperLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  serverLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { checkjebonAdditions, learnLidlFood } from "../clients/lidl/LidlCheckjebon";
import { training } from "./fixtures/ahTraining";
import { nameFeatures, NameClassifier } from "../utils/NameClassifier";
import PostgresCatalogController from "../controllers/PostgresCatalogController";

const row = (n: string, l: string, p = 1.99, s = "") => ({ n, l, p, s });

describe("name classifier", () => {
  it("reads a compound by its 4-letter pieces", () => {
    const features = nameFeatures("Bergkaas");
    expect(features.has("w:bergkaas")).toBe(true);
    expect(features.has("kaas")).toBe(true);
    expect(nameFeatures("Stellingkast-0452484").has("w:stellingkast")).toBe(true);
    expect([...nameFeatures("Stellingkast-0452484")].some((f) => f.includes("045"))).toBe(false);
  });

  it("picks the label whose names share the most pieces", () => {
    const model = new NameClassifier([
      ...Array(10).fill({ name: "Jonge kaas", label: "food" }),
      ...Array(10).fill({ name: "Wasmiddel", label: "nonfood" }),
    ]);
    expect(model.best("Bergkaas")).toBe("food");
    expect(model.best("Wasmiddel color")).toBe("nonfood");
    expect(model.probabilities("Xyzzy", false)).toBeNull();
  });
});

describe("checkjebon additions for Lidl", () => {
  const model = learnLidlFood(training(), [row("Tuinslang-0452484", "452484", 9.99)])!;

  it("learns nothing from too small a catalog", () => {
    expect(learnLidlFood(training().slice(0, 50), [])).toBeNull();
  });

  it("tells food from non-food and gives the Lidl category", () => {
    expect(model.isFood("Oude kaas")).toBe(true);
    expect(model.isFood("Wasmiddel wit")).toBe(false);
    expect(model.isFood("Kattenmousse kip")).toBe(false); // pet food reads like food
    expect(model.isFood("Purina one kip")).toBe(false);
    expect(model.category("Oude kaas")).toBe("Kaas, zuivelproducten & eieren");
    expect(model.category("Pils blik")).toBe("Bier & Cider");
    expect(model.category("Rode wijn Merlot")).toBe("Wijn");
  });

  it("adds only food lidl.nl did not show, once, as add-only rows", () => {
    const rows = [
      row("Oude kaas", "0001234", 3.49, "500 g"),
      row("Oude kaas", "1234"), // same article number again
      row("Geitenkaas", "2222"), // same name as a product lidl.nl showed
      row("Belegen kaas plakken", "3333"), // article number lidl.nl showed (nat)
      row("Volle yoghurt", "4444", 0.01), // bogus price
      row("Tuinslang-0452484", "452484", 9.99), // webshop article
      row("Wasmiddel wit", "5555"),
      row("Halfvolle melk", "6666", 1.15, "1 L"),
    ];
    const seen = { articleNumbers: new Set(["00003333"]), names: new Set(["geitenkaas"]) };
    const additions = checkjebonAdditions(rows, seen, model);

    expect(additions.map((a) => a.name)).toEqual(["Oude kaas", "Halfvolle melk"]);
    expect(additions[0]).toEqual({
      externalId: "1234",
      name: "Oude kaas",
      brand: null,
      category: "Kaas, zuivelproducten & eieren",
      unitSize: "500 g",
      price: 3.49,
      priceSource: "checkjebon",
      unitPrice: null,
      imageUrl: null,
      productUrl: null,
      articleNumber: "1234",
      addOnly: true,
    });
  });
});

/** A database client that answers the add-only queries and records every statement. */
type Match = {
  id: number;
  regular_price: string | null;
  catalog_source: string | null;
  price_source?: string | null;
  price_observed_at?: Date | null;
};

function fakeDb(matches: Match[]) {
  const statements: string[] = [];
  const client = {
    query: vi.fn(async (sql: string) => {
      statements.push(sql.replace(/\s+/g, " ").trim());
      if (sql.includes("catalog_source, catalog_updated_at FROM products")) {
        return { rows: matches.map((m) => ({ ...m, catalog_updated_at: null })) };
      }
      if (sql.includes("INSERT INTO products")) return { rows: [{ id: 99 }] };
      return { rows: [] };
    }),
  };
  const db = { transaction: async (fn: (c: typeof client) => Promise<void>) => fn(client) };
  return { db, statements };
}

describe("add-only catalog products", () => {
  const product = {
    externalId: "1234",
    name: "Oude kaas",
    brand: null,
    category: "Kaas, zuivelproducten & eieren",
    unitSize: "500 g",
    price: 3.49,
    priceSource: "checkjebon",
    unitPrice: null,
    imageUrl: null,
    productUrl: null,
    articleNumber: "1234",
    addOnly: true,
  };
  const store = async (matches: Parameters<typeof fakeDb>[0]) => {
    const { db, statements } = fakeDb(matches);
    const metrics = await new PostgresCatalogController(db as any).upsertBatch("Lidl", [product], new Date());
    return { metrics, statements };
  };

  it("inserts a product no row has, marked as the dataset's", async () => {
    const { metrics, statements } = await store([]);
    expect(metrics.created).toBe(1);
    const insert = statements.find((s) => s.startsWith("INSERT INTO products"))!;
    expect(insert).toContain("catalog_source");
  });

  it("never touches a row from the supermarket itself or an offer", async () => {
    const { metrics, statements } = await store([{ id: 5, regular_price: "2.99", catalog_source: null }]);
    expect(metrics).toEqual({ created: 0, updated: 0, pricesChanged: 0 });
    expect(statements.filter((s) => !s.startsWith("SELECT"))).toEqual([]);
  });

  it("leaves everything alone when its own row and another row match", async () => {
    const { statements } = await store([
      { id: 5, regular_price: "2.99", catalog_source: "checkjebon" },
      { id: 6, regular_price: "2.99", catalog_source: null },
    ]);
    expect(statements.filter((s) => !s.startsWith("SELECT"))).toEqual([]);
  });

  it("keeps a regular price Lidl showed next to an offer on a row it added", async () => {
    const { metrics, statements } = await store([
      { id: 5, regular_price: "2.99", catalog_source: "checkjebon", price_source: "supermarket", price_observed_at: new Date() },
    ]);
    expect(metrics).toEqual({ created: 0, updated: 1, pricesChanged: 0 });
    expect(statements.filter((s) => s.startsWith("UPDATE"))).toEqual([
      "UPDATE products SET in_catalog = true, catalog_updated_at = NOW() WHERE id = $1",
    ]);
  });

  it("only refreshes the price of a row it added itself", async () => {
    const { metrics, statements } = await store([{ id: 5, regular_price: "2.99", catalog_source: "checkjebon" }]);
    expect(metrics).toEqual({ created: 0, updated: 1, pricesChanged: 1 });
    const update = statements.find((s) => s.startsWith("UPDATE products"))!;
    expect(update).toBe(
      "UPDATE products SET regular_price = $2, price_source = $3, in_catalog = true, catalog_updated_at = NOW() WHERE id = $1"
    );
  });
});

describe("the supermarket's own data and dataset rows", () => {
  it("takes over a row the dataset added under the same article number", async () => {
    const statements: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        statements.push(sql.replace(/\s+/g, " ").trim());
        if (sql.includes("catalog_source IS NOT NULL")) {
          return { rows: [{ id: 5, regular_price: "3.49", price_source: "checkjebon", price_observed_at: null }] };
        }
        return { rows: [] };
      }),
    };
    const db = { transaction: async (fn: (c: typeof client) => Promise<void>) => fn(client) };
    const fromSite = {
      externalId: "9000123",
      name: "Milbona Oude kaas",
      brand: "Milbona",
      category: "Kaas, zuivelproducten & eieren",
      unitSize: "500 g",
      price: 3.59,
      priceSource: "checkjebon",
      unitPrice: null,
      imageUrl: "https://img/1.jpg",
      productUrl: "https://www.lidl.nl/p/1",
      articleNumber: "1234",
    };
    const metrics = await new PostgresCatalogController(db as any).upsertBatch("Lidl", [fromSite], new Date());

    expect(metrics.updated).toBe(1);
    const update = statements.find((s) => s.startsWith("UPDATE products"))!;
    expect(update).toContain("catalog_source = NULL");
    expect(statements.some((s) => s.startsWith("INSERT INTO products"))).toBe(false);
  });
});

