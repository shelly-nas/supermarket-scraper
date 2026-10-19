export interface Product {
  id: number;
  name: string;
  category: string;
  supermarket: string;
  product_url: string | null;
  /** Image at the supermarket; shown through the API's image proxy. */
  image_url?: string | null;
  brand?: string | null;
  /** Pack size as the supermarket writes it ("6 x 48 g"), when known. */
  unit_size?: string | null;
  /** Pack quantity in quantity_unit (0.288 for 288 g), for the price per unit. */
  quantity_value?: number | null;
  quantity_unit?: 'kg' | 'l' | 'stuk' | null;
  created_at: string;
  updated_at: string;
}

export interface Discount {
  id: number;
  product_id: number;
  original_price: number;
  discount_price: number;
  special_discount: string | null;
  expire_date: string;
  created_at: string;
  updated_at: string;
}

export interface ProductWithDiscount extends Product {
  discount: Discount;
}

export interface ColumnFilter {
  column: keyof ProductWithDiscount | "all";
  value: string;
}

// Configurations types
export interface ConfigurationsStats {
  totalRuns: number;
  successRate: number;
  scrapedProducts: number;
  uniqueProducts: number;
  nextScheduledRun?: string;
}

export interface SupermarketStatus {
  key: string;
  name: string;
  status: "success" | "failed" | "running" | "pending";
  lastRun?: string;
  productsScraped?: number;
  promotionExpireDate?: string | null;
  scheduledEnabled?: boolean;
}

export interface ScraperRun {
  id: number;
  supermarket: string;
  status: "running" | "success" | "failed" | "pending";
  productsScraped: number;
  productsCreated: number;
  productsUpdated: number;
  discountsCreated: number;
  discountsDeactivated: number;
  errorMessage?: string;
  startedAt: string;
  completedAt?: string;
  durationSeconds?: number;
}

export interface CatalogRun {
  id: number;
  supermarket: string;
  status: 'running' | 'success' | 'failed';
  products_seen: number;
  products_created: number;
  products_updated: number;
  prices_changed: number;
  products_removed: number;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
  duration_seconds: number | null;
}

export interface CatalogStatus {
  key: string;
  name: string;
  supported: boolean;
  running: boolean;
  productsInCatalog: number;
  lastUpdated: string | null;
  lastRun: CatalogRun | null;
}
