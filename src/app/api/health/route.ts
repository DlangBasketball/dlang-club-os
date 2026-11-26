import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { buildInfo } from "@/lib/observability/build-info";
import { checkEnv } from "@/lib/observability/env-check";
import { errorReportingConfigured } from "@/lib/observability/error-reporting";
import { logger } from "@/lib/observability/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const startedAt = Date.now();

/**
 * Health endpoint for load balancers, uptime monitors and deploy smoke tests.
 *
 *   GET /api/health?probe=live   -> liveness: process is up (no I/O). Always 200.
 *   GET /api/health              -> readiness: database reachable + config sane.
 *                                   200 "ok" | 200 "degraded" | 503 "down".
 *
 * Public output contains no secrets and no tenant data. Variable NAMES of
 * missing/invalid config are only returned when the caller sends
 * `Authorization: Bearer <HEALTH_CHECK_TOKEN>`.
 * Excluded from the auth middleware (see src/middleware.ts matcher).
 */
export async function GET(req: Request) {
  const info = buildInfo();
  const headers = { "Cache-Control": "no-store, max-age=0" };
  const probe = new URL(req.url).searchParams.get("probe");

  if (probe === "live") {
    return NextResponse.json({ status: "ok", version: info.version }, { headers });
  }

  const [db, env] = await Promise.all([checkDatabase(), Promise.resolve(checkEnv())]);

  const status: "ok" | "degraded" | "down" =
    db.status === "down" ? "down" : env.ok && db.status === "ok" ? "ok" : "degraded";

  const body: Record<string, unknown> = {
    status,
    ...info,
    time: new Date().toISOString(),
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    checks: {
      database: db,
      config: { status: env.ok ? "ok" : "degraded" },
      errorReporting: { status: errorReportingConfigured() ? "ok" : "not_configured" },
    },
  };

  if (authorized(req)) {
    body.details = { missing: env.missing, invalid: env.invalid, warnings: env.warnings };
  }

  if (status !== "ok") logger.warn("health check not ok", { status, db: db.status, configOk: env.ok });

  return NextResponse.json(body, { status: status === "down" ? 503 : 200, headers });
}

function authorized(req: Request): boolean {
  const token = process.env.HEALTH_CHECK_TOKEN;
  if (!token) return false;
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Round-trip to Postgres through PostgREST (service role, 1 row, no tenant
 * data returned to the caller). Plain fetch keeps this independent of the
 * typed client and lets us enforce a hard timeout.
 */
async function checkDatabase(): Promise<{ status: "ok" | "down" | "not_configured"; latencyMs?: number; error?: string }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { status: "not_configured" };
  const t0 = Date.now();
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/organizations?select=id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    const latencyMs = Date.now() - t0;
    if (!res.ok) return { status: "down", latencyMs, error: `http_${res.status}` };
    return { status: "ok", latencyMs };
  } catch (err) {
    const name = err instanceof Error ? err.name : "error";
    return { status: "down", latencyMs: Date.now() - t0, error: name === "TimeoutError" ? "timeout" : "unreachable" };
  }
}
