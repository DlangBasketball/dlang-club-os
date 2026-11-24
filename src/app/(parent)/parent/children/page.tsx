import Link from "next/link";
import { UserCircle, ChevronRight } from "lucide-react";
import { PageHeader, Card, CardBody, EmptyState, ErrorState, Avatar } from "@/components/ui";
import { listChildren } from "@/lib/data/parent";
import { photoUrlsForAthletes } from "@/lib/people/server";
import { getI18n } from "@/lib/i18n/server";
import { AddParticipantButton } from "@/components/participants/add-participant-dialog";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("participants.children.title") };
}

export default async function ParentChildrenPage() {
  const [{ t, f }, { data, error }] = await Promise.all([getI18n(), listChildren()]);
  const header = (
    <PageHeader title={t("participants.children.title")} description={t("participants.children.description")}
      actions={<AddParticipantButton variant="primary" />} />
  );
  if (error) return (<div className="animate-fade-up">{header}<ErrorState title={t("participants.children.loadError")} message={error} /></div>);
  const kids = data!;
  // The guardian's own children only (RLS); short-lived signed URLs, never public.
  const photos = await photoUrlsForAthletes(kids.map((k) => k.id));
  return (
    <div className="animate-fade-up">
      {header}
      {kids.length === 0 ? (
        <EmptyState icon={<UserCircle className="h-5 w-5" />} title={t("participants.children.emptyTitle")} description={t("participants.children.emptyHint")} />
      ) : (
        <div className="space-y-2">
          {kids.map((c) => (
            <Link key={c.id} href={`/parent/children/${c.id}`}>
              <Card className="transition active:scale-[0.99] hover:border-maroon/40">
                <CardBody className="flex items-center gap-3">
                  <Avatar name={c.name} src={photos[c.id] ?? null} size="lg" className="h-11 w-11" />
                  <div className="flex-1">
                    <div className="font-medium text-ink">{c.name}</div>
                    <div className="text-xs text-ink-3">
                      {c.age !== null ? t("participants.children.age", { age: f.number(c.age) }) : "—"}
                      {" · "}
                      {t("participants.children.activeRegistrations", { count: c.activeRegistrations })}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-ink-4" aria-hidden />
                </CardBody>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
