import { exportAlumniCsv } from "@/lib/alumni/routes";

export const dynamic = "force-dynamic";

/** CSV export (or ?template=1) of alumni & placements. Admins / coaches with alumni access. */
export async function GET(request: Request) {
  return exportAlumniCsv(request);
}
