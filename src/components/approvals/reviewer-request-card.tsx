import Link from "next/link";
import { Badge, Card, CardBody } from "@/components/ui";
import { ClubRequestDecision } from "@/components/approvals/request-decision";
import { RequestThread } from "@/components/approvals/request-thread";
import { ProposedProfile } from "@/components/approvals/proposed-profile";
import { requestChild, requestSubject, type ClubRequest } from "@/lib/approvals/types";
import type { Translator } from "@/lib/i18n/translator";
import type { Formatter } from "@/lib/format";

const STATUS_TONE = { pending: "info", info_requested: "warning", approved: "success", declined: "danger", withdrawn: "neutral" } as const;

/**
 * One club request in a reviewer queue. Admins see the family contact;
 * coaches get the minimal data the RPC returns (name, age, programme,
 * messages). Decisions only while the request is open.
 */
export function ReviewerRequestCard({ r, t, f, admin }: { r: ClubRequest; t: Translator; f: Formatter; admin: boolean }) {
  const open = r.status === "pending" || r.status === "info_requested";
  const child = requestChild(r);
  const full = r.program?.capacity != null && r.program.taken >= r.program.capacity;
  const price = r.program ? { amount: Number(r.program.price), currency: r.program.currency }
    : r.membership_type ? { amount: Number(r.membership_type.price), currency: r.membership_type.currency } : null;
  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {admin && r.athlete ? (
              <Link href={`/admin/athletes/${r.athlete.id}`} className="text-base font-semibold text-text hover:text-brand-primary">{child}</Link>
            ) : <span className="text-base font-semibold text-text">{child}</span>}
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-text-secondary">
              <Badge tone={STATUS_TONE[r.status]}>{t(`approvals.status.${r.status}`)}</Badge>
              {r.athlete?.age != null && <span>{t("approvals.reviewer.age", { age: r.athlete.age })}</span>}
              <span className="text-xs text-text-muted">{t("approvals.reviewer.submittedOn", { date: f.dateTime(r.created_at, "medium") })}</span>
            </div>
          </div>
          <div className="text-right text-sm">
            <div className="font-medium text-text">{requestSubject(r)}</div>
            <div className="text-xs text-text-muted">
              {t(r.subject_kind === "membership" ? "approvals.kind.membership" : "approvals.kind.program_registration")}
              {price && price.amount > 0 ? ` · ${f.money(price.amount, price.currency)}` : ""}
            </div>
            {r.program && (
              <div className={`text-xs ${full ? "text-warning" : "text-text-muted"}`}>
                {r.program.capacity != null
                  ? t("approvals.reviewer.capacity", { taken: r.program.taken, capacity: r.program.capacity })
                  : t("approvals.reviewer.noCapacity", { taken: r.program.taken })}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <section className="space-y-1 text-sm">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">{t("approvals.reviewer.family")}</h3>
            {r.family.name && <div className="text-text">{r.family.name}</div>}
            {r.requested_by.name && <div className="text-text-secondary">{t("approvals.reviewer.submittedBy", { name: r.requested_by.name })}</div>}
            {admin && (r.requested_by.email ?? r.family.email) && (
              <div><a className="text-brand-primary hover:underline" href={`mailto:${r.requested_by.email ?? r.family.email}`}>{r.requested_by.email ?? r.family.email}</a></div>
            )}
            {admin && r.family.phone && <div className="tnum text-text-secondary">{r.family.phone}</div>}
          </section>
          <section className="space-y-1 text-sm">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">{t("approvals.reviewer.reviewers")}</h3>
            <div className="text-text-secondary">{r.assigned_coaches.length ? r.assigned_coaches.join(", ") : t("approvals.reviewer.admins")}</div>
          </section>
        </div>

        <ProposedProfile profile={r.profile} t={t} f={f} />

        <RequestThread messages={r.messages} t={t} f={f} viewer="club" />

        {open ? (
          <div className="border-t border-border pt-3">
            {full && <p className="mb-2 text-xs text-warning">{t("approvals.reviewer.fullHint")}</p>}
            {r.status === "info_requested" && <p className="mb-2 text-xs text-text-muted">{t("approvals.reviewer.waitingForFamily")}</p>}
            <ClubRequestDecision requestId={r.id} childName={child} canRequestInfo={r.status === "pending"} />
          </div>
        ) : r.decided_at ? (
          <p className="border-t border-border pt-3 text-xs text-text-muted">{t("approvals.reviewer.decidedOn", { date: f.dateTime(r.decided_at, "medium") })}</p>
        ) : null}
      </CardBody>
    </Card>
  );
}
