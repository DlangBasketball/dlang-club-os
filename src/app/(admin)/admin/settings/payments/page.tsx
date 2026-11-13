import { CheckCircle2, AlertTriangle, ExternalLink } from "lucide-react";
import { Card, CardHeader, CardTitle, CardBody, Badge, ErrorState, Button, Input, Label } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { getOrgPaymentProfile, methodsForInvoice } from "@/lib/payments/settings";
import { METHOD_INFO, supportedMethodsForCountry, defaultEnabledMethods } from "@/lib/payments/methods";
import { defaultTaxProfile } from "@/lib/payments/tax";
import { PaymentMethods } from "@/components/invoice/payment-methods";
import { savePaymentSettingsForm } from "@/lib/actions/payments";

const REGION_LABEL = { CH: "Switzerland / Liechtenstein", EU: "EU / EEA (SEPA)", US: "United States", INTL: "International" } as const;

export default async function PaymentSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ connect?: string; saved?: string; error?: string }>;
}) {
  const me = await getSessionUser();
  if (!me?.orgId || !me.roles.includes("admin")) return <ErrorState title="Not permitted" message="Only club admins can manage payments." />;
  const sp = await searchParams;
  const profile = await getOrgPaymentProfile(me.orgId);
  const s = profile.settings;
  const enabled = new Set(s.enabled_methods?.length ? s.enabled_methods : defaultEnabledMethods(profile.country));
  const live = methodsForInvoice(profile, profile.currency);
  const taxDefault = defaultTaxProfile(profile.country);
  const stripe = s.stripe;
  const selectable = supportedMethodsForCountry(profile.country).filter((m) => m !== "apple_pay" && m !== "google_pay");

  return (
    <div className="space-y-6">
      {sp.saved === "1" && <p className="flex items-center gap-2 text-sm text-success"><CheckCircle2 className="h-4 w-4" /> Payment settings saved.</p>}
      {sp.error && <p className="flex items-center gap-2 text-sm text-danger"><AlertTriangle className="h-4 w-4" /> {sp.error}</p>}

      <Card>
        <CardHeader><CardTitle>Online payments (Stripe)</CardTitle></CardHeader>
        <CardBody className="space-y-3 text-sm text-ink-2">
          <p>
            Member payments go straight to your club&apos;s own Stripe account in <span className="text-ink">{profile.currency}</span>.
            Region: <span className="text-ink">{REGION_LABEL[profile.region]}</span>.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {stripe?.account_id ? (
              <>
                <Badge tone={stripe.charges_enabled ? "success" : "warning"}>{stripe.charges_enabled ? "Accepting payments" : "Onboarding incomplete"}</Badge>
                <Badge tone={stripe.payouts_enabled ? "success" : "neutral"}>{stripe.payouts_enabled ? "Payouts on" : "Payouts pending"}</Badge>
                <span className="tnum text-xs text-ink-3">{stripe.account_id}</span>
              </>
            ) : (
              <Badge tone="neutral">Not connected</Badge>
            )}
          </div>
          {sp.connect === "error" && <p className="text-danger">Stripe onboarding could not start. Check the Stripe keys and try again.</p>}
          {sp.connect === "pending" && <p className="text-ink-3">Stripe still needs some details before you can accept payments.</p>}
          <a href="/api/stripe/connect/onboard" className="inline-flex items-center gap-1.5 text-maroon hover:underline">
            <ExternalLink className="h-4 w-4" /> {stripe?.account_id ? "Continue / update Stripe onboarding" : "Connect Stripe account"}
          </a>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>What payers see today</CardTitle></CardHeader>
        <CardBody><PaymentMethods methods={live} /></CardBody>
      </Card>

      <form action={savePaymentSettingsForm}>
        <Card>
          <CardHeader><CardTitle>Payment methods &amp; tax</CardTitle></CardHeader>
          <CardBody className="space-y-5 text-sm">
            <fieldset className="space-y-2">
              <legend className="mb-1 text-xs uppercase tracking-wide text-ink-3">Accepted methods</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {selectable.map((m) => (
                  <label key={m} className="flex items-center gap-2 text-ink-2">
                    <input type="checkbox" name="enabled_methods" value={m} defaultChecked={enabled.has(m)} />
                    {METHOD_INFO[m].label}
                    {METHOD_INFO[m].currencies && <span className="text-xs text-ink-3">({METHOD_INFO[m].currencies!.join("/")})</span>}
                  </label>
                ))}
              </div>
              <p className="text-xs text-ink-3">Apple Pay and Google Pay are offered automatically with card.</p>
            </fieldset>

            <fieldset className="grid gap-2 sm:grid-cols-3">
              {profile.region === "EU" && (
                <>
                  <label className="flex items-center gap-2 text-ink-2"><input type="checkbox" name="sepa_enabled" defaultChecked={Boolean(s.sepa_enabled)} /> SEPA Direct Debit via Stripe</label>
                  <label className="flex items-center gap-2 text-ink-2"><input type="checkbox" name="epc_qr_enabled" defaultChecked={Boolean(s.epc_qr_enabled)} /> Show EPC transfer QR</label>
                </>
              )}
              {profile.region === "US" && (
                <label className="flex items-center gap-2 text-ink-2"><input type="checkbox" name="us_ach_enabled" defaultChecked={Boolean(s.us_ach_enabled)} /> ACH bank debit via Stripe</label>
              )}
            </fieldset>

            {profile.region !== "CH" && (
              <div className="max-w-xs space-y-1">
                <Label htmlFor="bic">BIC (optional)</Label>
                <Input id="bic" name="bic" defaultValue={s.bic ?? ""} placeholder="e.g. COBADEFFXXX" />
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-4">
              <div className="space-y-1">
                <Label htmlFor="tax_label">Tax label</Label>
                <Input id="tax_label" name="tax_label" defaultValue={s.tax?.label ?? taxDefault.label} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="tax_rate">Rate %</Label>
                <Input id="tax_rate" name="tax_rate" type="number" step="0.001" min="0" max="100" defaultValue={s.tax?.rate ?? 0} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="tax_registration">Tax / VAT number</Label>
                <Input id="tax_registration" name="tax_registration" defaultValue={s.tax?.registration_number ?? ""} />
              </div>
              <label className="flex items-end gap-2 pb-2 text-ink-2">
                <input type="checkbox" name="tax_inclusive" defaultChecked={s.tax?.inclusive ?? taxDefault.inclusiveByDefault} /> Prices include tax
              </label>
            </div>
            <p className="text-xs text-ink-3">
              Standard rate here is {taxDefault.standardRate}% ({taxDefault.label}), but many club membership and coaching fees are tax-exempt.
              Leave 0% unless your tax adviser confirms otherwise.
            </p>
            <Button type="submit">Save payment settings</Button>
          </CardBody>
        </Card>
      </form>
    </div>
  );
}
