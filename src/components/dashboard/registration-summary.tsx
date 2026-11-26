import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { Card, CardHeader, CardTitle, CardBody, Badge, statusTone, EmptyState, ErrorState, SkeletonCard } from "@/components/ui";
import { getRecentRegistrations } from "@/lib/data/dashboard";
import { getI18n } from "@/lib/i18n/server";

export async function RegistrationSummary() {
  const { t, f } = await getI18n();
  const { data, error } = await getRecentRegistrations(6);
  if (error) return <ErrorState title={t("dashboard.widgets.registrations.loadError")} message={error} />;
  const regs = data!;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("dashboard.widgets.registrations.title")}</CardTitle>
        <Link href="/admin/registrations" className="text-xs text-maroon hover:underline">{t("dashboard.widgets.registrations.viewAll")}</Link>
      </CardHeader>
      <CardBody className="p-0">
        {regs.length === 0 ? (
          <div className="p-5"><EmptyState icon={<ClipboardList className="h-5 w-5" />} title={t("dashboard.widgets.registrations.empty")} /></div>
        ) : (
          <ul>
            {regs.map((r) => (
              <li key={r.id} className="border-b border-line-soft last:border-0">
                <Link href={`/admin/registrations/${r.id}`} className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-surface-elevated/60">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-ink">{r.athleteName ?? t("dashboard.widgets.registrations.unknownAthlete")}</div>
                    <div className="truncate text-xs text-ink-3">{r.programName ?? t("dashboard.widgets.registrations.unknownProgram")} · {f.relative(r.createdAt)}</div>
                  </div>
                  <Badge tone={statusTone(r.status)}>{t.dynamic(`status.${r.status}`, undefined, r.status)}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

export { SkeletonCard as RegistrationSummarySkeleton };
