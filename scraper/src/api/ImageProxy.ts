import axios, { AxiosInstance } from "axios";
import crypto from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import PostgresDataContext from "../data/PostgresDataContext";
import { serverLogger } from "../utils/Logger";

/**
 * Serves product images from this API instead of the supermarkets' servers.
 *
 * Consumers (web, Baskit) get one stable URL per product and do not depend on
 * hotlinking rules or the speed of each supermarket's image server. The first
 * request fetches the image (products.image_url) and keeps it on disk; later
 * requests are served from disk. The cache key includes the image URL, so a
 * new image at the supermarket is fetched again.
 */

const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 15000;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";

export interface ProxiedImage {
  body: Buffer;
  contentType: string;
  etag: string;
}

export class ImageProxy {
  private db: PostgresDataContext;
  private http: AxiosInstance;
  private cacheDir: string;
  private inFlight = new Map<string, Promise<ProxiedImage | null>>();

  constructor(db: PostgresDataContext, options: { cacheDir?: string; http?: AxiosInstance } = {}) {
    this.db = db;
    this.cacheDir =
      options.cacheDir ?? process.env.IMAGE_CACHE_DIR ?? path.join(os.tmpdir(), "supermarket-images");
    this.http =
      options.http ??
      axios.create({
        timeout: TIMEOUT_MS,
        maxContentLength: MAX_BYTES,
        responseType: "arraybuffer",
        headers: { "User-Agent": USER_AGENT, Accept: "image/avif,image/webp,image/*,*/*;q=0.8" },
      });
  }

  /** The image of a product, or null when it has none or it cannot be fetched. */
  async get(productId: number): Promise<ProxiedImage | null> {
    const result = await this.db.query<{ image_url: string | null }>(
      "SELECT image_url FROM products WHERE id = $1",
      [productId]
    );
    const url = result.rows[0]?.image_url;
    if (!url || !/^https?:\/\//i.test(url)) return null;

    const key = `${productId}-${crypto.createHash("sha1").update(url).digest("hex").slice(0, 16)}`;
    const cached = await this.readCache(key);
    if (cached) return cached;

    // Several requests for the same image while it is being fetched share one download.
    let pending = this.inFlight.get(key);
    if (!pending) {
      pending = this.fetchAndStore(key, url).finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, pending);
    }
    return pending;
  }

  private async readCache(key: string): Promise<ProxiedImage | null> {
    try {
      const [body, contentType] = await Promise.all([
        fs.readFile(path.join(this.cacheDir, key)),
        fs.readFile(path.join(this.cacheDir, `${key}.type`), "utf8"),
      ]);
      return { body, contentType, etag: `"${key}"` };
    } catch {
      return null;
    }
  }

  private async fetchAndStore(key: string, url: string): Promise<ProxiedImage | null> {
    try {
      const response = await this.http.get<ArrayBuffer>(url);
      const contentType = String(response.headers["content-type"] ?? "").split(";")[0].trim();
      if (!contentType.startsWith("image/")) {
        serverLogger.debug(`Image proxy: ${url} is ${contentType || "no image"}`);
        return null;
      }
      const body = Buffer.from(response.data);
      try {
        await fs.mkdir(this.cacheDir, { recursive: true });
        await fs.writeFile(path.join(this.cacheDir, key), body);
        await fs.writeFile(path.join(this.cacheDir, `${key}.type`), contentType);
      } catch (error: any) {
        // A full or read-only disk still serves the image, just without caching it.
        serverLogger.warn(`Image proxy: could not cache ${key}: ${error?.message}`);
      }
      return { body, contentType, etag: `"${key}"` };
    } catch (error: any) {
      serverLogger.debug(`Image proxy: ${url}: ${error?.response?.status ?? error?.message}`);
      return null;
    }
  }
}

export default ImageProxy;
