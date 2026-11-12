import { buildServiceWorkerScript, swVersion } from "@/lib/pwa/service-worker";

/**
 * The service worker script at /sw.js (root scope). Same for every tenant:
 * each club host is its own origin, so caches never mix between clubs.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return new Response(buildServiceWorkerScript(swVersion()), {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      // Browsers must always revalidate the worker so updates roll out.
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Service-Worker-Allowed": "/",
    },
  });
}
