import { describe, it, expect } from "vitest";
import { localTimeOn, nextRunAfterExpiry, retryAfter } from "../utils/Schedule";

const at = (iso: string) => new Date(iso);

describe("local time in Amsterdam", () => {
  it("is 03:00 Dutch time the next day, in summer and in winter time", () => {
    // End of Sunday 25 Oct 2026, the day summer time ends: Monday 03:00 is winter time (UTC+1).
    expect(localTimeOn(at("2026-10-25T22:59:59.999Z"), 1, 3).toISOString()).toBe("2026-10-26T02:00:00.000Z");
    expect(localTimeOn(at("2026-10-20T12:00:00Z"), 1, 3).toISOString()).toBe("2026-10-21T01:00:00.000Z");
    expect(localTimeOn(at("2026-11-10T12:00:00Z"), 1, 3).toISOString()).toBe("2026-11-11T02:00:00.000Z");
  });

  it("uses the Dutch calendar date, not the UTC one", () => {
    // 23:30 UTC on 24 Oct is already 25 Oct in Amsterdam.
    expect(localTimeOn(at("2026-10-24T23:30:00Z"), 1, 3).toISOString()).toBe("2026-10-26T02:00:00.000Z");
  });
});

describe("next run after an offers run", () => {
  const now = at("2026-10-20T08:00:00Z"); // Tuesday morning

  it("runs the day after the offers end, at 03:00", () => {
    // AH week ends Sunday 25 Oct.
    const next = nextRunAfterExpiry(at("2026-10-25T22:59:59.999Z"), now);
    expect(next).toEqual({ at: at("2026-10-26T02:00:00.000Z"), reason: "expiry" });
    // Jumbo week ends Tuesday 20 Oct: Wednesday 03:00 (summer time, UTC+2).
    expect(nextRunAfterExpiry(at("2026-10-20T21:59:59.999Z"), now).at).toEqual(at("2026-10-21T01:00:00.000Z"));
  });

  it("retries in 3 hours without an end date or when it has already passed", () => {
    expect(nextRunAfterExpiry(null, now)).toEqual({ at: at("2026-10-20T11:00:00Z"), reason: "retry" });
    expect(nextRunAfterExpiry(at("invalid"), now).reason).toBe("retry");
    // Still showing last week's offers that ended Sunday.
    expect(nextRunAfterExpiry(at("2026-10-18T21:59:59Z"), now).reason).toBe("retry");
    // Ends today: the run would be due before now.
    expect(nextRunAfterExpiry(at("2026-10-19T21:59:59Z"), now).reason).toBe("retry");
  });

  it("runs after at most 7 days when the end date is far away", () => {
    const next = nextRunAfterExpiry(at("2999-12-31T22:59:59Z"), now);
    expect(next).toEqual({ at: at("2026-10-27T02:00:00.000Z"), reason: "max-interval" });
  });

  it("schedules a provisional retry while a run is in progress", () => {
    expect(retryAfter(now)).toEqual(at("2026-10-20T11:00:00Z"));
  });
});
