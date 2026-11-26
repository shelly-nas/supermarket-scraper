import { scraperLogger } from "../utils/Logger";

abstract class ApiClient {
  abstract name: string;

  public abstract fetchDiscounts(): Promise<{
    discounts: IProductDiscountDetails[];
    expireDate: string;
  }>;

  protected logInfo(message: string): void {
    scraperLogger.debug(message);
  }

  protected logDebug(message: string): void {
    scraperLogger.debug(message);
  }

  protected logWarn(message: string): void {
    scraperLogger.warn(message);
  }

  protected logError(message: string, error?: unknown): void {
    scraperLogger.error(message, error);
  }
}

export default ApiClient;
