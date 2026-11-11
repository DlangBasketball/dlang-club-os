import { Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, DataTable, EmptyState, Badge, statusTone, type Column } from "@/components/ui";
import { formatDate } from "@/lib/utils";
import { InviteForm } from "./invite-form";

type Invite = {
  id: string;
  email: string;
  role: string;
  status: string;
  created_at: string;
  expires_at: string;
};

const columns: Column<Invite>[] = [
  { key: "email", header: "Email", render: (r) => <span className="font-medium text-ink">{r.email}</span> },
  { key: "role", header: "Role" },
  { key: "created_at", header: "Sent", render: (r) => formatDate(r.created_at) },
  { key: "expires_at", header: "Expires", render: (r) => formatDate(r.expires_at) },
  { key: "status", header: "Status", render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
];

export default async function InvitationsPage() {
  const supabase = await createClient();
  // RLS returns only this org's invitations, and only to admins.
  const { data } = await supabase
    .from("invitations")
    .select("id, email, role, status, created_at, expires_at")
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as Invite[];

  // Families to attach a parent invite to (RLS-scoped).
  const { data: families } = await supabase
    .from("families")
    .select("id, name")
    .order("name");

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Invitations"
        description="Invite parents and staff by email. They're auto-linked to their family or role on first sign-in."
      />
      <div className="mb-6">
        <InviteForm families={(families ?? []) as { id: string; name: string }[]} />
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(r) => r.id}
        empty={<EmptyState icon={<Mail className="h-5 w-5" />} title="No invitations yet" description="Invite a parent to get started." />}
      />
    </div>
  );
}
