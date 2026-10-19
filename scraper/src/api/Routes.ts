import { Request, Response, Router } from "express";
import { serverLogger, scraperLogger } from "../utils/Logger";
import PostgresDataManager from "../data/PostgresDataManager";
import { getSupermarketClient } from "../utils/ConfigHelper";
import { nextRunAfterExpiry, TIME_ZONE } from "../utils/Schedule";

const router = Router();

// Create a single shared instance of PostgresDataManager
const dataManager = new PostgresDataManager();

// Health check endpoint
router.get("/health", (req: Request, res: Response) => {
  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
});

// Get dashboard statistics
router.get("/dashboard/stats", async (req: Request, res: Response) => {
  try {
    serverLogger.info("Fetching dashboard statistics");

    const dbContext = (dataManager as any).db;

    // Get total unique products
    const uniqueProductsQuery = `
      SELECT COUNT(DISTINCT id) as count
      FROM products
    `;
    const uniqueProductsResult = await dbContext.query(uniqueProductsQuery);
    const uniqueProducts = parseInt(uniqueProductsResult.rows[0].count, 10);

    // Get total scraped products (with active discounts)
    const scrapedProductsQuery = `
      SELECT COUNT(*) as count
      FROM discounts
      WHERE active = true
    `;
    const scrapedProductsResult = await dbContext.query(scrapedProductsQuery);
    const scrapedProducts = parseInt(scrapedProductsResult.rows[0].count, 10);

    // Get run statistics from scraper_runs table
    const scraperRunController = dataManager.getScraperRunController();
    const runStats = await scraperRunController.getRunStats();

    // Get next scheduled run
    const scheduledRunController = dataManager.getScheduledRunController();
    const scheduledRuns =
      await scheduledRunController.getEnabledScheduledRuns();
    let nextScheduledRun = "Not scheduled";

    if (scheduledRuns.length > 0) {
      // Find the earliest scheduled run
      const earliestRun = scheduledRuns.reduce((earliest, current) =>
        current.nextRunAt < earliest.nextRunAt ? current : earliest
      );
      // In Dutch time: the container runs in UTC.
      const when = earliestRun.nextRunAt.toLocaleString("nl-NL", {
        timeZone: TIME_ZONE,
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
      nextScheduledRun = `${earliestRun.supermarket}, ${when}`;
    }

    const stats = {
      totalRuns: runStats.totalRuns,
      successRate: runStats.successRate,
      scrapedProducts,
      uniqueProducts,
      nextScheduledRun,
    };

    serverLogger.info("Dashboard statistics retrieved successfully");
    res.status(200).json(stats);
  } catch (error: any) {
    const errorMessage = error.message || "Unknown error";
    serverLogger.error(`Error fetching dashboard stats: ${errorMessage}`);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

// Get supermarket statuses
router.get("/dashboard/statuses", async (req: Request, res: Response) => {
  try {
    serverLogger.info("Fetching supermarket statuses");

    const dbContext = (dataManager as any).db;
    const scraperRunController = dataManager.getScraperRunController();

    // Get last update and product count for each supermarket
    const query = `
      SELECT 
        p.supermarket,
        MAX(p.updated_at) as last_run,
        COUNT(DISTINCT p.id) as products_scraped
      FROM products p
      INNER JOIN discounts d ON p.id = d.product_id
      WHERE d.active = true
      GROUP BY p.supermarket
      ORDER BY p.supermarket
    `;

    const result = await dbContext.query(query);

    // Map supermarket names to keys
    const nameToKeyMap: { [key: string]: string } = {
      "Albert Heijn": "albert-heijn",
      Aldi: "aldi",
      Dirk: "dirk",
      Hoogvliet: "hoogvliet",
      Jumbo: "jumbo",
      Lidl: "lidl",
      PLUS: "plus",
    };

    // Define all supermarkets
    const allSupermarkets = [
      { key: "albert-heijn", name: "Albert Heijn" },
      { key: "aldi", name: "Aldi" },
      { key: "dirk", name: "Dirk" },
      { key: "hoogvliet", name: "Hoogvliet" },
      { key: "jumbo", name: "Jumbo" },
      { key: "lidl", name: "Lidl" },
      { key: "plus", name: "PLUS" },
    ];

    const scheduledRunController = dataManager.getScheduledRunController();

    const statuses = await Promise.all(
      allSupermarkets.map(async (sm) => {
        const dbRow = result.rows.find(
          (row: any) => row.supermarket === sm.name
        );
        const lastRun = await scraperRunController.getLastRunBySupermarket(
          sm.name
        );
        const scheduledRun = await scheduledRunController.getScheduledRun(
          sm.name
        );

        const base = {
          key: sm.key,
          name: sm.name,
          promotionExpireDate: scheduledRun?.promotionExpireDate?.toISOString() ?? null,
          scheduledEnabled: scheduledRun?.enabled ?? false,
          nextRunAt: scheduledRun?.nextRunAt?.toISOString() ?? null,
        };

        if (dbRow && lastRun) {
          return {
            ...base,
            status: lastRun.status as "success" | "failed" | "running",
            lastRun: lastRun.completedAt || lastRun.startedAt,
            productsScraped: parseInt(dbRow.products_scraped, 10),
            runId: lastRun.id,
          };
        } else if (lastRun) {
          return {
            ...base,
            status: lastRun.status as "success" | "failed" | "running",
            lastRun: lastRun.completedAt || lastRun.startedAt,
            productsScraped: 0,
            runId: lastRun.id,
          };
        } else {
          return {
            ...base,
            status: "pending" as const,
          };
        }
      })
    );

    serverLogger.info("Supermarket statuses retrieved successfully");
    res.status(200).json(statuses);
  } catch (error: any) {
    const errorMessage = error.message || "Unknown error";
    serverLogger.error(`Error fetching supermarket statuses: ${errorMessage}`);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

// Get all discounts with product details
router.get("/discounts", async (req: Request, res: Response) => {
  try {
    serverLogger.info("Fetching all active discounts with product details");

    const query = `
      SELECT
        p.id,
        p.name,
        p.category,
        p.supermarket,
        p.product_url,
        p.image_url,
        p.brand,
        p.unit_size,
        p.quantity_value::float AS quantity_value,
        p.quantity_unit,
        p.created_at,
        p.updated_at,
        json_build_object(
          'id', d.id,
          'product_id', d.product_id,
          'original_price', d.original_price,
          'discount_price', d.discount_price,
          'unit_price', d.unit_price,
          'special_discount', d.special_discount,
          'expire_date', d.expire_date,
          'active', d.active,
          'created_at', d.created_at
        ) as discount
      FROM products p
      INNER JOIN discounts d ON p.id = d.product_id
      WHERE d.active = true
      ORDER BY d.expire_date ASC, p.category ASC, p.name ASC
    `;

    const dbContext = (dataManager as any).db;
    const result = await dbContext.query(query);

    serverLogger.info(`Retrieved ${result.rows.length} active discounts`);

    res.status(200).json(result.rows);
  } catch (error: any) {
    const errorMessage = error.message || "Unknown error";
    serverLogger.error(`Error fetching discounts: ${errorMessage}`);

    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

// Run scraper endpoint
router.post(
  "/scraper/run/:supermarket",
  async (req: Request, res: Response) => {
    let runId: number | null = null;

    try {
      const supermarketParam = req.params.supermarket.toLowerCase();

      // Map URL params to full supermarket names
      const nameMap: { [key: string]: string } = {
        "albert-heijn": "Albert Heijn",
        aldi: "Aldi",
        dirk: "Dirk",
        hoogvliet: "Hoogvliet",
        jumbo: "Jumbo",
        lidl: "Lidl",
        plus: "PLUS",
      };

      const supermarketName = nameMap[supermarketParam];

      if (!supermarketName) {
        serverLogger.warn(
          `Invalid supermarket parameter: ${req.params.supermarket}`
        );
        return res.status(400).json({
          success: false,
          error: `Unknown supermarket: ${req.params.supermarket}. Valid values: albert-heijn, aldi, dirk, hoogvliet, jumbo, lidl, plus`,
        });
      }

      serverLogger.info(`Starting scraper for "${supermarketName}"`);

      // Initialize scraper logger with supermarket name
      scraperLogger.setSupermarket(supermarketName);
      scraperLogger.info(
        `=== Scraper session started for ${supermarketName} ===`
      );

      // Test database connection
      const connected = await dataManager.testConnection();
      if (!connected) {
        throw new Error("Failed to connect to database");
      }
      scraperLogger.info("Database connection verified");

      // Create scraper run record
      const scraperRunController = dataManager.getScraperRunController();
      runId = await scraperRunController.createRun(supermarketName);
      const scraperRun = await scraperRunController.getRunById(runId);
      const currentBatchRunDate = scraperRun?.startedAt || new Date();
      scraperLogger.info(
        `Scraper run tracked with ID: ${runId}, started at: ${currentBatchRunDate.toISOString()}`
      );

      // Fetch discounts via API client
      const supermarketClient = getSupermarketClient(supermarketName);
      const { discounts: supermarketDiscounts, expireDate } =
        await supermarketClient.fetchDiscounts();

      // Parse the expiration date (an unreadable one counts as missing)
      const parsedExpireDate = expireDate ? new Date(expireDate) : undefined;
      const promotionExpireDate =
        parsedExpireDate && !Number.isNaN(parsedExpireDate.getTime()) ? parsedExpireDate : undefined;

      // Update database
      scraperLogger.info("Updating database with scraped data");

      const productMetrics = await dataManager.addProductDb(
        supermarketName,
        supermarketDiscounts
      );
      scraperLogger.info("Products upserted to database");

      const discountMetrics = await dataManager.addDiscountDb(
        supermarketDiscounts,
        supermarketName,
        currentBatchRunDate
      );
      scraperLogger.info(
        `New discounts processed: ${discountMetrics.created} created, ${discountMetrics.skipped} skipped`
      );

      // Update scraper run to success
      await scraperRunController.updateRunSuccess(runId, {
        productsScraped: supermarketDiscounts.length,
        productsUpdated: productMetrics.updated,
        productsCreated: productMetrics.created,
        discountsDeactivated: 0, // No longer deactivating all discounts
        discountsCreated: discountMetrics.created,
        promotionExpireDate,
      });

      // Schedule the next weekly run from the end date of these offers, with
      // the fallbacks of utils/Schedule.ts (retry, at most a week apart).
      const nextRun = nextRunAfterExpiry(promotionExpireDate ?? null);
      await dataManager
        .getScheduledRunController()
        .upsertScheduledRun(supermarketName, promotionExpireDate ?? null, nextRun.at);
      scraperLogger.info(
        `Next run for ${supermarketName}: ${nextRun.at.toISOString()} (${nextRun.reason}; offers end ${expireDate || "unknown"})`
      );

      scraperLogger.info(`=== Scraper session completed successfully ===`);
      serverLogger.info(
        `Scraper completed for "${supermarketName}" - ${supermarketDiscounts.length} products scraped`
      );

      res.status(200).json({
        success: true,
        message: `Scraper completed for ${supermarketName}`,
        data: {
          runId,
          supermarket: supermarketName,
          productsScraped: supermarketDiscounts.length,
          productsCreated: productMetrics.created,
          productsUpdated: productMetrics.updated,
          discountsCreated: discountMetrics.created,
          discountsSkipped: discountMetrics.skipped,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error: any) {
      const errorMessage = error.message || "Unknown error";

      // Update scraper run to failed if we have a runId
      if (runId) {
        try {
          const scraperRunController = dataManager.getScraperRunController();
          await scraperRunController.updateRunFailure(runId, errorMessage);
        } catch (updateError) {
          scraperLogger.error(
            "Failed to update scraper run status:",
            updateError
          );
        }
      }

      if (scraperLogger) {
        scraperLogger.error("Error during scraping:", error);
        scraperLogger.error(`=== Scraper session failed ===`);
      }

      serverLogger.error(
        `Scraper failed for "${req.params.supermarket}": ${errorMessage}`
      );

      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
    // Don't close the pool - it's a singleton that should stay open
  }
);

// Get all scraper runs
router.get("/scraper/runs", async (req: Request, res: Response) => {
  try {
    serverLogger.info("Fetching all scraper runs");

    const limit = req.query.limit
      ? parseInt(req.query.limit as string, 10)
      : 100;
    const scraperRunController = dataManager.getScraperRunController();
    const runs = await scraperRunController.getAllRuns(limit);

    serverLogger.info(`Retrieved ${runs.length} scraper runs`);
    res.status(200).json(runs);
  } catch (error: any) {
    const errorMessage = error.message || "Unknown error";
    serverLogger.error(`Error fetching scraper runs: ${errorMessage}`);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

// Get scraper runs for a specific supermarket
router.get(
  "/scraper/runs/:supermarket",
  async (req: Request, res: Response) => {
    try {
      const supermarketParam = req.params.supermarket.toLowerCase();

      // Map URL params to full supermarket names
      const nameMap: { [key: string]: string } = {
        "albert-heijn": "Albert Heijn",
        aldi: "Aldi",
        dirk: "Dirk",
        hoogvliet: "Hoogvliet",
        jumbo: "Jumbo",
        lidl: "Lidl",
        plus: "PLUS",
      };

      const supermarketName = nameMap[supermarketParam];

      if (!supermarketName) {
        serverLogger.warn(
          `Invalid supermarket parameter: ${req.params.supermarket}`
        );
        return res.status(400).json({
          success: false,
          error: `Unknown supermarket: ${req.params.supermarket}. Valid values: albert-heijn, aldi, dirk, hoogvliet, jumbo, lidl, plus`,
        });
      }

      serverLogger.info(`Fetching scraper runs for "${supermarketName}"`);

      const limit = req.query.limit
        ? parseInt(req.query.limit as string, 10)
        : 50;
      const scraperRunController = dataManager.getScraperRunController();
      const runs = await scraperRunController.getRunsBySupermarket(
        supermarketName,
        limit
      );

      serverLogger.info(
        `Retrieved ${runs.length} scraper runs for ${supermarketName}`
      );
      res.status(200).json(runs);
    } catch (error: any) {
      const errorMessage = error.message || "Unknown error";
      serverLogger.error(`Error fetching scraper runs: ${errorMessage}`);
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  }
);

// Get specific scraper run by ID
router.get("/scraper/run/:id", async (req: Request, res: Response) => {
  try {
    const runId = parseInt(req.params.id, 10);

    if (isNaN(runId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid run ID",
      });
    }

    serverLogger.info(`Fetching scraper run with ID: ${runId}`);

    const scraperRunController = dataManager.getScraperRunController();
    const run = await scraperRunController.getRunById(runId);

    if (!run) {
      return res.status(404).json({
        success: false,
        error: "Scraper run not found",
      });
    }

    serverLogger.info(`Retrieved scraper run ${runId}`);
    res.status(200).json(run);
  } catch (error: any) {
    const errorMessage = error.message || "Unknown error";
    serverLogger.error(`Error fetching scraper run: ${errorMessage}`);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

// Get all scheduled runs
router.get("/scheduler/runs", async (req: Request, res: Response) => {
  try {
    serverLogger.info("Fetching all scheduled runs");

    const scheduledRunController = dataManager.getScheduledRunController();
    const scheduledRuns = await scheduledRunController.getAllScheduledRuns();

    serverLogger.info(`Retrieved ${scheduledRuns.length} scheduled runs`);
    res.status(200).json(scheduledRuns);
  } catch (error: any) {
    const errorMessage = error.message || "Unknown error";
    serverLogger.error(`Error fetching scheduled runs: ${errorMessage}`);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

// Get scheduled run for specific supermarket
router.get(
  "/scheduler/run/:supermarket",
  async (req: Request, res: Response) => {
    try {
      const supermarketParam = req.params.supermarket.toLowerCase();

      // Map URL params to full supermarket names
      const nameMap: { [key: string]: string } = {
        "albert-heijn": "Albert Heijn",
        aldi: "Aldi",
        dirk: "Dirk",
        hoogvliet: "Hoogvliet",
        jumbo: "Jumbo",
        lidl: "Lidl",
        plus: "PLUS",
      };

      const supermarketName = nameMap[supermarketParam];

      if (!supermarketName) {
        serverLogger.warn(
          `Invalid supermarket parameter: ${req.params.supermarket}`
        );
        return res.status(400).json({
          success: false,
          error: `Unknown supermarket: ${req.params.supermarket}. Valid values: albert-heijn, aldi, dirk, hoogvliet, jumbo, lidl, plus`,
        });
      }

      serverLogger.info(`Fetching scheduled run for "${supermarketName}"`);

      const scheduledRunController = dataManager.getScheduledRunController();
      const scheduledRun = await scheduledRunController.getScheduledRun(
        supermarketName
      );

      if (!scheduledRun) {
        return res.status(404).json({
          success: false,
          error: `No scheduled run found for ${supermarketName}`,
        });
      }

      serverLogger.info(`Retrieved scheduled run for ${supermarketName}`);
      res.status(200).json(scheduledRun);
    } catch (error: any) {
      const errorMessage = error.message || "Unknown error";
      serverLogger.error(`Error fetching scheduled run: ${errorMessage}`);
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  }
);

// Toggle scheduled run for a supermarket
router.put(
  "/scheduler/toggle/:supermarket",
  async (req: Request, res: Response) => {
    try {
      const supermarketParam = req.params.supermarket.toLowerCase();
      const { enabled } = req.body;

      if (typeof enabled !== "boolean") {
        return res.status(400).json({
          success: false,
          error: "enabled field must be a boolean",
        });
      }

      // Map URL params to full supermarket names
      const nameMap: { [key: string]: string } = {
        "albert-heijn": "Albert Heijn",
        aldi: "Aldi",
        dirk: "Dirk",
        hoogvliet: "Hoogvliet",
        jumbo: "Jumbo",
        lidl: "Lidl",
        plus: "PLUS",
      };

      const supermarketName = nameMap[supermarketParam];

      if (!supermarketName) {
        serverLogger.warn(
          `Invalid supermarket parameter: ${req.params.supermarket}`
        );
        return res.status(400).json({
          success: false,
          error: `Unknown supermarket: ${req.params.supermarket}. Valid values: albert-heijn, aldi, dirk, hoogvliet, jumbo, lidl, plus`,
        });
      }

      serverLogger.info(
        `Toggling scheduled run for "${supermarketName}" to ${enabled}`
      );

      const scheduledRunController = dataManager.getScheduledRunController();
      const success = await scheduledRunController.toggleScheduledRun(
        supermarketName,
        enabled
      );

      if (!success) {
        return res.status(404).json({
          success: false,
          error: `No scheduled run found for ${supermarketName}`,
        });
      }

      serverLogger.info(
        `Scheduled run for ${supermarketName} toggled to ${enabled}`
      );
      res.status(200).json({
        success: true,
        message: `Scheduled run for ${supermarketName} ${
          enabled ? "enabled" : "disabled"
        }`,
      });
    } catch (error: any) {
      const errorMessage = error.message || "Unknown error";
      serverLogger.error(`Error toggling scheduled run: ${errorMessage}`);
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  }
);

// Get due scheduled runs (for internal scheduler use)
router.get("/scheduler/due", async (req: Request, res: Response) => {
  try {
    serverLogger.info("Fetching due scheduled runs");

    const scheduledRunController = dataManager.getScheduledRunController();
    const dueRuns = await scheduledRunController.getDueScheduledRuns();

    serverLogger.info(`Retrieved ${dueRuns.length} due scheduled runs`);
    res.status(200).json(dueRuns);
  } catch (error: any) {
    const errorMessage = error.message || "Unknown error";
    serverLogger.error(`Error fetching due scheduled runs: ${errorMessage}`);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

// Manually deactivate expired discounts
router.post("/discounts/cleanup", async (req: Request, res: Response) => {
  try {
    serverLogger.info("Manually triggered expired discounts cleanup");

    const discountController = dataManager.getDiscountController();
    const deactivatedCount =
      await discountController.deactivateExpiredDiscounts();

    serverLogger.info(`Deactivated ${deactivatedCount} expired discounts`);
    res.status(200).json({
      success: true,
      message: `Deactivated ${deactivatedCount} expired discounts`,
      deactivatedCount,
    });
  } catch (error: any) {
    const errorMessage = error.message || "Unknown error";
    serverLogger.error(`Error during cleanup: ${errorMessage}`);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

export default router;
