import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, ErrorState, Card, CardHeader, CardTitle, CardBody } from "@/components/ui";
import { getInvoiceForEdit, listFamilyOptions } from "@/lib/data/money-edit";
import { getInvoiceDetail } from "@/lib/data/invoices";
import { DraftInvoiceEditor, InvoiceDetailsForm } from "@/components/money/invoice-editor";
import { InvoiceMoneyActions } from "@/components/money/invoice-money-actions";
import { AdjustmentList } from "@/components/money/money-panels";
import { getTranslations } from "@/lib/i18n/server";
import { formatQrReference } from "@/lib/swiss-payments";

/**
 * Edit an invoice. Drafts (never issued) are edited freely; issued invoices
 * only get safe edits here, amount changes go through credit / debit notes.
 * Access: the (admin) layout gate + RLS + the RPCs' admin/finance check.
 */
export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getTranslations();
  const { id } = await params;
  const { data, error } = await getInvoiceForEdit(id);
  if (error) return <ErrorState title={t("editMoney.errors.loadFailed")} message={error} />;
  if (!data) notFound();

  const title = t("editMoney.invoice.editTitle", { number: data.number });
  const back = (
    <Link href={`/admin/invoices/${data.id}`} className="text-sm text-maroon hover:underline">
      {t("editMoney.common.backToInvoice")}
    </Link>
  );

  if (data.status === "draft") {
    const families = await listFamilyOptions();
    return (
      <div className="animate-fade-up space-y-4">
        <PageHeader title={<span className="tnum">{title}</span>} actions={back} />
        <DraftInvoiceEditor
          id={data.id}
          number={data.number}
          currency={data.currency}
          reference={data.reference ? formatQrReference(data.reference) : null}
          families={families}
          initial={data}
        />
      </div>
    );
  }

  const { data: detail } = await getInvoiceDetail(id);
  if (!detail) notFound();
  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={<span className="tnum">{title}</span>} actions={back} />
      <InvoiceMoneyActions
        id={detail.id}
        number={detail.number}
        status={detail.status}
        currency={detail.currency}
        total={detail.total}
        adjustmentsTotal={detail.adjustmentsTotal}
        paid={detail.paid}
        remindersPaused={detail.remindersPaused}
      />
      <InvoiceDetailsForm
        id={data.id}
        initial={{ dueDate: data.dueDate, notes: data.notes, locale: data.locale, remindersPaused: detail.remindersPaused }}
      />
      <Card className="max-w-3xl">
        <CardHeader><CardTitle>{t("editMoney.adjust.listTitle")}</CardTitle></CardHeader>
        <CardBody className="p-0"><AdjustmentList adjustments={detail.adjustments} currency={detail.currency} /></CardBody>
      </Card>
    </div>
  );
}
