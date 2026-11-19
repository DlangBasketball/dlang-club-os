import { ErrorState } from "@/components/ui";
import { getClubSettings } from "@/lib/data/settings";
import { PaymentInstructionsForm, InvoiceSettingsForm, TaxForm } from "@/components/admin/settings-forms";

export default async function BillingPage() {
  const s = await getClubSettings();
  if (!s) return <ErrorState title="Unavailable" message="Could not load settings." />;
  return <div className="space-y-6"><PaymentInstructionsForm s={s} /><InvoiceSettingsForm s={s} /><TaxForm s={s} /></div>;
}
