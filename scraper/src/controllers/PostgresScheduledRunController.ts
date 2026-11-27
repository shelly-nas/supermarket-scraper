import PostgresDataContext from "../data/PostgresDataContext";
import { ScheduledRunModel } from "../models/ScheduledRunModel";
import { scraperLogger } from "../utils/Logger";

interface ScheduledRunRow {
  id: number;
  supermarket: string;
  next_run_at: Date;
  promotion_expire_date: Date | null;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

class PostgresScheduledRunController {
  private db: PostgresDataContext;

  constructor(db: PostgresDataContext) {
    this.db = db;
    scraperLogger.debug("PostgresScheduledRunController initialized.");
  }

  async exists(): Promise<boolean> {
    scraperLogger.debug("Checking if the scheduled_runs table exists.");
    try {
      const result = await this.db.query<{ exists: boolean }>(
        `SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'scheduled_runs'
        )`
      );
      return result.rows[0].exists;
    } catch (error) {
      scraperLogger.error(
        "Error checking if scheduled_runs table exists",
        error
      );
      return false;
    }
  }

  /**
   * Records the next run of a supermarket and the end date of its current
   * offers (utils/Schedule.ts decides when). A new row is enabled; an existing
   * row keeps its enabled setting, so a manual run does not switch the
   * automatic runs back on. Without an end date the previous one is kept (a
   * new row has none, migration 009).
   */
  async upsertScheduledRun(
    supermarket: string,
    promotionExpireDate: Date | null,
    nextRunAt: Date
  ): Promise<number> {
    scraperLogger.debug(
      `Upserting scheduled run for: ${supermarket} with expire date: ${promotionExpireDate}, next run: ${nextRunAt}`
    );
    try {
      const result = await this.db.query<{ id: number }>(
        // Explicit casts: Postgres cannot deduce one type for a parameter used
        // both as a column value and inside COALESCE ("inconsistent types").
        `INSERT INTO scheduled_runs (supermarket, next_run_at, promotion_expire_date, enabled)
         VALUES ($1, $2::timestamp, $3::timestamp, true)
         ON CONFLICT (supermarket)
         DO UPDATE SET
           next_run_at = EXCLUDED.next_run_at,
           promotion_expire_date = COALESCE($3::timestamp, scheduled_runs.promotion_expire_date)
         RETURNING id`,
        [supermarket, nextRunAt, promotionExpireDate]
      );

      const id = result.rows[0].id;
      scraperLogger.debug(
        `Scheduled run upserted for ${supermarket} with ID: ${id}, next run at: ${nextRunAt}`
      );
      return id;
    } catch (error) {
      scraperLogger.error(
        `Error upserting scheduled run for ${supermarket}`,
        error
      );
      throw error;
    }
  }

  async getScheduledRun(
    supermarket: string
  ): Promise<ScheduledRunModel | null> {
    scraperLogger.debug(`Fetching scheduled run for: ${supermarket}`);
    try {
      const result = await this.db.query<ScheduledRunRow>(
        `SELECT id, supermarket, next_run_at, promotion_expire_date, enabled, created_at, updated_at
         FROM scheduled_runs 
         WHERE supermarket = $1`,
        [supermarket]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return new ScheduledRunModel(
        row.id,
        row.supermarket,
        row.next_run_at,
        row.promotion_expire_date,
        row.enabled,
        row.created_at,
        row.updated_at
      );
    } catch (error) {
      scraperLogger.error(
        `Error fetching scheduled run for ${supermarket}`,
        error
      );
      throw error;
    }
  }

  async getAllScheduledRuns(): Promise<ScheduledRunModel[]> {
    scraperLogger.debug("Fetching all scheduled runs");
    try {
      const result = await this.db.query<ScheduledRunRow>(
        `SELECT id, supermarket, next_run_at, promotion_expire_date, enabled, created_at, updated_at
         FROM scheduled_runs 
         ORDER BY next_run_at ASC`
      );

      return result.rows.map(
        (row) =>
          new ScheduledRunModel(
            row.id,
            row.supermarket,
            row.next_run_at,
            row.promotion_expire_date,
            row.enabled,
            row.created_at,
            row.updated_at
          )
      );
    } catch (error) {
      scraperLogger.error("Error fetching all scheduled runs", error);
      throw error;
    }
  }

  async getEnabledScheduledRuns(): Promise<ScheduledRunModel[]> {
    scraperLogger.debug("Fetching enabled scheduled runs");
    try {
      const result = await this.db.query<ScheduledRunRow>(
        `SELECT id, supermarket, next_run_at, promotion_expire_date, enabled, created_at, updated_at
         FROM scheduled_runs 
         WHERE enabled = true
         ORDER BY next_run_at ASC`
      );

      return result.rows.map(
        (row) =>
          new ScheduledRunModel(
            row.id,
            row.supermarket,
            row.next_run_at,
            row.promotion_expire_date,
            row.enabled,
            row.created_at,
            row.updated_at
          )
      );
    } catch (error) {
      scraperLogger.error("Error fetching enabled scheduled runs", error);
      throw error;
    }
  }

  /**
   * Gives every supermarket a schedule row, due right away, so a supermarket
   * that never had a successful run (an empty database) still gets one.
   */
  async ensureScheduledRuns(supermarkets: string[]): Promise<number> {
    const result = await this.db.query(
      `INSERT INTO scheduled_runs (supermarket, next_run_at, promotion_expire_date, enabled)
       SELECT name, NOW(), NULL, true FROM unnest($1::text[]) AS name
       ON CONFLICT (supermarket) DO NOTHING`,
      [supermarkets]
    );
    return result.rowCount ?? 0;
  }

  /**
   * Enabled supermarkets whose run is due: at their next run time, or as a
   * fallback when their last successful run is older than `staleDays` (or
   * there never was one) and no run started in the last `retryHours`, so a
   * schedule that went wrong cannot leave the data stale.
   */
  async getDueScheduledRuns(staleDays: number, retryHours: number): Promise<ScheduledRunModel[]> {
    scraperLogger.debug("Fetching due scheduled runs");
    try {
      const result = await this.db.query<ScheduledRunRow>(
        `SELECT s.id, s.supermarket, s.next_run_at, s.promotion_expire_date, s.enabled, s.created_at, s.updated_at
         FROM scheduled_runs s
         WHERE s.enabled = true AND (
           s.next_run_at <= NOW()
           OR (
             NOT EXISTS (SELECT 1 FROM scraper_runs r WHERE r.supermarket = s.supermarket
                         AND r.status = 'success' AND r.started_at > NOW() - make_interval(days => $1))
             AND NOT EXISTS (SELECT 1 FROM scraper_runs r WHERE r.supermarket = s.supermarket
                             AND r.started_at > NOW() - make_interval(hours => $2))
           )
         )
         ORDER BY s.next_run_at ASC`,
        [staleDays, retryHours]
      );

      return result.rows.map(
        (row) =>
          new ScheduledRunModel(
            row.id,
            row.supermarket,
            row.next_run_at,
            row.promotion_expire_date,
            row.enabled,
            row.created_at,
            row.updated_at
          )
      );
    } catch (error) {
      scraperLogger.error("Error fetching due scheduled runs", error);
      throw error;
    }
  }

  async toggleScheduledRun(
    supermarket: string,
    enabled: boolean
  ): Promise<boolean> {
    scraperLogger.debug(
      `Toggling scheduled run for ${supermarket} to ${enabled}`
    );
    try {
      const result = await this.db.query(
        `UPDATE scheduled_runs 
         SET enabled = $2
         WHERE supermarket = $1`,
        [supermarket, enabled]
      );

      if (result.rowCount === 0) {
        scraperLogger.warn(
          `No scheduled run found for supermarket: ${supermarket}`
        );
        return false;
      }

      scraperLogger.debug(
        `Scheduled run for ${supermarket} toggled to ${enabled}`
      );
      return true;
    } catch (error) {
      scraperLogger.error(
        `Error toggling scheduled run for ${supermarket}`,
        error
      );
      throw error;
    }
  }

  async updateNextRunTime(
    supermarket: string,
    nextRunAt: Date
  ): Promise<boolean> {
    scraperLogger.debug(
      `Updating next run time for ${supermarket} to ${nextRunAt}`
    );
    try {
      const result = await this.db.query(
        `UPDATE scheduled_runs 
         SET next_run_at = $2
         WHERE supermarket = $1`,
        [supermarket, nextRunAt]
      );

      if (result.rowCount === 0) {
        scraperLogger.warn(
          `No scheduled run found for supermarket: ${supermarket}`
        );
        return false;
      }

      scraperLogger.debug(
        `Next run time updated for ${supermarket} to ${nextRunAt}`
      );
      return true;
    } catch (error) {
      scraperLogger.error(
        `Error updating next run time for ${supermarket}`,
        error
      );
      throw error;
    }
  }

  async deleteScheduledRun(supermarket: string): Promise<boolean> {
    scraperLogger.debug(`Deleting scheduled run for: ${supermarket}`);
    try {
      const result = await this.db.query(
        "DELETE FROM scheduled_runs WHERE supermarket = $1",
        [supermarket]
      );

      if (result.rowCount === 0) {
        scraperLogger.warn(
          `No scheduled run found for supermarket: ${supermarket}`
        );
        return false;
      }

      scraperLogger.debug(`Scheduled run for ${supermarket} deleted`);
      return true;
    } catch (error) {
      scraperLogger.error(
        `Error deleting scheduled run for ${supermarket}`,
        error
      );
      throw error;
    }
  }
}

export default PostgresScheduledRunController;
