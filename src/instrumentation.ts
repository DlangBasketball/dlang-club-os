/**
 * Next.js instrumentation hook. Routes every unhandled server error (Server
 * Components, Route Handlers, Server Actions, middleware) to the vendor-neutral
 * reporter in src/lib/observability. No-op cost when SENTRY_DSN is unset
 * (errors are still written as structured, redacted log lines).
 */
export async function register() {
  // Place to plug a vendor SDK later, e.g.:
  //   const Sentry = await import("@sentry/nextjs"); Sentry.init({...});
  //   (await import("@/lib/observability")).setErrorReporter((e) => Sentry.captureException(e));
}

export async function onRequestError(
  err: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routePath: string; routeType: string },
) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { captureException } = await import("@/lib/observability/error-reporting");
  captureException(err, {
    context: `next.${context.routeType}`,
    tags: { route: context.routePath, method: request.method, router: context.routerKind },
  });
}
