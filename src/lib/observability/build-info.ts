/**
 * Build / runtime identity of this deployment. Safe to expose publicly
 * (no secrets): used by /api/health, log lines and error reports.
 *
 * Works on Vercel (VERCEL_* system vars), in Docker (APP_VERSION / GIT_SHA
 * build args) and locally (falls back to "dev").
 */
export type AppEnvironment = "local" | "staging" | "production";
export type DataRegion = "eu" | "us";

function clean(v: string | undefined): string | undefined {
  return v && v.trim() !== "" ? v.trim() : undefined;
}

export function appEnvironment(): AppEnvironment {
  const explicit = clean(process.env.APP_ENV);
  if (explicit === "local" || explicit === "staging" || explicit === "production") return explicit;
  // Vercel: "production" | "preview" | "development"
  const vercel = clean(process.env.VERCEL_ENV);
  if (vercel === "production") return "production";
  if (vercel === "preview") return "staging";
  return process.env.NODE_ENV === "production" ? "production" : "local";
}

/** Data region this deployment serves. One deployment per region (see docs/ops/ARCHITECTURE_DEPLOYMENT.md). */
export function dataRegion(): DataRegion {
  return clean(process.env.DATA_REGION) === "us" ? "us" : "eu";
}

export function buildInfo() {
  const commit =
    clean(process.env.GIT_SHA) ?? clean(process.env.VERCEL_GIT_COMMIT_SHA) ?? undefined;
  return {
    service: "club-os",
    version: clean(process.env.APP_VERSION) ?? (commit ? commit.slice(0, 7) : "dev"),
    commit: commit ?? null,
    environment: appEnvironment(),
    region: dataRegion(),
    hostRegion: clean(process.env.VERCEL_REGION) ?? clean(process.env.HOST_REGION) ?? null,
  };
}
