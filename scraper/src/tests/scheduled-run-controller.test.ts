import { describe, it, expect, vi } from "vitest";

vi.mock("../utils/Logger", () => ({
  scraperLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  serverLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import PostgresScheduledRunController from "../controllers/PostgresScheduledRunController";

describe("scheduling the next run", () => {
  it("casts every use of the time parameters, so Postgres can type them", async () => {
    // Uncast, Postgres failed with "inconsistent types deduced for parameter $2"
    // and no run could schedule its next one (November 2026).
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 1 }] });
    await new PostgresScheduledRunController({ query } as any).upsertScheduledRun("Lidl", null, new Date());

    const sql: string = query.mock.calls[0][0];
    const uses = sql.match(/\$[23](?:::\w+)?/g) ?? [];
    expect(uses.length).toBeGreaterThan(0);
    expect(uses.every((use) => use.endsWith("::timestamp"))).toBe(true);
    expect(query.mock.calls[0][1]).toEqual(["Lidl", expect.any(Date), null]);
  });
});
