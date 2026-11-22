import { exportAlumnusJson } from "@/lib/alumni/routes";

export const dynamic = "force-dynamic";

/** Data export for one alumnus (access request). Admins / coaches with alumni access. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return exportAlumnusJson(id);
}
