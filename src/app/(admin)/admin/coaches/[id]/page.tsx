import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Mail } from "lucide-react";
import { PageHeader, Card, CardHeader, CardTitle, CardBody, Badge, ErrorState, Avatar, Button } from "@/components/ui";
import { PersonPhotoManager } from "@/components/people/person-photo-manager";
import { CoachForm } from "@/components/coaches/coach-form";
import { CoachStatusActions } from "@/components/coaches/coach-status-actions";
import { getI18n } from "@/lib/i18n/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { getCoach, listServiceOptions } from "@/lib/data/coaches";
import { USAGE_KINDS, canHardDelete, coachIdSchema } from "@/lib/coaches/validation";

export default async function CoachDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!coachIdSchema.safeParse(id).success) notFound();
  const [{ t }, user, res, services] = await Promise.all([getI18n(), getSessionUser(), getCoach(id), listServiceOptions()]);
  if (res.error !== null) return <ErrorState title={t("common.error")} message={res.error} />;
  const c = res.data;
  if (!c) notFound();
  const isAdmin = !!user?.roles.includes("admin");
  const usage = USAGE_KINDS.filter((k) => c.usage[k] > 0);

  return (
    <div className="animate-fade-up max-w-3xl space-y-5">
      <PageHeader
        eyebrow={<Link href="/admin/coaches" className="inline-flex items-center gap-1 hover:text-ink"><ArrowLeft className="h-3 w-3" /> {t("coaches.back")}</Link>}
        title={
          <span className="flex items-center gap-3">
            <Avatar name={c.name} src={c.photoUrl} size="lg" />
            <span>{c.name}</span>
          </span>
        }
        description={c.title ?? undefined}
        actions={<Badge tone={c.isActive ? "success" : "neutral"}>{c.isActive ? t("coaches.status.active") : t("coaches.status.inactive")}</Badge>}
      />

      {isAdmin && (
        <Card>
          <CardHeader><CardTitle>{t("coaches.detail.photo")}</CardTitle></CardHeader>
          <CardBody>
            <PersonPhotoManager subject="coach" id={c.id} name={c.name} photoUrl={c.photoUrl} />
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>{t("coaches.detail.profile")}</CardTitle></CardHeader>
        <CardBody>
          {isAdmin ? (
            <CoachForm
              coachId={c.id}
              services={services}
              initial={{ displayName: c.name, roleTitle: c.title ?? "", bio: c.bio ?? "", isActive: c.isActive, serves: c.serves }}
            />
          ) : (
            <div className="space-y-2 text-sm text-ink-2">
              {c.bio ? <p className="whitespace-pre-wrap">{c.bio}</p> : <p className="text-ink-3">—</p>}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("coaches.detail.teams")}</CardTitle></CardHeader>
        <CardBody>
          {c.teams.length ? (
            <ul className="flex flex-wrap gap-2">
              {c.teams.map((tm) => (
                <li key={tm.id}>
                  <Link href={`/admin/teams/${tm.id}`}>
                    <Badge tone={tm.isActive ? "maroon" : "neutral"}>
                      {tm.name} · {t.dynamic(`coaches.roles.${tm.role}`, undefined, tm.role)}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-ink-3">{t("coaches.detail.noTeams")}</p>}
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("coaches.detail.login")}</CardTitle></CardHeader>
        <CardBody className="space-y-3 text-sm">
          {c.linked ? (
            <p className="text-ink-2">{c.loginEmail ? t("coaches.detail.linkedAs", { email: c.loginEmail }) : t("coaches.detail.linked")}</p>
          ) : c.invitePending ? (
            <p className="text-ink-2">{t("coaches.detail.pending")}</p>
          ) : (
            <p className="text-ink-2">{t("coaches.detail.none")}</p>
          )}
          {isAdmin && !c.linked && (
            <div className="flex flex-wrap gap-2">
              {!c.invitePending && c.isActive && (
                <Link href={`/admin/invitations?role=coach&coachId=${c.id}`}>
                  <Button size="sm" variant="secondary"><Mail className="h-4 w-4" /> {t("coaches.detail.invite")}</Button>
                </Link>
              )}
              {c.invitePending && (
                <Link href="/admin/invitations"><Button size="sm" variant="ghost">{t("coaches.detail.invitations")}</Button></Link>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      {isAdmin && (
        <Card>
          <CardHeader><CardTitle>{t("coaches.detail.status")}</CardTitle></CardHeader>
          <CardBody className="space-y-3">
            {usage.length > 0 && (
              <div className="text-sm">
                <p className="mb-1 text-ink-3">{t("coaches.usage.title")}</p>
                <ul className="list-inside list-disc text-ink-2">
                  {usage.map((k) => <li key={k}>{t(`coaches.usage.${k}`, { count: c.usage[k] })}</li>)}
                </ul>
              </div>
            )}
            {!c.isActive && <p className="text-xs text-ink-3">{t("coaches.detail.inactiveNote")}</p>}
            <CoachStatusActions coachId={c.id} name={c.name} isActive={c.isActive} canDelete={canHardDelete(c.usage)} />
          </CardBody>
        </Card>
      )}
    </div>
  );
}
