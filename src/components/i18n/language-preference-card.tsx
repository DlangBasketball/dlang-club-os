import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { getTranslations } from "@/lib/i18n/server";
import { LanguageSwitcher } from "./language-switcher";

/**
 * Account page card: the user's own language. Stored on the profile
 * (profiles.locale + locale_set_at), so the app, emails, notifications and
 * PDFs sent to this person use it.
 */
export async function LanguagePreferenceCard() {
  const t = await getTranslations();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("languageSettings.profile.title")}</CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="text-sm text-ink-3">{t("languageSettings.profile.description")}</p>
        <LanguageSwitcher showSingle />
      </CardBody>
    </Card>
  );
}
