import { renderMemberCardPdf } from "@/lib/member-cards/card-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Printable member card (PDF) with the athlete's QR code. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return renderMemberCardPdf(id);
}
