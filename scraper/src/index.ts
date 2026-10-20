import express, { Request, Response, Application } from "express";
import cors from "cors";
import { serverLogger } from "./utils/Logger";
import PostgresDataManager from "./data/PostgresDataManager";
import SchedulerService from "./services/SchedulerService";
import routes from "./api/Routes";
import { runMigrations } from "./data/Migrations";
import publicRoutes from "./api/PublicRoutes";
import { createCatalogRoutes } from "./api/CatalogRoutes";
import CatalogService from "./services/CatalogService";


const app: Application = express();
const PORT = process.env.API_PORT || 3001;

// Middleware
// CORS_ORIGINS: comma separated list of allowed origins (e.g. the Baskit web app).
// When unset every origin is allowed, which keeps local development simple.
const corsOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter((o) => o.length > 0);
app.use(cors(corsOrigins.length > 0 ? { origin: corsOrigins } : undefined));
app.use(express.json());

// Request logging middleware
app.use((req: Request, res: Response, next) => {
  serverLogger.info(`${req.method} ${req.path}`);
  next();
});

// Response logging middleware
app.use((req: Request, res: Response, next) => {
  const originalSend = res.send;
  res.send = function (data) {
    serverLogger.info(`${req.method} ${req.path} - Status: ${res.statusCode}`);
    return originalSend.call(this, data);
  };
  next();
});

// Initialize database connection
async function initializeDatabase(): Promise<boolean> {
  const dataManager = new PostgresDataManager();
  try {
    const connected = await dataManager.testConnection();
    if (connected) {
      serverLogger.info("Database connection established successfully");
      await runMigrations(dataManager.db);
      const filled = await dataManager.getProductController().backfillMatchFields();
      if (filled > 0) serverLogger.info(`Filled match fields of ${filled} existing products`);
    } else {
      serverLogger.error("Failed to establish database connection");
    }
    return connected;
  } catch (error) {
    serverLogger.error("Error during database initialization:", error);
    return false;
  }
  // Don't close the pool - it's a singleton that should stay open
}

// Full catalog scrapes (regular prices), shared by the admin routes and the scheduler
const catalogService = new CatalogService(new PostgresDataManager().db);

// Register API routes
// Public read-only API for consumer apps (Baskit)
app.use("/api/public/v1", publicRoutes);
// Catalog admin endpoints (status, runs, manual trigger)
app.use("/api/catalog", createCatalogRoutes(catalogService, new PostgresDataManager().db));
// Admin API used by the management web frontend
app.use("/api", routes);

// 404 handler
app.use((req: Request, res: Response) => {
  serverLogger.warn(`404 Not Found: ${req.method} ${req.path}`);
  res.status(404).json({
    error: "Not Found",
    message: `Route ${req.method} ${req.path} not found`,
  });
});

// Start server
async function startServer() {
  // Test database connection on startup
  const dbConnected = await initializeDatabase();

  if (!dbConnected) {
    serverLogger.error("Cannot start server - database connection failed");
    process.exit(1);
  }

  const staleCatalogRuns = await catalogService.getController().failStaleRuns();
  if (staleCatalogRuns > 0) {
    serverLogger.warn(`Marked ${staleCatalogRuns} interrupted catalog run(s) as failed`);
  }

  app.listen(PORT, () => {
    serverLogger.info(`API Server is running on port ${PORT}`);
    serverLogger.info(`Health check: http://localhost:${PORT}/health`);
    serverLogger.info(
      `Run scraper: POST http://localhost:${PORT}/scraper/run/:supermarket`
    );

    // Start the scheduler service
    const dataManager = new PostgresDataManager();
    const scheduler = new SchedulerService(dataManager, PORT.toString(), catalogService);
    scheduler.start();
    serverLogger.info("Automated scheduler service initialized");
  });
}

// Start the application
startServer().catch((error) => {
  serverLogger.error("Failed to start server:", error);
  process.exit(1);
});
