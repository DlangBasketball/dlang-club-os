import { Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, DataTable, EmptyState, Badge, statusTone, type Column } from "@/components/ui";
import { getFormatter } from "@/lib/i18n/server";
import type { Formatter } from "@/lib/format";
import { listUnlinkedCoaches } from "@/lib/data/coaches";
import { InviteForm } from "./invite-form";

type Invite = {
  id: string;
  email: string;
  role: string;
  status: string;
  created_at: string;
  expires_at: string;
};

const columnsFor = (f: Formatter): Column<Invite>[] => [
  { key: "email", header: "Email", render: (r) => <span className="font-medium text-ink">{r.email}</span> },
  { key: "role", header: "Role" },
  { key: "created_at", header: "Sent", render: (r) => f.date(r.created_at) },
  { key: "expires_at", header: "Expires", render: (r) => f.date(r.expires_at) },
  { key: "status", header: "Status", render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
];

export default async function InvitationsPage({ searchParams }: { searchParams: Promise<{ role?: string; coachId?: string }> }) {
  const sp = await searchParams;
  const columns = columnsFor(await getFormatter());
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

  // Coaches without a login: an invite for the coach role links the coach row
  // to the new account when accepted (handle_new_user / inviteUser).
  const coaches = await listUnlinkedCoaches();
  const defaultRole = sp.role === "coach" ? "coach" : undefined;
  const defaultCoachId = defaultRole && coaches.some((c) => c.id === sp.coachId) ? sp.coachId : undefined;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Invitations"
        description="Invite parents and staff by email. They're auto-linked to their family or role on first sign-in."
      />
      <div className="mb-6">
        <InviteForm
          families={(families ?? []) as { id: string; name: string }[]}
          coaches={coaches}
          defaultRole={defaultRole}
          defaultCoachId={defaultCoachId}
        />
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
