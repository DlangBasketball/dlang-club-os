import Link from "next/link";
import { FilePen } from "lucide-react";
import { Badge, Card, CardBody, EmptyState, ErrorState, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { listContracts } from "@/lib/contracts/data";
import { contractTone } from "@/components/forms/contract-view";

export const dynamic = "force-dynamic";

/** "My contracts": the family's participation contracts (to accept, accepted, voided). */
export default async function MyContractsPage() {
  await requireRole(["parent"]);
  const { t, f } = await getI18n();
  const res = await listContracts();
  if (res.error !== null) return <ErrorState title={t("forms.errors.loadFailed")} message={res.error} />;
  const items = res.data;
  return (
    <div className="animate-fade-up max-w-3xl space-y-5">
      <PageHeader title={t("forms.parent.contracts")} description={t("forms.parent.contractsDescription")} />
      {items.length === 0 ? <EmptyState icon={<FilePen className="h-5 w-5" />} title={t("forms.parent.noContracts")} /> : (
        <Card><CardBody className="p-0">
          <ul className="divide-y divide-line-soft">
            {items.map((c) => (
              <li key={c.id}>
                <Link href={`/parent/contracts/${c.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 hover:bg-surface-elevated/40">
                  <span>
                    <span className="block text-sm font-medium text-ink">{c.title}</span>
                    <span className="block text-xs text-ink-3">{[c.athleteName, f.date(c.issuedAt)].filter(Boolean).join(" · ")}</span>
                  </span>
                  <Badge tone={contractTone(c.status)}>{c.status === "issued" ? t("forms.parent.toSign") : t.dynamic(`forms.contractStatus.${c.status}`)}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        </CardBody></Card>
      )}
    </div>
  );
}
