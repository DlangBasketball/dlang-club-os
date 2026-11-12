import { TEMPLATE_CSV } from "../csv";

/** Downloadable CSV template (example rows use fictitious example.com data). */
export function GET() {
  return new Response("﻿" + TEMPLATE_CSV, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="club-import-template.csv"',
      "Cache-Control": "no-store",
    },
  });
}
