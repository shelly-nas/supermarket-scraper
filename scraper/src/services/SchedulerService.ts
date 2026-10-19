import cron from "node-cron";
import { serverLogger } from "../utils/Logger";
import PostgresDataManager from "../data/PostgresDataManager";
import axios from "axios";
import CatalogService, { CatalogRunInProgressError } from "./CatalogService";
import { retryAfter } from "../utils/Schedule";

// Map full names to the URL params of the run endpoint.
const SUPERMARKET_KEYS: { [key: string]: string } = {
  "Albert Heijn": "albert-heijn",
  Aldi: "aldi",
  Dirk: "dirk",
  Hoogvliet: "hoogvliet",
  Jumbo: "jumbo",
  Lidl: "lidl",
  PLUS: "plus",
};

/**
 * Runs each supermarket's weekly run when it is due: first the full catalog
 * (regular prices), then the offers, so both change on the supermarket's own
 * week. The offers run schedules the next one (utils/Schedule.ts).
 *
 * While a run is in progress the next one is set to a retry in a few hours,
 * so a run that fails or never finishes is tried again; a successful offers
 * run replaces it with the real date. CATALOG_ENABLED=false leaves out the
 * catalog step (manual catalog runs keep working).
 */
class SchedulerService {
  private cronJob: cron.ScheduledTask | null = null;
  private dataManager: PostgresDataManager;
  private apiPort: string;
  private catalogService: CatalogService | null;
  private isRunning = false;
  /** Supermarkets whose weekly run is in progress. */
  private inProgress = new Set<string>();

  constructor(
    dataManager: PostgresDataManager,
    apiPort: string = "3001",
    catalogService: CatalogService | null = null
  ) {
    this.dataManager = dataManager;
    this.apiPort = apiPort;
    this.catalogService = catalogService;
  }

  /**
   * Start the scheduler to check for due runs every minute
   */
  public start(): void {
    if (this.cronJob) {
      serverLogger.warn("Scheduler is already running");
      return;
    }

    serverLogger.info("Starting scheduler service...");

    // Run every minute
    this.cronJob = cron.schedule("* * * * *", async () => {
      await this.checkAndRunDueScrapers();
    });

    const catalog = this.catalogEnabled() ? "catalog, then offers" : "offers only (CATALOG_ENABLED=false)";
    serverLogger.info(`Scheduler service started (checks every minute; weekly run: ${catalog})`);
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

  private catalogEnabled(): boolean {
    return this.catalogService !== null && process.env.CATALOG_ENABLED !== "false";
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

      const scheduledRunController =
        this.dataManager.getScheduledRunController();
      const dueRuns = await scheduledRunController.getDueScheduledRuns();

      if (dueRuns.length === 0) {
        serverLogger.debug("No due scraper runs at this time");
        return;
      }

      for (const run of dueRuns) {
        // Provisional next run: a retry, replaced by a successful offers run.
        const retryAt = retryAfter();
        await scheduledRunController.updateNextRunTime(run.supermarket, retryAt);

        if (this.inProgress.has(run.supermarket)) {
          serverLogger.warn(
            `Weekly run for ${run.supermarket} is still in progress; next check ${retryAt.toISOString()}`
          );
          continue;
        }

        // In the background, so supermarkets due at the same time run side by side.
        this.inProgress.add(run.supermarket);
        this.runWeekly(run.supermarket)
          .catch((error) =>
            serverLogger.error(`Weekly run for ${run.supermarket} failed:`, error?.message ?? error)
          )
          .finally(() => this.inProgress.delete(run.supermarket));
      }
    } catch (error) {
      serverLogger.error("Error checking for due scrapers:", error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * One supermarket's weekly run: the catalog first (when it has one), then
   * the offers, so the offers land on fresh catalog rows. A failed catalog
   * run does not stop the offers run.
   */
  private async runWeekly(supermarket: string): Promise<void> {
    const key = SUPERMARKET_KEYS[supermarket];
    if (!key) {
      serverLogger.error(`Unknown supermarket for scheduling: ${supermarket}`);
      return;
    }

    if (this.catalogEnabled() && this.catalogService!.supportedSupermarkets.includes(supermarket)) {
      serverLogger.info(`Weekly run for ${supermarket}: catalog`);
      try {
        const { done } = await this.catalogService!.start(supermarket);
        await done;
      } catch (error: any) {
        if (error instanceof CatalogRunInProgressError) {
          serverLogger.info(`Catalog run for ${supermarket} already running; continuing with the offers`);
        } else {
          serverLogger.error(`Catalog run for ${supermarket} could not start: ${error?.message}`);
        }
      }
    }

    serverLogger.info(`Weekly run for ${supermarket}: offers`);
    await axios.post(`http://localhost:${this.apiPort}/api/scraper/run/${key}`, null, {
      // An offers run can take minutes (PLUS uses a browser).
      timeout: 60 * 60 * 1000,
    });
    serverLogger.info(`Weekly run for ${supermarket} done`);
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
