import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../utils/Logger", () => ({
  scraperLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), setSupermarket: vi.fn() },
  serverLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const upsertBatch = vi.fn();
const markRemoved = vi.fn();
vi.mock("../controllers/PostgresCatalogController", () => ({
  default: class {
    upsertBatch = upsertBatch;
    markRemoved = markRemoved;
  },
}));

import RunService, { RunInProgressError } from "../services/RunService";
import { nextRunAfterExpiry } from "../utils/Schedule";

const END = "2026-12-06T23:59:59.000+01:00";
const offer = (name: string) => ({ name, originalPrice: 2, discountPrice: 1, expireDate: END }) as any;

function setup(opts: {
  catalog?: { fails?: boolean; offers?: boolean } | null;
  offersFail?: boolean;
}) {
  const finished: any[] = [];
  const scheduled: any[] = [];
  const dataManager = {
    db: {},
    getScraperRunController: () => ({
      createRun: vi.fn().mockResolvedValue({ id: 7, startedAt: new Date("2026-12-01T03:00:00Z") }),
      finishRun: vi.fn(async (_id: number, outcome: any) => finished.push(outcome)),
    }),
    getScheduledRunController: () => ({
      upsertScheduledRun: vi.fn(async (sm: string, expire: Date | null, at: Date) => scheduled.push({ sm, expire, at })),
    }),
    addProductDb: vi.fn().mockResolvedValue({ created: 1, updated: 1 }),
    addDiscountDb: vi.fn().mockResolvedValue({ created: 2, skipped: 0 }),
  };
  const catalogClient =
    opts.catalog === null
      ? null
      : {
          fetchCatalog: vi.fn(async (onPage: (p: any[]) => Promise<void>) => {
            if (opts.catalog?.fails) throw new Error("HTTP 404");
            await onPage([{ externalId: "1" }, { externalId: "2" }, { externalId: "3" }]);
          }),
          catalogOffers: vi.fn(() =>
            opts.catalog?.offers ? { discounts: [offer("a"), offer("b")], expireDate: END } : null
          ),
        };
  const offersClient = {
    fetchDiscounts: vi.fn(async () => {
      if (opts.offersFail) throw new Error("EAI_AGAIN");
      return { discounts: [offer("c")], expireDate: END };
    }),
  };
  const catalogFactory = vi.fn(() => catalogClient as any);
  const service = new RunService(dataManager as any, catalogFactory, () => offersClient as any);
  const run = async (sm = "Jumbo") => {
    const { runId, done } = await service.start(sm);
    await done;
    return runId;
  };
  return { service, run, finished, scheduled, dataManager, offersClient, catalogClient, catalogFactory };
}

describe("one run per supermarket", () => {
  beforeEach(() => {
    delete process.env.CATALOG_ENABLED;
    upsertBatch.mockReset().mockResolvedValue({ created: 1, updated: 2, pricesChanged: 1 });
    markRemoved.mockReset().mockResolvedValue(4);
  });

  it("takes the offers from the assortment pass when its source carries them", async () => {
    const { run, finished, scheduled, offersClient, dataManager } = setup({ catalog: { offers: true } });
    expect(await run()).toBe(7);

    expect(offersClient.fetchDiscounts).not.toHaveBeenCalled();
    expect(dataManager.addDiscountDb.mock.calls[0][0].map((d: any) => d.name)).toEqual(["a", "b"]);
    expect(finished).toEqual([
      {
        status: "success",
        errorMessage: undefined,
        metrics: expect.objectContaining({
          catalogProducts: 3,
          catalogPricesChanged: 1,
          catalogProductsRemoved: 4,
          productsScraped: 2,
          discountsCreated: 2,
          promotionExpireDate: new Date(END),
        }),
      },
    ]);
    // Next run from the end of the offers (utils/Schedule.ts decides the time).
    expect(scheduled[0].expire).toEqual(new Date(END));
    expect(Math.abs(scheduled[0].at.getTime() - nextRunAfterExpiry(new Date(END)).at.getTime())).toBeLessThan(60000);
  });

  it("uses the offers client when the assortment does not carry the offers", async () => {
    const { run, finished, offersClient } = setup({ catalog: { offers: false } });
    await run("Dirk");
    expect(offersClient.fetchDiscounts).toHaveBeenCalledTimes(1);
    expect(finished[0].status).toBe("success");
    expect(finished[0].metrics.productsScraped).toBe(1);
  });

  it("still fetches the offers when the assortment fails, and retries the run in a few hours", async () => {
    const before = Date.now();
    const { run, finished, scheduled, offersClient } = setup({ catalog: { fails: true, offers: true } });
    await run("Lidl");

    expect(offersClient.fetchDiscounts).toHaveBeenCalledTimes(1);
    expect(finished[0].status).toBe("failed");
    expect(finished[0].errorMessage).toBe("Assortment: HTTP 404");
    expect(finished[0].metrics.productsScraped).toBe(1);
    expect(scheduled[0].expire).toBeNull();
    const hours = (scheduled[0].at.getTime() - before) / 3600000;
    expect(hours).toBeGreaterThan(2.9);
    expect(hours).toBeLessThan(3.1);
  });

  it("names every failed step", async () => {
    const { run, finished } = setup({ catalog: { fails: true }, offersFail: true });
    await run();
    expect(finished[0].errorMessage).toBe("Assortment: HTTP 404; Offers: EAI_AGAIN");
  });

  it("runs the offers only with CATALOG_ENABLED=false", async () => {
    process.env.CATALOG_ENABLED = "false";
    const { run, catalogFactory, offersClient, finished } = setup({ catalog: { offers: true } });
    await run();
    expect(catalogFactory).not.toHaveBeenCalled();
    expect(offersClient.fetchDiscounts).toHaveBeenCalledTimes(1);
    expect(finished[0].metrics.catalogProducts).toBeUndefined();
  });

  it("refuses a second run of a supermarket while one is in progress", async () => {
    const { service } = setup({ catalog: { offers: true } });
    const first = await service.start("AH");
    await expect(service.start("AH")).rejects.toBeInstanceOf(RunInProgressError);
    await first.done;
    expect(service.isRunning("AH")).toBe(false);
  });
});
