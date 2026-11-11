import { listStaff, listPendingStaffInvites } from "@/lib/data/staff";
import { getSessionUser } from "@/lib/auth/get-user";
import { StaffTable, RolesMatrix } from "@/components/admin/settings-staff";

export default async function StaffPage() {
  const [staff, invites, me] = await Promise.all([listStaff(), listPendingStaffInvites(), getSessionUser()]);
  return <div className="space-y-6"><StaffTable staff={staff} invites={invites} selfId={me?.id ?? ""} /><RolesMatrix /></div>;
}
