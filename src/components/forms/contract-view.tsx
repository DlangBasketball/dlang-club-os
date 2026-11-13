import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Download } from "lucide-react";
import { Badge, Button, Card, CardBody, ErrorState, PageHeader } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { getContract } from "@/lib/contracts/data";
import { ContractAdminActions, ContractSignForm } from "./record-actions";

export const contractTone = (s: string): "success" | "danger" | "warning" => (s === "signed" ? "success" : s === "void" ? "danger" : "warning");

/** One contract: text, acceptance evidence, PDF; admin actions or the guardian's accept form. */
export async function ContractView({ id, mode }: { id: string; mode: "admin" | "parent" }) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { t, f } = await getI18n();
  const [res, me] = await Promise.all([getContract(id), getSessionUser()]);
  if (res.error !== null) return <ErrorState title={t("forms.errors.loadFailed")} message={res.error} />;
  if (!res.data) notFound();
  const c = res.data;
  const back = mode === "admin" ? "/admin/contracts" : "/parent/contracts";
  return (
    <div className="animate-fade-up max-w-3xl space-y-5">
      <Link href={back} className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink"><ChevronLeft className="h-3.5 w-3.5" /> {mode === "admin" ? t("forms.contracts.title") : t("forms.parent.contracts")}</Link>
      <PageHeader title={c.title} description={[c.athleteName, c.familyName].filter(Boolean).join(" · ")}
        actions={c.pdfUrl ? <a href={c.pdfUrl} target="_blank" rel="noreferrer"><Button size="sm" variant="secondary"><Download className="h-4 w-4" /> {t("forms.contracts.pdf.download")}</Button></a> : undefined} />
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={contractTone(c.status)}>{t.dynamic(`forms.contractStatus.${c.status}`)}</Badge>
        <Badge tone="neutral">{t("forms.contracts.versionLabel", { version: c.templateVersion })}</Badge>
        <span className="text-xs text-ink-3">{t("forms.contracts.issuedOn", { date: f.dateTime(c.issuedAt) })}</span>
      </div>
      {c.status === "signed" && c.signedAt && (
        <p className="rounded bg-success-soft px-3 py-2 text-sm text-success">{t("forms.contracts.signedBy", { name: c.signerName ?? "", date: f.dateTime(c.signedAt) })}</p>
      )}
      {c.status === "void" && (
        <p className="rounded bg-danger-soft px-3 py-2 text-sm text-danger">{t("forms.contracts.voidedBecause", { reason: c.voidReason ?? "" })}</p>
      )}
      {mode === "admin" && c.reissuedFrom && (
        <p className="text-xs text-ink-3"><Link href={`/admin/contracts/${c.reissuedFrom}`} className="text-maroon hover:underline">{t("forms.contracts.reissuedFrom")}</Link></p>
      )}
      <Card><CardBody>
        <div className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{c.body}</div>
      </CardBody></Card>
      {mode === "parent" && c.status === "issued" && (
        <Card><CardBody><ContractSignForm id={c.id} defaultName={me?.fullName ?? ""} /></CardBody></Card>
      )}
      {mode === "admin" && <ContractAdminActions id={c.id} status={c.status} />}
    </div>
  );
}
