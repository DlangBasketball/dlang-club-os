"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Card, CardBody } from "./card";
import { Button } from "./button";
import { useT } from "@/lib/i18n/client";

/**
 * Error state for a route segment (error.tsx). A page whose data could not
 * be loaded shows this inside the app shell, with a retry, instead of an
 * empty list or the browser's generic error page.
 */
export function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT();
  useEffect(() => {
    console.error("route error", error.digest ?? error.message);
  }, [error]);
  return (
    <div className="animate-fade-up py-10" role="alert">
      <Card className="mx-auto max-w-lg">
        <CardBody className="flex flex-col items-center gap-4 py-10 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-danger-soft text-danger">
            <AlertTriangle className="h-6 w-6" />
          </span>
          <div>
            <h2 className="text-lg font-semibold">{t("common.routeError.title")}</h2>
            <p className="mt-1 text-sm text-ink-2">{t("common.routeError.body")}</p>
            {error.digest && <p className="mt-2 font-mono text-xs text-ink-3">{t("common.routeError.reference", { ref: error.digest })}</p>}
          </div>
          <Button onClick={() => reset()}>{t("common.routeError.retry")}</Button>
        </CardBody>
      </Card>
    </div>
  );
}
