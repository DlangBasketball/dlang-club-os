import { getTenant } from "@/lib/tenant/server";
import { getTranslations } from "@/lib/i18n/server";
import { getWebsiteSettings } from "@/lib/website/server";
import { ReturnToWebsite } from "@/components/website/return-to-website";

/**
 * Login opened from a club website embed (?return_to=…, validated against
 * the club's allowed website origins on the client) gets a way back to the
 * website. Nothing changes for every other visitor.
 */
export default async function LoginLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getTenant();
  const website = tenant.id ? await getWebsiteSettings(tenant.id) : null;
  const back = Boolean(website?.enabled && website.allowedOrigins.length > 0);
  const t = back ? await getTranslations(tenant.id) : null;
  return (
    <>
      {back && website && t && (
        <div className="fixed left-4 top-4 z-10">
          <ReturnToWebsite allowedOrigins={website.allowedOrigins} label={t("website.public.backToWebsite")} />
        </div>
      )}
      {children}
    </>
  );
}
