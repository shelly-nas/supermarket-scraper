# Scheduling

Automatic runs (full assortment and offers) when offers expire, with a safety net for stale data. Part of the [functional design](../FUNCTIONAL_DESIGN.md).

## Epic 3: Scheduled Operations

```
US-007: Automatic Scheduled Scraping
As an administrator
I want scrapers to run automatically based on promotion schedules
So that data stays fresh without manual intervention

Acceptance Criteria:
- One run per supermarket fetches the full assortment and the offers, and schedules the next run from the offers' expiry (the first 03:00 after it)
- A supermarket without a successful run in 8 days (or ever) runs anyway
- Scheduler checks every minute for due runs
- Failed runs don't block future schedules
- Logging of all automated runs
```

```
US-008: Enable/Disable Scheduled Runs
As an administrator
I want to enable or disable scheduled runs per supermarket
So that I can control when automated scraping occurs

Acceptance Criteria:
- Toggle scheduled runs on/off per supermarket
- Status persists across system restarts
- Visual indication of enabled/disabled state
- Manual runs still work when disabled
```

## Use Case 3: Automated Scheduled Scraping

```mermaid
sequenceDiagram
    participant Cron as Cron Job (every minute)
    participant Scheduler as Scheduler Service
    participant DB as Database
    participant Run as Run Service

    loop Every minute
        Cron->>Scheduler: Trigger check
        Scheduler->>DB: Deactivate expired discounts
        Scheduler->>DB: Give every supermarket a scheduled_runs row (new ones due now)
        Scheduler->>DB: SELECT due runs (next_run_at passed, or no success in 8 days)
        DB-->>Scheduler: Due supermarkets (if any)

        alt Has due runs
            loop For each due supermarket
                Scheduler->>DB: next_run_at = retry in 3 hours
                Scheduler->>Run: start(supermarket), in the background
                Run->>DB: Assortment (regular prices)
                Run->>DB: Offers (from the same pass where the source carries them)
                Run->>DB: One scraper_runs row; next run after the offers end, or a retry
            end
        else No due runs
            Scheduler->>Scheduler: Log "No due runs"
        end
    end
```

**Preconditions:**

- Scheduler service is running
- The supermarket's scheduled_run is enabled
- Its next_run_at has passed, or it has no successful run in the last 8 days and no run started in the last 3 hours

**Main Flow:**

1. Cron job triggers every minute
2. Scheduler checks for expired discounts
3. System deactivates discounts where expire_date < NOW()
4. Scheduler gives every supermarket a scheduled_runs row (a new one is due right away)
5. Scheduler queries for due runs (FR-003.12)
6. For each due run:
   - Scheduler sets next_run_at to a retry 3 hours later (fallback)
   - Scheduler starts the supermarket's run in the background (FR-003.9)
   - The run sets next_run_at from the offers' end date, or a retry 3 hours later when a step failed (FR-003.2, FR-003.10)
7. Scheduler waits for the next cycle

**Postconditions:**

- Expired discounts marked as inactive
- Due scrapers executed
- Next run times updated
- All operations logged

**Alternative Flows:**

- **4a**: No due runs → Log "No due runs", wait for next cycle
- **6a**: Run cannot start → Log error, continue with the other supermarkets
- **6b**: Run still in progress → Skip, check again at the retry time
- **6c**: Assortment step fails → the offers come from the supermarket's offers client; the run is logged as failed and retried in 3 hours
- **6d**: Offers step fails → the run is logged as failed and retried in 3 hours

## FR-003: Scheduling System

| ID       | Requirement                                                            | Priority | Status         |
| -------- | ---------------------------------------------------------------------- | -------- | -------------- |
| FR-003.1 | System SHALL check for due scraper runs every minute                   | HIGH     | ✅ Implemented |
| FR-003.2 | System SHALL schedule the next run at the first 03:00 Europe/Amsterdam after the offers end (the run's expiry, FR-001.5), not at midnight, so the supermarket has published its new week. Measured in October 2026: AH, Lidl and Aldi end on Sunday (run Monday 03:00), Jumbo, Dirk and Hoogvliet on Tuesday (run Wednesday 03:00); Dirk's end time in UTC (23:59Z = 01:59 local) still gives Wednesday 03:00 | HIGH     | ✅ Implemented |
| FR-003.3 | System SHALL support enable/disable toggle per supermarket             | MEDIUM   | ✅ Implemented |
| FR-003.4 | System SHALL NOT run multiple instances of same scraper concurrently   | HIGH     | ✅ Implemented |
| FR-003.5 | System SHALL deactivate expired discounts on each scheduler check      | HIGH     | ✅ Implemented |
| FR-003.6 | System SHALL log all scheduler activities                              | MEDIUM   | ✅ Implemented |
| FR-003.7 | System SHALL persist scheduled run state across restarts               | MEDIUM   | ✅ Implemented |
| FR-003.8 | System SHALL start runs directly through the run service (the same one behind `POST /api/scraper/run/:supermarket`) | MEDIUM   | ✅ Implemented |
| FR-003.9 | System SHALL fetch a supermarket's full assortment and its offers in one run, logged as one `scraper_runs` row, so regular prices and offers change on the supermarket's own week (AH Monday to Sunday, others their own). Where the assortment source carries the promotions (AH, Jumbo, Hoogvliet, PLUS) the offers come from that same pass; Dirk, Aldi and Lidl fetch their offers in the same run from their offers source. A failed assortment step does not stop the offers | HIGH | ✅ Implemented |
| FR-003.10 | System SHALL fall back when a date is missed: (a) while a run is in progress the next run is set to a retry 3 hours later, replaced when the run finishes (after the offers end on success, a retry 3 hours later on failure), so a failed or hanging run is retried; (b) offers without an end date, or whose end date has already passed (the site still showed the old week), are fetched again 3 hours later; (c) runs are never more than 7 days apart, also when the end date is further away; (d) a run that was due while the server was down starts on the next check | HIGH | ✅ Implemented |
| FR-003.11 | System SHALL keep the per-supermarket enabled setting when a run updates the schedule, so a manual run does not switch the automatic runs back on | MEDIUM | ✅ Implemented |
| FR-003.12 | System SHALL run a supermarket anyway when its last successful run is older than 8 days or it never had one (an empty database, a schedule that went wrong), at most once per 3 hours | HIGH | ✅ Implemented |
| FR-003.13 | System SHALL give every supermarket a schedule row, due right away when new, and close runs left "running" by a restart as failed | HIGH | ✅ Implemented |
