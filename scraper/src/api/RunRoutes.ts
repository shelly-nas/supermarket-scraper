import { Request, Response, Router } from "express";
import RunService, { RunInProgressError } from "../services/RunService";
import { SUPERMARKETS } from "./ProductSearch";
import { serverLogger } from "../utils/Logger";

/** Starting a run (assortment and offers) by hand, mounted under /api/scraper. */
export function createRunRoutes(service: RunService): Router {
  const router = Router();

  // Starts a run in the background (202); its progress shows in /api/scraper/runs
  router.post("/run/:supermarket", async (req: Request, res: Response) => {
    const supermarket = SUPERMARKETS.find((s) => s.key === String(req.params.supermarket).toLowerCase());
    if (!supermarket) {
      res.status(400).json({
        success: false,
        error: `Unknown supermarket: ${req.params.supermarket}. Valid values: ${SUPERMARKETS.map((s) => s.key).join(", ")}`,
      });
      return;
    }
    try {
      const { runId } = await service.start(supermarket.name);
      res.status(202).json({ success: true, runId, supermarket: supermarket.name });
    } catch (error: any) {
      if (error instanceof RunInProgressError) {
        res.status(409).json({ success: false, error: error.message });
        return;
      }
      serverLogger.error(`Run for ${supermarket.name} could not start: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
}
