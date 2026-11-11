"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Card, CardBody, Button } from "@/components/ui";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to your error reporter (Sentry, etc.) in production.
    console.error("Dashboard error:", error);
  }, [error]);

  return (
    <div className="animate-fade-up py-10">
      <Card className="mx-auto max-w-lg">
        <CardBody className="flex flex-col items-center gap-4 py-10 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-danger-soft text-danger">
            <AlertTriangle className="h-6 w-6" />
          </span>
          <div>
            <h2 className="text-lg font-semibold">Something went wrong</h2>
            <p className="mt-1 text-sm text-ink-2">
              The dashboard couldn&apos;t load. This can happen if your session
              expired or the database is unreachable.
            </p>
          </div>
          <Button onClick={() => reset()}>Try again</Button>
        </CardBody>
      </Card>
    </div>
  );
}
