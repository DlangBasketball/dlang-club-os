"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

/** Supabase Realtime is not used in this codebase: poll by refreshing the server data. */
export const POLL_MS = 20_000;

/** Refresh the current route every 20 s while the tab is visible. */
export function AutoRefresh({ intervalMs = POLL_MS }: { intervalMs?: number }) {
  const router = useRouter();
  React.useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const id = window.setInterval(tick, intervalMs);
    const onVisible = () => document.visibilityState === "visible" && router.refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, intervalMs]);
  return null;
}
