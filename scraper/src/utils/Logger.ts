import DateTimeHandler from "./DateTimeHandler";
import path from "path";
import * as dotenv from "dotenv";

// Load .env from project root (three levels up from this file)
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

enum LogLevel {
  ERROR = 1,
  WARN = 2,
  INFO = 3,
  DEBUG = 4,
}

/**
 * Logs to stdout/stderr only; Docker keeps and rotates the container log
 * (docker-compose `logging`). INFO holds what is needed to follow and debug
 * the runs: startup, migrations, the scheduler's decisions, each run's start
 * and result, one total per supermarket and step, and every warning and
 * error. Per page, per request and per query detail is DEBUG
 * (LOG_LEVEL=DEBUG).
 */
class Logger {
  private currentLogLevel: LogLevel;

  constructor() {
    const levelName = (process.env.LOG_LEVEL?.toUpperCase() as keyof typeof LogLevel) || "INFO";
    this.currentLogLevel = LogLevel[levelName] ?? LogLevel.INFO;
  }

  private shouldLog(level: LogLevel): boolean {
    return level <= this.currentLogLevel;
  }

  /** An error as its message (its stack too at DEBUG); other values on one line. */
  private formatParam(param: unknown): string {
    if (param instanceof Error) {
      return this.currentLogLevel >= LogLevel.DEBUG && param.stack ? param.stack : param.message;
    }
    if (param && typeof param === "object") {
      const message = (param as { message?: unknown }).message;
      if (typeof message === "string") return message;
      try {
        return JSON.stringify(param);
      } catch {
        return String(param);
      }
    }
    return String(param);
  }

  private format(level: string, message: string, optionalParams: unknown[]): string {
    const timestamp = DateTimeHandler.getDateTimeString("YYYY-MM-DD HH:mm:ss.SSS");
    const extra = optionalParams.map((p) => " " + this.formatParam(p)).join("");
    return `[${timestamp}] [${level}] ${message}${extra}`;
  }

  public debug(message: string, ...optionalParams: unknown[]) {
    if (this.shouldLog(LogLevel.DEBUG)) console.debug(this.format("DEBUG", message, optionalParams));
  }

  public info(message: string, ...optionalParams: unknown[]) {
    if (this.shouldLog(LogLevel.INFO)) console.info(this.format("INFO", message, optionalParams));
  }

  public warn(message: string, ...optionalParams: unknown[]) {
    if (this.shouldLog(LogLevel.WARN)) console.warn(this.format("WARN", message, optionalParams));
  }

  public error(message: string, ...optionalParams: unknown[]) {
    if (this.shouldLog(LogLevel.ERROR)) console.error(this.format("ERROR", message, optionalParams));
  }
}

const logger = new Logger();

/** Server, scheduler and API logging. */
export const serverLogger = logger;

/** Scraping and storage logging; the same stream as serverLogger. */
export const scraperLogger = logger;
