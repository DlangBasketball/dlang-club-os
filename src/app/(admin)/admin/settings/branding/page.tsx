import { ErrorState } from "@/components/ui";
import { getClubSettings } from "@/lib/data/settings";
import { BrandingForm, VenuesEditor, LocalizationForm } from "@/components/admin/settings-forms";

export default async function BrandingPage() {
  const s = await getClubSettings();
  if (!s) return <ErrorState title="Unavailable" message="Could not load settings." />;
  return <div className="space-y-6"><BrandingForm s={s} /><VenuesEditor s={s} /><LocalizationForm s={s} /></div>;
}
