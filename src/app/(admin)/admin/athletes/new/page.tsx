import Link from "next/link";
import { PageHeader, Card, CardBody, EmptyState } from "@/components/ui";
import { AthleteForm } from "@/components/athlete/athlete-form";
import { listFamilies } from "@/lib/data/families";
import { Users } from "lucide-react";

export default async function NewAthletePage({
  searchParams,
}: {
  searchParams: Promise<{ family?: string }>;
}) {
  const { family } = await searchParams;

  if (!family) {
    const { data } = await listFamilies();
    return (
      <div className="animate-fade-up">
        <PageHeader title="Add athlete" description="Choose the family this athlete belongs to." />
        <Card>
          <CardBody className="p-0">
            {(data ?? []).length === 0 ? (
              <div className="p-5"><EmptyState icon={<Users className="h-5 w-5" />} title="No families yet" description="Create a family first." /></div>
            ) : (
              <ul>
                {(data ?? []).map((f) => (
                  <li key={f.id}>
                    <Link href={`/admin/athletes/new?family=${f.id}`} className="flex items-center justify-between border-b border-line-soft px-5 py-3 last:border-0 hover:bg-surface-elevated/50">
                      <span className="text-sm font-medium text-ink">{f.name}</span>
                      <span className="text-xs text-ink-3">{f.athleteCount} athlete{f.athleteCount === 1 ? "" : "s"}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="animate-fade-up">
      <PageHeader title="Add athlete" description="Medical info can be added after creating the profile." />
      <AthleteForm familyId={family} />
    </div>
  );
}
