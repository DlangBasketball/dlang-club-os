import Link from "next/link";
import { notFound } from "next/navigation";
import { Mail, Phone, UserCircle, FileText, ShieldCheck } from "lucide-react";
import { PageHeader, Card, CardHeader, CardTitle, CardBody, Badge, statusTone, EmptyState, ErrorState } from "@/components/ui";
import { getRegistrationDetail } from "@/lib/data/registrations";
import { RegistrationStatusControl } from "../registration-status-control";
import { RegistrationEditForm } from "../registration-edit-form";
import { timeAgo } from "@/lib/utils";
import { getI18n } from "@/lib/i18n/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { listProgramOptions } from "@/lib/data/people-edit";
import { CampRegistrationPanel } from "@/components/camps/camp-registration-panel";
import { RegistrationFormsPanels } from "@/components/forms/registration-panels";

export default async function RegistrationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { t, f } = await getI18n();
  const { id } = await params;
  const [{ data, error }, user] = await Promise.all([getRegistrationDetail(id), getSessionUser()]);
  const isAdmin = !!user?.roles.includes("admin");
  const programs = isAdmin ? await listProgramOptions() : [];
  if (error) return <ErrorState title="Couldn't load registration" message={error} />;
  if (!data) notFound();

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={`Registration · ${data.athlete.name}`} description={`Submitted ${timeAgo(data.createdAt)}`} />

      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
          <Badge tone={statusTone(data.status)}>{data.status}</Badge>
        </CardHeader>
        <CardBody className="space-y-3">
          <RegistrationStatusControl id={data.id} current={data.status} />
          {data.status === "cancelled" && (data.cancellationReason || data.cancelledAt) && (
            <div className="rounded bg-surface-elevated px-3 py-2 text-sm">
              {data.cancelledAt && <div className="text-xs text-ink-3">{t("editPeople.registrations.cancelledOn", { date: f.date(data.cancelledAt) })}</div>}
              {data.cancellationReason && <div className="text-ink">{t("editPeople.registrations.reasonLabel")}: {data.cancellationReason}</div>}
            </div>
          )}
        </CardBody>
      </Card>

      {user?.orgId && (
        <CampRegistrationPanel registrationId={data.id} orgId={user.orgId}
          canDiscount={!!(user.roles.includes("admin") || user.roles.includes("finance"))} />
      )}

      {isAdmin && (
        <Card id="edit" className="scroll-mt-6">
          <CardHeader><CardTitle>{t("editPeople.registrations.editTitle")}</CardTitle></CardHeader>
          <CardBody>
            <RegistrationEditForm
              id={data.id}
              programs={programs.some((p) => p.id === data.program.id) ? programs : [{ id: data.program.id, label: data.program.name }, ...programs]}
              initial={{ programId: data.program.id, status: data.status, notes: data.notes, cancellationReason: data.cancellationReason }}
            />
          </CardBody>
        </Card>
      )}

      {isAdmin && <RegistrationFormsPanels registrationId={data.id} />}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Participant</CardTitle></CardHeader>
          <CardBody className="space-y-2 text-sm">
            <Link href={`/admin/athletes/${data.athlete.id}`} className="flex items-center gap-2 font-medium text-ink hover:text-maroon">
              <UserCircle className="h-4 w-4" /> {data.athlete.name}
            </Link>
            <div className="text-ink-3">Born {f.date(data.athlete.dob)}</div>
            <div className="pt-2 text-ink-2">Program: <span className="text-ink">{data.program.name}</span></div>
            {data.notes && <div className="text-ink-3">Notes: {data.notes}</div>}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Family</CardTitle>
            <Link href={`/admin/families/${data.family.id}`} className="text-xs text-maroon hover:underline">Open</Link>
          </CardHeader>
          <CardBody className="space-y-2 text-sm">
            <div className="font-medium text-ink">{data.family.name}</div>
            {data.family.contactName && <div className="text-ink-2">{data.family.contactName}</div>}
            {data.family.contactEmail && <div className="flex items-center gap-2 text-ink-3"><Mail className="h-3.5 w-3.5" />{data.family.contactEmail}</div>}
            {data.family.phone && <div className="flex items-center gap-2 text-ink-3"><Phone className="h-3.5 w-3.5" />{data.family.phone}</div>}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Invoice</CardTitle><Link href="/admin/invoices" className="text-xs text-maroon hover:underline">All invoices</Link></CardHeader>
        <CardBody className="p-0">
          {data.invoices.length === 0 ? (
            <div className="p-5"><EmptyState icon={<FileText className="h-5 w-5" />} title="No invoice linked" /></div>
          ) : (
            <ul>
              {data.invoices.map((i) => (
                <li key={i.id} className="flex items-center justify-between border-b border-line-soft px-5 py-3 last:border-0">
                  <div><div className="tnum text-sm font-medium text-ink">{i.number}</div><div className="text-xs text-ink-3">Due {f.date(i.dueDate)}</div></div>
                  <div className="flex items-center gap-3"><span className="tnum text-sm">{f.money(i.total)}</span><Badge tone={statusTone(i.status)}>{i.status}</Badge></div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>Consents accepted</CardTitle></CardHeader>
        <CardBody className="p-0">
          {data.consents.length === 0 ? (
            <div className="p-5"><EmptyState icon={<ShieldCheck className="h-5 w-5" />} title="No consents recorded" /></div>
          ) : (
            <ul>
              {data.consents.map((c) => (
                <li key={c.id} className="flex items-center justify-between border-b border-line-soft px-5 py-3 last:border-0">
                  <div className="flex items-center gap-2 text-sm text-ink"><ShieldCheck className="h-4 w-4 text-success" />{c.title}</div>
                  <div className="text-right text-xs text-ink-3">
                    <div>{f.date(c.acceptedAt)}</div>
                    {c.ip && <div className="tnum">IP {c.ip}</div>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
