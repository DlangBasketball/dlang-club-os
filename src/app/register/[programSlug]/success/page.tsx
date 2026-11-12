import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Card, CardBody, Button } from "@/components/ui";
import { getPublicProgram } from "@/lib/data/public-registration";
import { getTranslations } from "@/lib/i18n/server";

export default async function RegistrationSuccessPage({
  params, searchParams,
}: {
  params: Promise<{ programSlug: string }>;
  searchParams: Promise<{ ref?: string }>;
}) {
  const { programSlug } = await params;
  const { ref } = await searchParams;
  const data = await getPublicProgram(programSlug);
  const t = await getTranslations(data?.program.orgId);
  const programName = data?.program.name ?? t("registration.success.theProgram");

  return (
    <div className="animate-fade-up py-6">
      <Card className="mx-auto max-w-lg">
        <CardBody className="flex flex-col items-center gap-4 py-10 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-success-soft text-success">
            <CheckCircle2 className="h-7 w-7" />
          </span>
          <div>
            <h1 className="font-display text-2xl font-semibold">{t("registration.success.title")}</h1>
            <p className="mt-2 text-sm text-ink-2">
              {ref
                ? t("registration.success.thanksWithInvoice", { program: programName, invoice: ref })
                : t("registration.success.thanks", { program: programName })}
            </p>
          </div>
          <div className="w-full rounded-md border border-line bg-surface-elevated/50 p-4 text-left text-sm text-ink-2">
            <p className="font-medium text-ink">{t("registration.success.nextTitle")}</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>{t("registration.success.next1")}</li>
              <li>{t("registration.success.next2")}</li>
              <li>{t("registration.success.next3")}</li>
            </ol>
          </div>
          <Link href="/login"><Button>{t("registration.success.setupAccount")}</Button></Link>
        </CardBody>
      </Card>
    </div>
  );
}
