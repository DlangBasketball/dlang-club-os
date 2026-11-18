import { renderIncidentPdf } from "@/lib/club-admin/incident-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Incident report PDF (RLS-scoped read, audit-logged). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return renderIncidentPdf(id);
}
