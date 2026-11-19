import { redirect } from "next/navigation";
import { PageHeader, Card, CardBody } from "@/components/ui";
import { CoachForm } from "@/components/coaches/coach-form";
import { getI18n } from "@/lib/i18n/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { listServiceOptions } from "@/lib/data/coaches";

export default async function NewCoachPage() {
  const [{ t }, user] = await Promise.all([getI18n(), getSessionUser()]);
  if (!user?.roles.includes("admin")) redirect("/admin/coaches");
  const services = await listServiceOptions();
  return (
    <div className="animate-fade-up max-w-2xl">
      <PageHeader title={t("coaches.new")} description={t("coaches.newDescription")} />
      <Card><CardBody>
        <CoachForm services={services} />
      </CardBody></Card>
    </div>
  );
}
