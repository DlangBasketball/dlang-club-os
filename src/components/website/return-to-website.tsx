"use client";

import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { safeReturnTo } from "@/lib/website/origins";

const KEY = "dlang:return_to";

/**
 * "Back to the club website" link for visitors who came from an embed
 * (?return_to=…). The target must be on one of the club's allowed website
 * origins (validated here against the server-provided list, so it is never
 * an open redirect); it is kept in sessionStorage so it survives checkout
 * and login round trips in the same tab.
 */
export function ReturnToWebsite({ allowedOrigins, label }: { allowedOrigins: string[]; label: string }) {
  const [href, setHref] = useState<string | null>(null);
  useEffect(() => {
    try {
      const fromQuery = safeReturnTo(new URLSearchParams(window.location.search).get("return_to"), allowedOrigins);
      if (fromQuery) sessionStorage.setItem(KEY, fromQuery);
      setHref(fromQuery ?? safeReturnTo(sessionStorage.getItem(KEY), allowedOrigins));
    } catch {
      setHref(null);
    }
  }, [allowedOrigins]);
  if (!href) return null;
  return (
    <a href={href} className="inline-flex items-center gap-1 text-sm text-brand-primary hover:underline">
      <ArrowLeft className="h-4 w-4" aria-hidden />
      {label}
    </a>
  );
}
