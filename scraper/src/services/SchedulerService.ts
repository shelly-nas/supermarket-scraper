import cron from "node-cron";
import { serverLogger } from "../utils/Logger";
import PostgresDataManager from "../data/PostgresDataManager";
import RunService, { RunInProgressError } from "./RunService";
import { RETRY_HOURS, STALE_AFTER_DAYS, retryAfter } from "../utils/Schedule";
import { SUPERMARKETS } from "../api/ProductSearch";

/**
 * Starts each supermarket's run (assortment and offers, see RunService) when
 * it is due. The run schedules the next one itself: after its offers end, or
 * a retry a few hours later when it failed (utils/Schedule.ts).
 *
 * Safety net: every supermarket has a schedule row, and one without a
 * successful run in STALE_AFTER_DAYS (or never) runs anyway, at most once per
 * RETRY_HOURS. While a run is in progress its next run is set to a retry, so a
 * run that never finishes is tried again too.
 */
class SchedulerService {
  private cronJob: cron.ScheduledTask | null = null;
  private isRunning = false;

  constructor(
    private dataManager: PostgresDataManager,
    private runService: RunService
  ) {}

  /**
   * Start the scheduler to check for due runs every minute
   */
  public start(): void {
    if (this.cronJob) {
      serverLogger.warn("Scheduler is already running");
      return;
    }

    serverLogger.debug("Starting scheduler service...");

    // Run every minute
    this.cronJob = cron.schedule("* * * * *", async () => {
      await this.checkAndRunDueScrapers();
    });

    const catalog = process.env.CATALOG_ENABLED === "false" ? "offers only (CATALOG_ENABLED=false)" : "assortment and offers";
    serverLogger.info(
      `Scheduler service started (checks every minute; run: ${catalog}; rerun after ${STALE_AFTER_DAYS} days without success)`
    );
  }

  /**
   * Stop the scheduler
   */
  public stop(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
      serverLogger.info("Scheduler service stopped");
    }
  }

  /**
   * Check for due runs and start them
   */
  private async checkAndRunDueScrapers(): Promise<void> {
    if (this.isRunning) {
      serverLogger.debug("Scheduler check already in progress, skipping...");
      return;
    }

    this.isRunning = true;

    try {
      // First, deactivate any expired discounts
      const discountController = this.dataManager.getDiscountController();
      const deactivatedCount =
        await discountController.deactivateExpiredDiscounts();
      if (deactivatedCount > 0) {
        serverLogger.info(`Deactivated ${deactivatedCount} expired discounts`);
      }

      const scheduledRunController = this.dataManager.getScheduledRunController();
      const added = await scheduledRunController.ensureScheduledRuns(SUPERMARKETS.map((s) => s.name));
      if (added > 0) serverLogger.info(`Scheduled a first run for ${added} supermarket(s)`);

      const dueRuns = await scheduledRunController.getDueScheduledRuns(STALE_AFTER_DAYS, RETRY_HOURS);
      if (dueRuns.length === 0) {
        serverLogger.debug("No due scraper runs at this time");
        return;
      }

      for (const run of dueRuns) {
        // Provisional next run: a retry, replaced when the run finishes.
        const retryAt = retryAfter();
        await scheduledRunController.updateNextRunTime(run.supermarket, retryAt);

        if (this.runService.isRunning(run.supermarket)) {
          serverLogger.warn(`Run for ${run.supermarket} is still in progress; next check ${retryAt.toISOString()}`);
          continue;
        }

        // In the background, so supermarkets due at the same time run side by side.
        serverLogger.info(`Starting the due run for ${run.supermarket}`);
        this.runService.start(run.supermarket).catch((error) => {
          if (error instanceof RunInProgressError) return;
          serverLogger.error(`Run for ${run.supermarket} could not start:`, error?.message ?? error);
        });
      }
    } catch (error) {
      serverLogger.error("Error checking for due scrapers:", error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Get scheduler status
   */
  public getStatus(): { running: boolean; isProcessing: boolean } {
    return {
      running: this.cronJob !== null,
      isProcessing: this.isRunning,
    };
  }
}

export default SchedulerService;
