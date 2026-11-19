import { redact } from "@/lib/log";
import { buildInfo } from "./build-info";
import { logger } from "./logger";

/**
 * Error reporting with NO hard dependency on any vendor SDK.
 *
 * - Always: a redacted structured log line (level=error).
 * - If SENTRY_DSN is set: the event is also sent to Sentry's envelope endpoint
 *   over plain fetch (works with Sentry SaaS EU/US or a self-hosted /
 *   Sentry-compatible backend such as GlitchTip).
 * - If you later install an SDK (e.g. @sentry/nextjs), register it with
 *   `setErrorReporter()` and it replaces the built-in HTTP sender.
 *
 * Never throws: reporting must not break the request that failed.
 */
export type ErrorContext = {
  /** Where it happened, e.g. "stripe.webhook" or "import.commit". */
  context?: string;
  orgId?: string | null;
  userId?: string | null;
  requestId?: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
};

export type ErrorReporter = (err: unknown, ctx: ErrorContext & { eventId: string }) => void | Promise<void>;

let customReporter: ErrorReporter | null = null;

/** Plug in a vendor SDK (optional). Call once at startup, e.g. from src/instrumentation.ts. */
export function setErrorReporter(fn: ErrorReporter | null) {
  customReporter = fn;
}

type ParsedDsn = { endpoint: string; publicKey: string };

function parseDsn(dsn: string | undefined): ParsedDsn | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\/+/, "").split("/").pop();
    if (!u.username || !projectId) return null;
    const pathPrefix = u.pathname.replace(/\/[^/]*$/, ""); // self-hosted under a sub-path
    return {
      endpoint: `${u.protocol}//${u.host}${pathPrefix}/api/${projectId}/envelope/`,
      publicKey: u.username,
    };
  } catch {
    return null;
  }
}

function toException(err: unknown) {
  const e = err instanceof Error ? err : new Error(String(err));
  return {
    type: e.name || "Error",
    value: String(redact(e.message)),
    stacktrace: e.stack ? String(redact(e.stack)).slice(0, 8000) : undefined,
  };
}

async function sendToSentry(dsn: ParsedDsn, err: unknown, ctx: ErrorContext, eventId: string) {
  const info = buildInfo();
  const ex = toException(err);
  const event = {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: "node",
    level: "error",
    release: info.commit ?? info.version,
    environment: process.env.SENTRY_ENVIRONMENT ?? info.environment,
    server_name: info.hostRegion ?? undefined,
    tags: { region: info.region, context: ctx.context ?? "unknown", ...(ctx.tags ?? {}) },
    // org/user ids are opaque UUIDs (not PII by themselves); no emails sent.
    user: ctx.userId ? { id: ctx.userId } : undefined,
    extra: redact({ orgId: ctx.orgId, requestId: ctx.requestId, ...(ctx.extra ?? {}) }),
    exception: { values: [{ type: ex.type, value: ex.value }] },
    message: ex.stacktrace ? { formatted: ex.stacktrace } : undefined,
  };
  const body =
    JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() }) +
    "\n" +
    JSON.stringify({ type: "event" }) +
    "\n" +
    JSON.stringify(event);
  await fetch(dsn.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-sentry-envelope",
      "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=club-os/1.0`,
    },
    body,
    signal: AbortSignal.timeout(2000),
  });
}

/**
 * Report an error. Returns a short reference id you can show to the user
 * ("ref a1b2c3d4") and search for in logs / Sentry.
 */
export function captureException(err: unknown, ctx: ErrorContext = {}): string {
  const eventId = crypto.randomUUID().replace(/-/g, "");
  const ref = eventId.slice(0, 8);
  try {
    const ex = toException(err);
    logger.error(ex.value, {
      ref,
      context: ctx.context,
      errorType: ex.type,
      orgId: ctx.orgId ?? undefined,
      requestId: ctx.requestId,
      stack: ex.stacktrace,
      ...(ctx.extra ?? {}),
    });
    if (customReporter) {
      void Promise.resolve(customReporter(err, { ...ctx, eventId })).catch(() => {});
    } else {
      const dsn = parseDsn(process.env.SENTRY_DSN);
      if (dsn) void sendToSentry(dsn, err, ctx, eventId).catch(() => {});
    }
  } catch {
    /* never throw from the reporter */
  }
  return ref;
}

/** True when an external error sink is configured (used by /api/health). */
export function errorReportingConfigured(): boolean {
  return customReporter !== null || parseDsn(process.env.SENTRY_DSN) !== null;
}
