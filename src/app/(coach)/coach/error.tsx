"use client";

import { RouteError } from "@/components/ui/route-error";

export default function CoachError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} />;
}
