"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X, UserPlus, Mail } from "lucide-react";
import { Card, CardHeader, CardTitle, CardBody, Button, Badge } from "@/components/ui";
import { assignRole, removeRole } from "@/lib/actions/staff";
import type { StaffMember, PendingInvite } from "@/lib/data/staff";

const ROLES = ["admin", "finance", "coach"];
const ROLE_TONE: Record<string, "maroon" | "warning" | "neutral"> = { admin: "maroon", finance: "warning", coach: "neutral" };

export function StaffTable({ staff, invites, selfId }: { staff: StaffMember[]; invites: PendingInvite[]; selfId: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  async function add(pid: string, role: string) { if (!role) return; setBusy(pid); await assignRole(pid, role); setBusy(null); router.refresh(); }
  async function rm(pid: string, role: string) { setBusy(pid + role); await removeRole(pid, role); setBusy(null); router.refresh(); }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><div className="flex items-center justify-between"><CardTitle>Staff users</CardTitle><Link href="/admin/invitations"><Button size="sm" variant="secondary"><UserPlus className="h-4 w-4" /> Invite staff</Button></Link></div></CardHeader>
        <CardBody className="p-0">
          <ul>
            {staff.map((m) => (
              <li key={m.profileId} className="flex items-center justify-between gap-3 border-b border-line-soft px-5 py-3 last:border-0">
                <div className="min-w-0"><div className="truncate text-sm text-ink">{m.name}{m.profileId === selfId && <span className="ml-2 text-xs text-ink-4">(you)</span>}</div><div className="truncate text-xs text-ink-3">{m.email}</div></div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  {m.roles.map((r) => (
                    <span key={r} className="inline-flex items-center gap-1">
                      <Badge tone={ROLE_TONE[r] ?? "neutral"}>{r}</Badge>
                      {!(m.profileId === selfId && r === "admin") && <button onClick={() => rm(m.profileId, r)} disabled={busy !== null} aria-label={`Remove ${r}`} className="text-ink-4 hover:text-danger"><X className="h-3 w-3" /></button>}
                    </span>
                  ))}
                  <select onChange={(e) => { add(m.profileId, e.target.value); e.target.value = ""; }} disabled={busy !== null} className="ml-1 rounded border border-line bg-surface-input px-2 py-1 text-xs text-ink-3" defaultValue="">
                    <option value="">+ role</option>
                    {ROLES.filter((r) => !m.roles.includes(r)).map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      {invites.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Mail className="h-4 w-4" /> Pending staff invitations</CardTitle></CardHeader>
          <CardBody className="p-0"><ul>{invites.map((i) => (
            <li key={i.id} className="flex items-center justify-between border-b border-line-soft px-5 py-3 last:border-0"><span className="text-sm text-ink">{i.email}</span><div className="flex items-center gap-2"><Badge tone="neutral">{i.role}</Badge><Badge tone="warning">{i.status}</Badge></div></li>
          ))}</ul></CardBody>
        </Card>
      )}
    </div>
  );
}

const CAPS: { area: string; admin: string; finance: string; coach: string; parent: string }[] = [
  { area: "Club settings", admin: "✓", finance: "—", coach: "—", parent: "—" },
  { area: "Invoices & payments", admin: "✓", finance: "✓", coach: "—", parent: "view own" },
  { area: "Families & athletes", admin: "✓", finance: "view", coach: "assigned", parent: "own" },
  { area: "Attendance", admin: "✓", finance: "—", coach: "own sessions", parent: "view own" },
  { area: "Bookings", admin: "✓", finance: "view", coach: "own", parent: "own" },
  { area: "Documents & consents", admin: "✓", finance: "view", coach: "assigned", parent: "own" },
  { area: "Notifications & broadcasts", admin: "✓", finance: "✓", coach: "—", parent: "receive" },
];
export function RolesMatrix() {
  return (
    <Card>
      <CardHeader><CardTitle>Roles & permissions</CardTitle></CardHeader>
      <CardBody className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3"><th className="px-5 py-2">Area</th><th className="px-3 py-2">Admin</th><th className="px-3 py-2">Finance</th><th className="px-3 py-2">Coach</th><th className="px-3 py-2">Parent</th></tr></thead>
          <tbody>{CAPS.map((c) => (
            <tr key={c.area} className="border-b border-line-soft last:border-0"><td className="px-5 py-2 text-ink">{c.area}</td><td className="px-3 py-2 text-ink-2">{c.admin}</td><td className="px-3 py-2 text-ink-2">{c.finance}</td><td className="px-3 py-2 text-ink-2">{c.coach}</td><td className="px-3 py-2 text-ink-2">{c.parent}</td></tr>
          ))}</tbody>
        </table>
      </CardBody>
    </Card>
  );
}
