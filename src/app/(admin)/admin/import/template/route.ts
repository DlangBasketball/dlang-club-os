import { TEMPLATE_CSV } from "@/lib/import/families";
import { REGISTRATION_COLUMNS } from "@/lib/import/registrations";

/** Downloadable CSV templates (example rows use fictitious data). */
const REGISTRATIONS_CSV =
  REGISTRATION_COLUMNS.join(",") + "\n" + "Léa,Muster,14.03.2013,u12-team,confirmed,01.09.2025,\n";

export function GET(req: Request) {
  const kind = new URL(req.url).searchParams.get("kind") === "registrations" ? "registrations" : "families";
  const body = kind === "registrations" ? REGISTRATIONS_CSV : TEMPLATE_CSV;
  return new Response("﻿" + body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="club-import-${kind}-template.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
