import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Plus, UserCircle, FileText, FolderOpen, ClipboardList } from "lucide-react";
import {
  PageHeader, Button, Card, CardHeader, CardTitle, CardBody, Badge, statusTone,
  StatCard, EmptyState, ErrorState,
} from "@/components/ui";
import { ParentContactSection } from "@/components/athlete/parent-contact-section";
import { getFamily } from "@/lib/data/families";
import { formatPostalAddress } from "@/lib/people/licence";
import { getI18n } from "@/lib/i18n/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { FamilySponsorshipButton } from "@/components/athlete/sponsorship-card";
import { SponsorshipBadge } from "@/components/athlete/sponsorship-badge";
import { DeletePersonButton, RemoveGuardianButton } from "@/components/people/delete-person";

export default async function FamilyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ t, f }, me] = await Promise.all([getI18n(), getSessionUser()]);
  const { id } = await params;
  const [{ data, error }, user] = await Promise.all([getFamily(id), getSessionUser()]);
  const canSponsor = !!user && (user.roles.includes("admin") || user.roles.includes("finance"));
  if (error) return <ErrorState title="Couldn't load family" message={error} />;
  if (!data) notFound();
  const isAdmin = !!me?.roles.includes("admin");
  const active = data.status === "active";
  const canDelete = isAdmin && active;

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader
        title={data.name}
        description={formatPostalAddress(data) ?? undefined}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href={`/admin/athletes/new?family=${id}`}><Button variant="secondary"><Plus className="h-4 w-4" /> Add athlete</Button></Link>
            <Link href={`/admin/families/${id}/edit`}><Button variant="secondary"><Pencil className="h-4 w-4" /> {t("editPeople.edit")}</Button></Link>
            {canSponsor && data.athletes.length > 0 && <FamilySponsorshipButton familyId={id} />}
            {canDelete && <DeletePersonButton kind="family" id={id} name={data.name} redirectTo="/admin/families" />}
          </div>
        }
      />
      {!active && isAdmin && (
        <p className="rounded-md border border-border bg-surface p-3 text-sm text-text-muted">
          <Link href="/admin/deleted" className="underline-offset-4 hover:underline">{t("personDelete.deleted.link")}</Link>
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Balance due" value={f.money(data.balance)} accent={data.balance > 0} />
        <StatCard label="Open invoices" value={String(data.invoices.filter((i) => ["pending", "draft", "overdue"].includes(i.status)).length)} />
        <StatCard label="Athletes" value={String(data.athletes.length)} />
        <StatCard label="Registrations" value={String(data.registrationCount)} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Athletes */}
          <Card>
            <CardHeader>
              <CardTitle>Athletes</CardTitle>
              <Link href={`/admin/athletes/new?family=${id}`} className="text-xs text-maroon hover:underline">Add</Link>
            </CardHeader>
            <CardBody className="p-0">
              {data.athletes.length === 0 ? (
                <div className="p-5"><EmptyState icon={<UserCircle className="h-5 w-5" />} title="No athletes yet" /></div>
              ) : (
                <ul>
                  {data.athletes.map((a) => (
                    <li key={a.id} className="flex items-center gap-1 border-b border-line-soft pe-3 last:border-0">
                      <Link href={`/admin/athletes/${a.id}`} className="flex flex-1 items-center justify-between px-5 py-3 hover:bg-surface-elevated/50">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-elevated text-maroon"><UserCircle className="h-5 w-5" /></div>
                          <div>
                            <div className="text-sm font-medium text-ink">{a.firstName} {a.lastName}</div>
                            <div className="text-xs text-ink-3">Born {f.date(a.dob)}</div>
                          </div>
                        </div>
                        <span className="flex items-center gap-2">
                          <SponsorshipBadge kind={a.sponsorshipKind} percent={a.sponsorshipPercent} />
                          <Badge tone={statusTone(a.status)}>{t.dynamic(`editPeople.athleteStatus.${a.status}`, undefined, a.status)}</Badge>
                        </span>
                      </Link>
                      {canDelete && <DeletePersonButton kind="athlete" id={a.id} name={`${a.firstName} ${a.lastName}`} variant="icon" />}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {/* Invoices */}
          <Card>
            <CardHeader>
              <CardTitle>Invoices</CardTitle>
              <Link href="/admin/invoices" className="text-xs text-maroon hover:underline">All invoices</Link>
            </CardHeader>
            <CardBody className="p-0">
              {data.invoices.length === 0 ? (
                <div className="p-5"><EmptyState icon={<FileText className="h-5 w-5" />} title="No invoices" /></div>
              ) : (
                <ul>
                  {data.invoices.map((i) => (
                    <li key={i.id} className="flex items-center justify-between border-b border-line-soft px-5 py-3 last:border-0">
                      <div>
                        <div className="tnum text-sm font-medium text-ink">{i.number}</div>
                        <div className="text-xs text-ink-3">Due {f.date(i.dueDate)}</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="tnum text-sm">{f.money(i.total)}</span>
                        <Badge tone={statusTone(i.status)}>{i.status}</Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <ParentContactSection guardians={data.guardians} familyPhone={data.phone} familyAddress={formatPostalAddress(data)} />
          {canDelete && data.guardians.length > 0 && (
            <Card>
              <CardHeader><CardTitle>{t("personDelete.guardian.confirm")}</CardTitle></CardHeader>
              <CardBody className="p-0">
                <ul>
                  {data.guardians.map((g) => (
                    <li key={g.id} className="flex items-center justify-between gap-2 border-b border-line-soft px-5 py-2 last:border-0">
                      <span className="text-sm text-ink">{g.name ?? g.email ?? "—"}</span>
                      <RemoveGuardianButton familyId={id} profileId={g.id} name={g.name ?? g.email ?? ""} />
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}

          {/* Documents */}
          <Card>
            <CardHeader><CardTitle>Documents</CardTitle></CardHeader>
            <CardBody className="p-0">
              {data.documents.length === 0 ? (
                <div className="p-5"><EmptyState icon={<FolderOpen className="h-5 w-5" />} title="No documents" /></div>
              ) : (
                <ul>
                  {data.documents.map((d) => (
                    <li key={d.id} className="flex items-center justify-between border-b border-line-soft px-5 py-3 last:border-0">
                      <div className="flex items-center gap-2">
                        <FolderOpen className="h-4 w-4 text-ink-3" />
                        <span className="text-sm text-ink">{d.fileName ?? d.kind}</span>
                      </div>
                      <Badge tone="neutral">{d.kind}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
