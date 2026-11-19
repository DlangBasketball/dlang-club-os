import Link from "next/link";
import { UserCircle, ChevronRight } from "lucide-react";
import { PageHeader, Card, CardBody, Badge, EmptyState, ErrorState, Avatar } from "@/components/ui";
import { listChildren } from "@/lib/data/parent";
import { photoUrlsForAthletes } from "@/lib/people/server";

export default async function ParentChildrenPage() {
  const { data, error } = await listChildren();
  if (error) return (<div className="animate-fade-up"><PageHeader title="My children" /><ErrorState title="Couldn't load" message={error} /></div>);
  const kids = data!;
  // The guardian's own children only (RLS); short-lived signed URLs, never public.
  const photos = await photoUrlsForAthletes(kids.map((k) => k.id));
  return (
    <div className="animate-fade-up">
      <PageHeader title="My children" description="Profiles, medical info and registrations." />
      {kids.length === 0 ? (
        <EmptyState icon={<UserCircle className="h-5 w-5" />} title="No children on your account" description="Register for a program to get started." />
      ) : (
        <div className="space-y-2">
          {kids.map((c) => (
            <Link key={c.id} href={`/parent/children/${c.id}`}>
              <Card className="transition active:scale-[0.99] hover:border-maroon/40">
                <CardBody className="flex items-center gap-3">
                  <Avatar name={c.name} src={photos[c.id] ?? null} size="lg" className="h-11 w-11" />
                  <div className="flex-1">
                    <div className="font-medium text-ink">{c.name}</div>
                    <div className="text-xs text-ink-3">{c.age !== null ? `Age ${c.age}` : "—"} · {c.activeRegistrations} active registration{c.activeRegistrations === 1 ? "" : "s"}</div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-ink-4" />
                </CardBody>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
