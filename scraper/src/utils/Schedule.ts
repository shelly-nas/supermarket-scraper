/**
 * When the next weekly run of a supermarket (catalog, then offers) is due.
 *
 * Each supermarket has its own offers week (AH, Lidl and Aldi Monday to
 * Sunday; Jumbo, Dirk and Hoogvliet Wednesday to Tuesday), so the run follows
 * the end of its offers: the first 03:00 Dutch time after it. Not at
 * midnight, so the supermarket has published its new week. "First 03:00
 * after" rather than "the next day" also copes with end times in another
 * time zone (Dirk sends 23:59 UTC, which is already 01:59 the next day). Fallbacks keep a missed or odd date from stalling
 * the data:
 *
 * - no end date, or one that has already passed (the site still showed the
 *   old week, or the date was read wrongly): try again in RETRY_HOURS;
 * - an end date further away than MAX_DAYS_BETWEEN_RUNS (a long-running
 *   promotion took over): run after at most that many days anyway.
 */

export const TIME_ZONE = "Europe/Amsterdam";
export const RUN_HOUR = 3;
export const RETRY_HOURS = 3;
export const MAX_DAYS_BETWEEN_RUNS = 7;

const HOUR_MS = 60 * 60 * 1000;

export type NextRunReason = "expiry" | "retry" | "max-interval";

/** Offset of the time zone from UTC in minutes at the given instant (60 or 120 for Amsterdam). */
function offsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/** The calendar date (year, month, day) of an instant in the time zone. */
function localDate(at: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/**
 * The instant of `hour`:00 local time, `addDays` calendar days after the
 * local date of `at`. Daylight saving changes are taken into account.
 */
export function localTimeOn(at: Date, addDays: number, hour: number, timeZone = TIME_ZONE): Date {
  const { year, month, day } = localDate(at, timeZone);
  const guess = new Date(Date.UTC(year, month - 1, day + addDays, hour));
  // Correct by the offset at the target time (twice, in case the first guess
  // lands on the other side of a daylight saving change).
  let result = new Date(guess.getTime() - offsetMinutes(guess, timeZone) * 60000);
  result = new Date(guess.getTime() - offsetMinutes(result, timeZone) * 60000);
  return result;
}

/** The next run after a successful run whose offers end at `expireDate`. */
export function nextRunAfterExpiry(
  expireDate: Date | null | undefined,
  now: Date = new Date()
): { at: Date; reason: NextRunReason } {
  const retry = { at: new Date(now.getTime() + RETRY_HOURS * HOUR_MS), reason: "retry" as const };
  if (!expireDate || Number.isNaN(expireDate.getTime())) return retry;

  let atExpiry = localTimeOn(expireDate, 0, RUN_HOUR);
  if (atExpiry <= expireDate) atExpiry = localTimeOn(expireDate, 1, RUN_HOUR);
  if (atExpiry <= now) return retry;

  const latest = localTimeOn(now, MAX_DAYS_BETWEEN_RUNS, RUN_HOUR);
  if (atExpiry > latest) return { at: latest, reason: "max-interval" };
  return { at: atExpiry, reason: "expiry" };
}

/**
 * The provisional next run while a run is in progress: a retry, so a run
 * that fails or never finishes is tried again. A successful run replaces it.
 */
export function retryAfter(now: Date = new Date()): Date {
  return new Date(now.getTime() + RETRY_HOURS * HOUR_MS);
}
