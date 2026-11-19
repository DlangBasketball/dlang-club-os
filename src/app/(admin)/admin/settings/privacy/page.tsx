import { ErrorState } from "@/components/ui";
import { getClubSettings } from "@/lib/data/settings";
import { PrivacyForm, RetentionForm } from "@/components/admin/settings-forms";
import { ExportTool } from "@/components/admin/settings-export";
import { DeletionRequests } from "@/components/admin/deletion-requests";
import { listDeletionRequests } from "@/lib/data/privacy";

export default async function PrivacyPage() {
  const [s, delReqs] = await Promise.all([getClubSettings(), listDeletionRequests()]);
  if (!s) return <ErrorState title="Unavailable" message="Could not load settings." />;
  return <div className="space-y-6"><PrivacyForm s={s} /><RetentionForm s={s} /><ExportTool /><DeletionRequests requests={delReqs} /></div>;
}
