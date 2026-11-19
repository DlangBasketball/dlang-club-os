import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getLegalTenant } from "@/lib/compliance/tenant";
import { LEGAL_DOC_TITLES, isLegalDoc, renderLegalDocument } from "@/lib/compliance/legal-templates";
import { LegalDocumentView, LegalNav } from "@/components/compliance/legal-document";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ orgSlug: string; doc: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { orgSlug, doc } = await params;
  if (!isLegalDoc(doc)) return { title: "Legal" };
  const t = await getLegalTenant(orgSlug);
  return { title: t ? `${LEGAL_DOC_TITLES[doc]} — ${t.clubName}` : LEGAL_DOC_TITLES[doc] };
}

export default async function LegalDocPage({ params }: Params) {
  const { orgSlug, doc } = await params;
  if (!isLegalDoc(doc)) notFound();
  const tenant = await getLegalTenant(orgSlug);
  if (!tenant) notFound();
  const rendered = renderLegalDocument(doc, tenant);

  return (
    <div className="space-y-8">
      <LegalNav slug={tenant.slug} active={doc} />
      <LegalDocumentView doc={rendered} />
    </div>
  );
}
