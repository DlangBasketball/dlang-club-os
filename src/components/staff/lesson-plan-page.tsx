import { notFound } from "next/navigation";
import { CalendarClock, MapPin } from "lucide-react";
import { PageHeader, Card, CardBody } from "@/components/ui";
import { LessonPlanForm, LessonPlanReadOnly } from "@/components/staff/lesson-plan";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { getLessonPlan, getPlanTarget, lessonPlanAttachmentUrls } from "@/lib/staff/data";

/** Shared lesson-plan page for the coach app and admin (edit when allowed, else read-only). */
export async function LessonPlanPage({ kind, id, backHref }: { kind: string; id: string; backHref: string }) {
  if ((kind !== "session" && kind !== "event") || !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [{ t, f }, me] = await Promise.all([getI18n(), getSessionUser()]);
  if (!me?.orgId) notFound();
  const [target, plan] = await Promise.all([getPlanTarget(me.orgId, kind, id), getLessonPlan(me.orgId, kind, id)]);
  if (!target) notFound();
  const urls = await lessonPlanAttachmentUrls([plan?.attachmentPath]);
  const url = plan?.attachmentPath ? urls.get(plan.attachmentPath) ?? null : null;
  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader eyebrow={t("staff.lessonPlans.title")} title={target.title || t("staff.lessonPlans.title")} />
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-text-muted">
        <span className="flex items-center gap-1"><CalendarClock className="h-4 w-4" />{f.date(target.startsAt, { weekday: true })} · {f.time(target.startsAt)}{target.endsAt ? `–${f.time(target.endsAt)}` : ""}</span>
        {target.location && <span className="flex items-center gap-1"><MapPin className="h-4 w-4" />{target.location}</span>}
      </div>
      <Card>
        <CardBody className="py-5">
          {target.canEdit ? (
            <LessonPlanForm kind={kind} itemId={id} plan={plan} attachmentUrl={url} afterDeleteHref={backHref} />
          ) : plan ? (
            <div className="space-y-3">
              <p className="text-xs text-text-muted">{t("staff.lessonPlans.readOnly")}</p>
              <LessonPlanReadOnly plan={plan} attachmentUrl={url} />
            </div>
          ) : (
            <p className="text-sm text-text-muted">{t("staff.lessonPlans.none")}</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
