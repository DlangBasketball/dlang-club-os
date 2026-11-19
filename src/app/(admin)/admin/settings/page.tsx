import { ErrorState } from "@/components/ui";
import { getClubSettings } from "@/lib/data/settings";
import { ClubProfileForm } from "@/components/admin/settings-forms";

export default async function ClubProfilePage() {
  const s = await getClubSettings();
  if (!s) return <ErrorState title="Unavailable" message="Could not load settings." />;
  return <ClubProfileForm s={s} />;
}
