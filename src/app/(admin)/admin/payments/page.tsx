import { CreditCard } from "lucide-react";
import { PageHeader, DataTable, EmptyState, Badge, statusTone, Card, CardBody, type Column } from "@/components/ui";
import { formatCHF } from "@/lib/utils";

type Pay = { id: string; invoice: string; method: string; status: string; amount: number; date: string };
const SAMPLE: Pay[] = [
  { id: "1", invoice: "INV-2026-0182", method: "TWINT", status: "succeeded", amount: 290, date: "28.04.2026" },
];
const columns: Column<Pay>[] = [
  { key: "invoice", header: "Invoice", render: (r) => <span className="tnum font-medium text-ink">{r.invoice}</span> },
  { key: "method", header: "Method" },
  { key: "date", header: "Date" },
  { key: "status", header: "Status", render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
  { key: "amount", header: "Amount", align: "right", render: (r) => <span className="tnum">{formatCHF(r.amount)}</span> },
];
const FILTERS = ["All", "Paid", "Pending", "Overdue"];

export default function PaymentsPage() {
  return (
    <div className="animate-fade-up">
      <PageHeader title="Payments" description="Status updates only from verified Stripe webhooks — never the client." />
      <Card className="mb-4">
        <CardBody className="flex flex-wrap items-center gap-2 py-3">
          {FILTERS.map((f, i) => (
            <span key={f} className={`rounded-full px-3 py-1 text-xs ${i === 0 ? "bg-maroon-soft text-maroon" : "bg-surface-elevated text-ink-3"}`}>{f}</span>
          ))}
          <span className="ml-auto text-xs text-ink-3">Total collected: <span className="tnum text-ink">{formatCHF(290)}</span></span>
        </CardBody>
      </Card>
      <DataTable columns={columns} rows={SAMPLE} getRowKey={(r) => r.id}
        empty={<EmptyState icon={<CreditCard className="h-5 w-5" />} title="No payments yet" />} />
    </div>
  );
}
