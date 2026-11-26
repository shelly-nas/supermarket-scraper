import { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import { scraperLogger } from "../utils/Logger";

interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}

class PostgresDataContext {
  private static instance: PostgresDataContext;
  private pool: Pool;

  private constructor(config: DatabaseConfig) {
    this.pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      max: config.max || 20,
      idleTimeoutMillis: config.idleTimeoutMillis || 30000,
      connectionTimeoutMillis: config.connectionTimeoutMillis || 2000,
    });

    this.pool.on("error", (err: Error) => {
      scraperLogger.error("Unexpected error on idle PostgreSQL client", err);
    });

    scraperLogger.debug("PostgreSQL connection pool initialized");
  }

  public static getInstance(config?: DatabaseConfig): PostgresDataContext {
    if (!PostgresDataContext.instance) {
      if (!config) {
        throw new Error(
          "Database configuration required for first initialization"
        );
      }
      PostgresDataContext.instance = new PostgresDataContext(config);
    }
    return PostgresDataContext.instance;
  }

  public async query<T extends QueryResultRow = any>(
    text: string,
    params?: any[]
  ): Promise<QueryResult<T>> {
    const start = Date.now();
    try {
      const result = await this.pool.query<T>(text, params);
      const duration = Date.now() - start;
      scraperLogger.debug(`Executed query in ${duration}ms: ${text}`);
      return result;
    } catch (error) {
      scraperLogger.error(`Database query error: ${text}`, error);
      throw error;
    }
  }

  public async getClient(): Promise<PoolClient> {
    try {
      const client = await this.pool.connect();
      return client;
    } catch (error) {
      scraperLogger.error("Failed to get database client from pool", error);
      throw error;
    }
  }

  public async transaction<T>(
    callback: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await this.getClient();
    try {
      await client.query("BEGIN");
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      scraperLogger.error("Transaction failed, rolled back", error);
      throw error;
    } finally {
      client.release();
    }
  }

  public async testConnection(): Promise<boolean> {
    try {
      const result = await this.query("SELECT NOW()");
      scraperLogger.debug("Database connection test successful");
      return true;
    } catch (error) {
      scraperLogger.error("Database connection test failed", error);
      return false;
    }
  }

  public async close(): Promise<void> {
    try {
      if (this.pool.ended) {
        scraperLogger.warn("PostgreSQL connection pool already closed");
        return;
      }
      await this.pool.end();
      PostgresDataContext.instance = null as any;
      scraperLogger.debug("PostgreSQL connection pool closed");
    } catch (error) {
      scraperLogger.error("Error closing PostgreSQL connection pool", error);
      throw error;
    }
  }
}

export default PostgresDataContext;
