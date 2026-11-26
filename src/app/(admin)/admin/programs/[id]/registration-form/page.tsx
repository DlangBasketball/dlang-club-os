import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { formsDb } from "@/lib/forms/db";
import { getRegistrationConfig } from "@/lib/registration-form/server";
import { isDefaultConfig } from "@/lib/registration-form/config";
import { RegistrationFormEditor } from "@/components/forms/registration-form-editor";

export const dynamic = "force-dynamic";

/** Registration form editor for one programme or camp (admins). */
export default async function RegistrationFormPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireRole(["admin"]);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await formsDb();
  const { data: program } = await db.from("programs").select("id,name").eq("id", id).eq("org_id", me.orgId!).maybeSingle();
  if (!program) notFound();
  const { t } = await getI18n();
  const config = await getRegistrationConfig(me.orgId!, id);
  return (
    <div className="animate-fade-up max-w-4xl space-y-5">
      <Link href={`/admin/programs/${id}`} className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink"><ChevronLeft className="h-3.5 w-3.5" /> {program.name}</Link>
      <PageHeader title={t("forms.regForm.title")} description={t("forms.regForm.description", { programme: program.name })} />
      <RegistrationFormEditor programId={id} initial={config} isDefault={isDefaultConfig(config)} />
    </div>
  );
}
