import { describe, it, expect, vi, beforeEach } from "vitest";

const post = vi.fn();
vi.mock("axios", () => ({ default: { post: (...args: unknown[]) => post(...args) } }));
vi.mock("node-cron", () => ({ default: { schedule: vi.fn(() => ({ stop: vi.fn() })) } }));
vi.mock("../utils/Logger", () => ({
  scraperLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  serverLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import SchedulerService from "../services/SchedulerService";
import { CatalogRunInProgressError } from "../services/CatalogService";

const flush = () => new Promise((resolve) => setImmediate(resolve));

function setup(dueSupermarkets: string[], catalogStart: (sm: string) => Promise<{ runId: number; done: Promise<void> }>) {
  const order: string[] = [];
  const nextRuns: { supermarket: string; at: Date }[] = [];
  const scheduled = {
    getDueScheduledRuns: vi.fn().mockResolvedValue(dueSupermarkets.map((supermarket) => ({ supermarket }))),
    updateNextRunTime: vi.fn(async (supermarket: string, at: Date) => {
      nextRuns.push({ supermarket, at });
      return true;
    }),
  };
  const dataManager = {
    getDiscountController: () => ({ deactivateExpiredDiscounts: vi.fn().mockResolvedValue(0) }),
    getScheduledRunController: () => scheduled,
  };
  const catalog = {
    supportedSupermarkets: ["Albert Heijn", "Jumbo"],
    start: vi.fn(async (sm: string) => {
      order.push(`catalog ${sm}`);
      return catalogStart(sm);
    }),
  };
  post.mockImplementation(async (url: string) => {
    order.push(`offers ${url.split("/").pop()}`);
    return { status: 200 };
  });
  const scheduler = new SchedulerService(dataManager as any, "3001", catalog as any);
  const check = () => (scheduler as any).checkAndRunDueScrapers() as Promise<void>;
  return { scheduler, check, order, nextRuns, catalog };
}

describe("weekly run per supermarket", () => {
  beforeEach(() => {
    post.mockReset();
    delete process.env.CATALOG_ENABLED;
  });

  it("runs the catalog first and the offers when it is done", async () => {
    let finishCatalog!: () => void;
    const { check, order } = setup(["Albert Heijn"], async () => ({
      runId: 1,
      done: new Promise<void>((resolve) => (finishCatalog = resolve)),
    }));

    await check();
    await flush();
    expect(order).toEqual(["catalog Albert Heijn"]);

    finishCatalog();
    await flush();
    expect(order).toEqual(["catalog Albert Heijn", "offers albert-heijn"]);
  });

  it("sets a retry a few hours ahead before starting, in case the run fails", async () => {
    const before = Date.now();
    const { check, nextRuns } = setup(["Jumbo"], async () => ({ runId: 1, done: Promise.resolve() }));
    await check();
    expect(nextRuns).toHaveLength(1);
    const hours = (nextRuns[0].at.getTime() - before) / 3600000;
    expect(hours).toBeGreaterThan(2.9);
    expect(hours).toBeLessThan(3.1);
  });

  it("still runs the offers when the catalog is already running or has no scraper", async () => {
    const { check, order, catalog } = setup(["Jumbo", "Lidl"], async () => {
      throw new CatalogRunInProgressError("busy");
    });
    await check();
    await flush();
    expect(catalog.start).toHaveBeenCalledTimes(1); // Lidl is not in supportedSupermarkets here
    expect(order).toEqual(["catalog Jumbo", "offers lidl", "offers jumbo"]);
  });

  it("leaves out the catalog with CATALOG_ENABLED=false", async () => {
    process.env.CATALOG_ENABLED = "false";
    const { check, order, catalog } = setup(["Albert Heijn"], async () => ({ runId: 1, done: Promise.resolve() }));
    await check();
    await flush();
    expect(catalog.start).not.toHaveBeenCalled();
    expect(order).toEqual(["offers albert-heijn"]);
  });

  it("does not start a supermarket again while its run is in progress", async () => {
    const { check, order } = setup(["Albert Heijn"], async () => ({
      runId: 1,
      done: new Promise<void>(() => {}),
    }));
    await check();
    await flush();
    await check();
    await flush();
    expect(order).toEqual(["catalog Albert Heijn"]);
  });
});
