import PostgresDataContext from "../data/PostgresDataContext";
import { ScheduledRunModel } from "../models/ScheduledRunModel";
import { scraperLogger } from "../utils/Logger";

interface ScheduledRunRow {
  id: number;
  supermarket: string;
  next_run_at: Date;
  promotion_expire_date: Date;
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
   * automatic runs back on. Without an end date the previous one is kept.
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
        `INSERT INTO scheduled_runs (supermarket, next_run_at, promotion_expire_date, enabled)
         VALUES ($1, $2, COALESCE($3, $2), true)
         ON CONFLICT (supermarket)
         DO UPDATE SET
           next_run_at = EXCLUDED.next_run_at,
           promotion_expire_date = COALESCE($3, scheduled_runs.promotion_expire_date)
         RETURNING id`,
        [supermarket, nextRunAt, promotionExpireDate]
      );

      const id = result.rows[0].id;
      scraperLogger.info(
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

  async getDueScheduledRuns(): Promise<ScheduledRunModel[]> {
    scraperLogger.debug("Fetching due scheduled runs");
    try {
      const result = await this.db.query<ScheduledRunRow>(
        `SELECT id, supermarket, next_run_at, promotion_expire_date, enabled, created_at, updated_at
         FROM scheduled_runs 
         WHERE enabled = true AND next_run_at <= NOW()
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

      scraperLogger.info(
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

      scraperLogger.info(
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

      scraperLogger.info(`Scheduled run for ${supermarket} deleted`);
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
