import { PageHeader } from "@/components/ui";
import { listAllDocuments, documentTargets } from "@/lib/data/documents";
import { DocumentManager } from "@/components/admin/document-manager";

export default async function AdminDocumentsPage() {
  const [docs, targets] = await Promise.all([listAllDocuments(), documentTargets()]);
  return (
    <div className="animate-fade-up">
      <PageHeader title="Documents" description="Upload and share files — globally, or scoped to a program, family or athlete." />
      <DocumentManager docs={docs} targets={targets} />
    </div>
  );
}
