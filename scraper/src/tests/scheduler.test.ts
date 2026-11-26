import { describe, it, expect, vi } from "vitest";

vi.mock("node-cron", () => ({ default: { schedule: vi.fn(() => ({ stop: vi.fn() })) } }));
vi.mock("../utils/Logger", () => ({
  scraperLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), setSupermarket: vi.fn() },
  serverLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import SchedulerService from "../services/SchedulerService";
import { RunInProgressError } from "../services/RunService";

function setup(dueSupermarkets: string[], running: string[] = []) {
  const nextRuns: { supermarket: string; at: Date }[] = [];
  const scheduled = {
    ensureScheduledRuns: vi.fn().mockResolvedValue(0),
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
  const runService = {
    isRunning: vi.fn((sm: string) => running.includes(sm)),
    start: vi.fn(async (_sm: string) => ({ runId: 1, done: Promise.resolve() })),
  };
  const scheduler = new SchedulerService(dataManager as any, runService as any);
  const check = () => (scheduler as any).checkAndRunDueScrapers() as Promise<void>;
  return { check, nextRuns, scheduled, runService };
}

describe("scheduler", () => {
  it("gives every supermarket a schedule row and asks for due runs with the 8-day safety net", async () => {
    const { check, scheduled } = setup([]);
    await check();
    expect(scheduled.ensureScheduledRuns).toHaveBeenCalledWith([
      "Albert Heijn",
      "Aldi",
      "Dirk",
      "Hoogvliet",
      "Jumbo",
      "Lidl",
      "PLUS",
    ]);
    expect(scheduled.getDueScheduledRuns).toHaveBeenCalledWith(8, 3);
  });

  it("sets a retry a few hours ahead, then starts the run of each due supermarket", async () => {
    const before = Date.now();
    const { check, nextRuns, runService } = setup(["Jumbo", "Lidl"]);
    await check();
    expect(runService.start.mock.calls.map((c) => c[0])).toEqual(["Jumbo", "Lidl"]);
    expect(nextRuns.map((r) => r.supermarket)).toEqual(["Jumbo", "Lidl"]);
    const hours = (nextRuns[0].at.getTime() - before) / 3600000;
    expect(hours).toBeGreaterThan(2.9);
    expect(hours).toBeLessThan(3.1);
  });

  it("does not start a supermarket again while its run is in progress", async () => {
    const { check, runService, nextRuns } = setup(["Albert Heijn"], ["Albert Heijn"]);
    await check();
    expect(runService.start).not.toHaveBeenCalled();
    expect(nextRuns).toHaveLength(1);
  });

  it("keeps going when a run is already in progress elsewhere", async () => {
    const { check, runService } = setup(["Dirk", "Aldi"]);
    runService.start.mockRejectedValueOnce(new RunInProgressError("busy"));
    await check();
    expect(runService.start).toHaveBeenCalledTimes(2);
  });
});
