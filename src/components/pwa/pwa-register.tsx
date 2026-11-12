"use client";

import { useEffect } from "react";
// Side-effect import: starts listening for `beforeinstallprompt` on every page.
import "./install-store";

/**
 * Registers the service worker (/sw.js) in production builds only, so local
 * development never serves stale assets from a worker cache.
 */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
    };
    if (document.readyState === "complete") register();
    else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);
  return null;
}
