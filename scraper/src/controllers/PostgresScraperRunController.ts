import PostgresDataContext from "../data/PostgresDataContext";
import ScraperRunModel from "../models/ScraperRunModel";
import { scraperLogger } from "../utils/Logger";

interface ScraperRunRow {
  id: number;
  supermarket: string;
  status: "running" | "success" | "failed";
  products_scraped: number;
  products_updated: number;
  products_created: number;
  discounts_deactivated: number;
  discounts_created: number;
  catalog_products: number | null;
  catalog_prices_changed: number | null;
  catalog_products_removed: number | null;
  error_message: string | null;
  started_at: Date;
  completed_at: Date | null;
  duration_seconds: number | null;
  promotion_expire_date: Date | null;
}

/** What a run did; the catalog fields stay null when the run had no assortment step. */
export interface RunMetrics {
  productsScraped: number;
  productsUpdated: number;
  productsCreated: number;
  discountsDeactivated: number;
  discountsCreated: number;
  promotionExpireDate?: Date;
  catalogProducts?: number;
  catalogPricesChanged?: number;
  catalogProductsRemoved?: number;
}

const RUN_COLUMNS = `id, supermarket, status, products_scraped, products_updated,
  products_created, discounts_deactivated, discounts_created,
  catalog_products, catalog_prices_changed, catalog_products_removed,
  error_message, started_at, completed_at, duration_seconds, promotion_expire_date`;

function toModel(row: ScraperRunRow): ScraperRunModel {
  const run = new ScraperRunModel(
    row.id,
    row.supermarket,
    row.status,
    row.products_scraped,
    row.products_updated,
    row.products_created,
    row.discounts_deactivated,
    row.discounts_created,
    row.error_message || undefined,
    row.started_at,
    row.completed_at || undefined,
    row.duration_seconds || undefined,
    row.promotion_expire_date || undefined
  );
  run.catalogProducts = row.catalog_products ?? undefined;
  run.catalogPricesChanged = row.catalog_prices_changed ?? undefined;
  run.catalogProductsRemoved = row.catalog_products_removed ?? undefined;
  return run;
}

/** The scraper_runs table: one row per run of a supermarket (assortment and offers). */
class PostgresScraperRunController {
  private db: PostgresDataContext;

  constructor(db: PostgresDataContext) {
    this.db = db;
    scraperLogger.debug("PostgresScraperRunController initialized.");
  }

  async exists(): Promise<boolean> {
    scraperLogger.debug("Checking if the scraper_runs table exists.");
    try {
      const result = await this.db.query<{ exists: boolean }>(
        `SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = 'scraper_runs'
        )`
      );
      return result.rows[0].exists;
    } catch (error) {
      scraperLogger.error("Error checking if scraper_runs table exists", error);
      return false;
    }
  }

  async createRun(supermarket: string): Promise<{ id: number; startedAt: Date }> {
    const result = await this.db.query<{ id: number; started_at: Date }>(
      `INSERT INTO scraper_runs (supermarket, status, started_at)
       VALUES ($1, 'running', NOW())
       RETURNING id, started_at`,
      [supermarket]
    );
    const row = result.rows[0];
    scraperLogger.debug(`Scraper run created with ID: ${row.id}`);
    return { id: row.id, startedAt: row.started_at };
  }

  /** Closes a run as success or failed, with what it did up to then. */
  async finishRun(
    runId: number,
    outcome: { status: "success" | "failed"; errorMessage?: string; metrics: RunMetrics }
  ): Promise<void> {
    const m = outcome.metrics;
    await this.db.query(
      `UPDATE scraper_runs
       SET status = $2,
           error_message = $3,
           products_scraped = $4,
           products_updated = $5,
           products_created = $6,
           discounts_deactivated = $7,
           discounts_created = $8,
           promotion_expire_date = $9,
           catalog_products = $10,
           catalog_prices_changed = $11,
           catalog_products_removed = $12,
           completed_at = NOW(),
           duration_seconds = EXTRACT(EPOCH FROM (NOW() - started_at))::INTEGER
       WHERE id = $1`,
      [
        runId,
        outcome.status,
        outcome.errorMessage ?? null,
        m.productsScraped,
        m.productsUpdated,
        m.productsCreated,
        m.discountsDeactivated,
        m.discountsCreated,
        m.promotionExpireDate ?? null,
        m.catalogProducts ?? null,
        m.catalogPricesChanged ?? null,
        m.catalogProductsRemoved ?? null,
      ]
    );
    scraperLogger.debug(`Scraper run ${runId} marked as ${outcome.status}`);
  }

  /** Runs left 'running' by a crash or restart are closed as failed on startup. */
  async failInterruptedRuns(): Promise<number> {
    const result = await this.db.query(
      `UPDATE scraper_runs SET status = 'failed', completed_at = NOW(),
         duration_seconds = EXTRACT(EPOCH FROM (NOW() - started_at))::INTEGER,
         error_message = 'Interrupted (server restarted)'
       WHERE status = 'running'`
    );
    return result.rowCount ?? 0;
  }

  async getRunById(runId: number): Promise<ScraperRunModel | null> {
    const result = await this.db.query<ScraperRunRow>(
      `SELECT ${RUN_COLUMNS} FROM scraper_runs WHERE id = $1`,
      [runId]
    );
    return result.rows.length > 0 ? toModel(result.rows[0]) : null;
  }

  async getAllRuns(limit: number = 100): Promise<ScraperRunModel[]> {
    const result = await this.db.query<ScraperRunRow>(
      `SELECT ${RUN_COLUMNS} FROM scraper_runs ORDER BY started_at DESC LIMIT $1`,
      [limit]
    );
    return result.rows.map(toModel);
  }

  async getRunsBySupermarket(supermarket: string, limit: number = 50): Promise<ScraperRunModel[]> {
    const result = await this.db.query<ScraperRunRow>(
      `SELECT ${RUN_COLUMNS} FROM scraper_runs
       WHERE supermarket = $1 ORDER BY started_at DESC LIMIT $2`,
      [supermarket, limit]
    );
    return result.rows.map(toModel);
  }

  async getLastRunBySupermarket(supermarket: string): Promise<ScraperRunModel | null> {
    const result = await this.db.query<ScraperRunRow>(
      `SELECT ${RUN_COLUMNS} FROM scraper_runs
       WHERE supermarket = $1 ORDER BY started_at DESC LIMIT 1`,
      [supermarket]
    );
    return result.rows.length > 0 ? toModel(result.rows[0]) : null;
  }

  async getLastSuccessfulRunBySupermarket(supermarket: string): Promise<ScraperRunModel | null> {
    const result = await this.db.query<ScraperRunRow>(
      `SELECT ${RUN_COLUMNS} FROM scraper_runs
       WHERE supermarket = $1 AND status = 'success' ORDER BY started_at DESC LIMIT 1`,
      [supermarket]
    );
    return result.rows.length > 0 ? toModel(result.rows[0]) : null;
  }

  async getRunStats(): Promise<{
    totalRuns: number;
    successfulRuns: number;
    failedRuns: number;
    successRate: number;
  }> {
    const result = await this.db.query<{
      total_runs: string;
      successful_runs: string;
      failed_runs: string;
    }>(
      `SELECT
        COUNT(*) as total_runs,
        COUNT(*) FILTER (WHERE status = 'success') as successful_runs,
        COUNT(*) FILTER (WHERE status = 'failed') as failed_runs
       FROM scraper_runs`
    );

    const row = result.rows[0];
    const totalRuns = parseInt(row.total_runs, 10);
    const successfulRuns = parseInt(row.successful_runs, 10);
    const failedRuns = parseInt(row.failed_runs, 10);
    const successRate = totalRuns > 0 ? (successfulRuns / totalRuns) * 100 : 0;

    return {
      totalRuns,
      successfulRuns,
      failedRuns,
      successRate: Math.round(successRate * 100) / 100,
    };
  }
}

export default PostgresScraperRunController;
