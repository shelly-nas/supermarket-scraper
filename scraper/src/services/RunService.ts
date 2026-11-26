import PostgresDataManager from "../data/PostgresDataManager";
import PostgresCatalogController from "../controllers/PostgresCatalogController";
import { RunMetrics } from "../controllers/PostgresScraperRunController";
import CatalogClient, { CatalogOffers } from "../clients/catalog/CatalogClient";
import ApiClient from "../clients/ApiClient";
import { getCatalogClient, getSupermarketClient } from "../utils/ConfigHelper";
import { nextRunAfterExpiry, retryAfter } from "../utils/Schedule";
import { scraperLogger, serverLogger } from "../utils/Logger";

export class RunInProgressError extends Error {}

const messageOf = (error: any) => String(error?.message || error || "Unknown error");

/**
 * One run of a supermarket: its full assortment (regular prices) and its
 * offers, logged as one scraper_runs row. Where the assortment source also
 * carries the promotions (CatalogClient.catalogOffers) the offers come from
 * that same pass; otherwise, or when the assortment step fails, from the
 * supermarket's offers client. A run takes minutes, so it runs in the
 * background; one run per supermarket at a time.
 *
 * Afterwards the next run is scheduled: after the offers end when the run
 * succeeded, a retry a few hours later when a step failed.
 */
class RunService {
  private running = new Set<string>();
  private catalog: PostgresCatalogController;

  constructor(
    private dataManager: PostgresDataManager,
    private catalogClientFactory: (supermarket: string) => CatalogClient | null = getCatalogClient,
    private offersClientFactory: (supermarket: string) => ApiClient = getSupermarketClient
  ) {
    this.catalog = new PostgresCatalogController(dataManager.db);
  }

  isRunning(supermarket: string): boolean {
    return this.running.has(supermarket);
  }

  /** The assortment step is off with CATALOG_ENABLED=false (acc), leaving offers only. */
  private catalogEnabled(): boolean {
    return process.env.CATALOG_ENABLED !== "false";
  }

  /**
   * Starts a run and resolves with its id as soon as it is recorded; `done`
   * settles when the run has finished and the next one is scheduled.
   */
  async start(supermarket: string): Promise<{ runId: number; done: Promise<void> }> {
    if (this.running.has(supermarket)) {
      throw new RunInProgressError(`A run for ${supermarket} is already in progress`);
    }
    this.running.add(supermarket);
    let run: { id: number; startedAt: Date };
    try {
      run = await this.dataManager.getScraperRunController().createRun(supermarket);
    } catch (error) {
      this.running.delete(supermarket);
      throw error;
    }

    const done = this.execute(supermarket, run)
      .catch((error) => serverLogger.error(`Run ${run.id} for ${supermarket} crashed: ${messageOf(error)}`))
      .finally(() => this.running.delete(supermarket));
    return { runId: run.id, done };
  }

  private async execute(supermarket: string, run: { id: number; startedAt: Date }): Promise<void> {
    scraperLogger.setSupermarket(supermarket);
    scraperLogger.info(`=== Run ${run.id} started for ${supermarket} ===`);
    const errors: string[] = [];
    const metrics: RunMetrics = {
      productsScraped: 0,
      productsUpdated: 0,
      productsCreated: 0,
      discountsDeactivated: 0,
      discountsCreated: 0,
    };

    let offers: CatalogOffers | null = null;
    const catalogClient = this.catalogEnabled() ? this.catalogClientFactory(supermarket) : null;
    if (catalogClient) {
      try {
        Object.assign(metrics, await this.runCatalog(supermarket, catalogClient, run.startedAt));
        offers = catalogClient.catalogOffers();
      } catch (error) {
        errors.push(`Assortment: ${messageOf(error)}`);
      }
    }

    if (!offers) {
      try {
        offers = await this.offersClientFactory(supermarket).fetchDiscounts();
      } catch (error) {
        errors.push(`Offers: ${messageOf(error)}`);
      }
    }

    let expireDate: Date | undefined;
    if (offers) {
      try {
        expireDate = validDate(offers.expireDate);
        Object.assign(metrics, await this.storeOffers(supermarket, offers, run.startedAt), {
          promotionExpireDate: expireDate,
        });
      } catch (error) {
        errors.push(`Saving offers: ${messageOf(error)}`);
      }
    }

    const failed = errors.length > 0;
    await this.dataManager.getScraperRunController().finishRun(run.id, {
      status: failed ? "failed" : "success",
      errorMessage: failed ? errors.join("; ") : undefined,
      metrics,
    });

    const next = failed
      ? { at: retryAfter(), reason: "retry" }
      : nextRunAfterExpiry(expireDate ?? null);
    await this.dataManager
      .getScheduledRunController()
      .upsertScheduledRun(supermarket, failed ? null : expireDate ?? null, next.at);

    const summary =
      `${metrics.catalogProducts ?? "no"} assortment products, ${metrics.productsScraped} offers; ` +
      `next run ${next.at.toISOString()} (${next.reason})`;
    if (failed) {
      scraperLogger.error(`=== Run ${run.id} failed: ${errors.join("; ")} ===`);
      serverLogger.error(`Run ${run.id} for ${supermarket} failed: ${errors.join("; ")}; ${summary}`);
    } else {
      scraperLogger.info(`=== Run ${run.id} completed successfully ===`);
      serverLogger.info(`Run ${run.id} for ${supermarket} done: ${summary}`);
    }
  }

  /** The full assortment at regular prices; products not seen any more leave the catalog. */
  private async runCatalog(
    supermarket: string,
    client: CatalogClient,
    startedAt: Date
  ): Promise<Pick<RunMetrics, "catalogProducts" | "catalogPricesChanged" | "catalogProductsRemoved">> {
    let seen = 0;
    let pricesChanged = 0;
    await client.fetchCatalog(async (products) => {
      const batch = await this.catalog.upsertBatch(supermarket, products, startedAt);
      seen += batch.created + batch.updated;
      pricesChanged += batch.pricesChanged;
    });
    if (seen === 0) throw new Error("The assortment returned no products");

    const removed = await this.catalog.markRemoved(supermarket, startedAt, seen);
    return { catalogProducts: seen, catalogPricesChanged: pricesChanged, catalogProductsRemoved: removed };
  }

  /** Stores the offers on their products (after the assortment, so they land on fresh catalog rows). */
  private async storeOffers(
    supermarket: string,
    offers: CatalogOffers,
    startedAt: Date
  ): Promise<Pick<RunMetrics, "productsScraped" | "productsCreated" | "productsUpdated" | "discountsCreated">> {
    const products = await this.dataManager.addProductDb(supermarket, offers.discounts);
    const discounts = await this.dataManager.addDiscountDb(offers.discounts, supermarket, startedAt);
    scraperLogger.info(`Offers stored: ${discounts.created} new discounts, ${discounts.skipped} unchanged`);
    return {
      productsScraped: offers.discounts.length,
      productsCreated: products.created,
      productsUpdated: products.updated,
      discountsCreated: discounts.created,
    };
  }
}

/** An end date that cannot be read counts as missing. */
function validDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export default RunService;
