import { redact } from "@/lib/log";
import { buildInfo } from "./build-info";

/**
 * Structured JSON logger (one line per event). Every field is passed through
 * the redactor from src/lib/log.ts so emails, phones, IBANs, keys and JWTs are
 * masked before they reach stdout / the log drain (Vercel, Docker, Datadog…).
 *
 * Level is controlled by LOG_LEVEL (debug | info | warn | error; default info).
 */
export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const lvl = (process.env.LOG_LEVEL ?? "info").toLowerCase() as LogLevel;
  return ORDER[lvl] ?? ORDER.info;
}

function write(level: LogLevel, msg: string, fields?: LogFields) {
  if (ORDER[level] < threshold()) return;
  const { version, environment, region } = buildInfo();
  const line = JSON.stringify({
    level,
    msg: redact(msg),
    at: new Date().toISOString(),
    service: "club-os",
    version,
    env: environment,
    region,
    ...(fields ? (redact(fields) as LogFields) : {}),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export type Logger = {
  debug: (msg: string, fields?: LogFields) => void;
  info: (msg: string, fields?: LogFields) => void;
  warn: (msg: string, fields?: LogFields) => void;
  error: (msg: string, fields?: LogFields) => void;
  child: (fields: LogFields) => Logger;
};

function make(base: LogFields): Logger {
  const merge = (f?: LogFields) => (f ? { ...base, ...f } : base);
  return {
    debug: (m, f) => write("debug", m, merge(f)),
    info: (m, f) => write("info", m, merge(f)),
    warn: (m, f) => write("warn", m, merge(f)),
    error: (m, f) => write("error", m, merge(f)),
    child: (f) => make({ ...base, ...f }),
  };
}

/** Root logger. Use `logger.child({ orgId, requestId })` to bind context. */
export const logger: Logger = make({});
