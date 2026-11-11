import { renderInvoicePdf } from "@/lib/invoice-pdf-response";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return renderInvoicePdf(id);
}
