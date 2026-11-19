import { renderInvoicePdf } from "@/lib/invoice-pdf-response";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Invoice PDF; `?installment=<id>` renders the QR-bill for one instalment of its plan. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const installmentId = new URL(req.url).searchParams.get("installment");
  return renderInvoicePdf(id, { installmentId });
}
