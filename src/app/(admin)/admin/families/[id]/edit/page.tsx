import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Pencil, Plus } from "lucide-react";
import { PageHeader, ErrorState, Card, CardHeader, CardTitle, CardBody, Badge, Button, statusTone } from "@/components/ui";
import { FamilyForm } from "@/components/family/family-form";
import { GuardianManager } from "@/components/family/guardian-manager";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { getFamily } from "@/lib/data/families";
import { deleteFamily } from "@/lib/actions/family";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";

export default async function EditFamilyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ data, error }, user, { t, f }] = await Promise.all([getFamily(id), getSessionUser(), getI18n()]);
  if (error) return <ErrorState title={t("common.error")} message={error} />;
  if (!data) notFound();
  const isAdmin = !!user?.roles.includes("admin");

  return (
    <div className="animate-fade-up space-y-8">
      <div>
        <Link href={`/admin/families/${id}`} className="mb-3 inline-flex items-center gap-1 text-sm text-ink-3 hover:text-ink">
          <ChevronLeft className="h-4 w-4" /> {t("common.back")}
        </Link>
        <PageHeader
          title={t("editPeople.editTitle", { name: data.name })}
          actions={isAdmin ? (
            <ConfirmDeleteButton
              action={deleteFamily.bind(null, id)}
              label={t("editPeople.family.deleteFamily")}
              confirmText={t("editPeople.family.confirmDelete", { name: data.name })}
            />
          ) : undefined}
        />
      </div>

      <FamilyForm
        familyId={id}
        initial={{ name: data.name, address: data.address, phone: data.phone, contactName: data.contactName, contactEmail: data.contactEmail }}
      />

      {isAdmin && <GuardianManager familyId={id} guardians={data.guardians} />}

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>{t("editPeople.family.children")}</CardTitle>
          {isAdmin && (
            <Link href={`/admin/athletes/new?family=${id}`}>
              <Button size="sm" variant="secondary" type="button"><Plus className="h-4 w-4" /> {t("editPeople.family.addChild")}</Button>
            </Link>
          )}
        </CardHeader>
        <CardBody className="p-0">
          {data.athletes.length === 0 ? (
            <p className="p-5 text-sm text-ink-3">{t("editPeople.family.noChildren")}</p>
          ) : (
            <ul>
              {data.athletes.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 border-b border-line-soft px-5 py-3 last:border-0">
                  <div className="min-w-0">
                    <Link href={`/admin/athletes/${a.id}`} className="text-sm font-medium text-ink hover:text-maroon">{a.firstName} {a.lastName}</Link>
                    <div className="text-xs text-ink-3">{f.date(a.dob)}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={statusTone(a.status)}>{t.dynamic(`editPeople.athleteStatus.${a.status}`, undefined, a.status)}</Badge>
                    {isAdmin && (
                      <Link href={`/admin/athletes/${a.id}/edit`} aria-label={t("editPeople.editAria", { name: `${a.firstName} ${a.lastName}` })}>
                        <Button size="sm" variant="ghost" type="button"><Pencil className="h-4 w-4" /> {t("editPeople.edit")}</Button>
                      </Link>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="border-t border-line-soft px-5 py-3 text-xs text-ink-3">{t("editPeople.family.moveHint")}</p>
        </CardBody>
      </Card>
    </div>
  );
}
