import Link from "next/link";
import { CheckSquare } from "lucide-react";
import { Card, CardHeader, CardTitle, CardBody, ErrorState, SkeletonCard } from "@/components/ui";
import { getTodaysAttendance } from "@/lib/data/dashboard";
import { getI18n } from "@/lib/i18n/server";

export async function TodaysAttendance() {
  const { t, f } = await getI18n();
  const { data, error } = await getTodaysAttendance(f.timeZone);
  if (error) return <ErrorState title={t("dashboard.widgets.attendance.loadError")} message={error} />;
  const a = data!;
  const cells = [
    { key: "total", label: t("dashboard.widgets.attendance.sessions"), value: a.total, tone: "text-ink" },
    { key: "submitted", label: t("dashboard.widgets.attendance.submitted"), value: a.submitted, tone: "text-success" },
    { key: "open", label: t("dashboard.widgets.attendance.pending"), value: a.open, tone: "text-warning" },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("dashboard.widgets.attendance.title")}</CardTitle>
        <Link href="/admin/attendance" className="text-xs text-maroon hover:underline">{t("dashboard.widgets.attendance.open")}</Link>
      </CardHeader>
      <CardBody>
        {a.total === 0 ? (
          <p className="flex items-center gap-2 py-2 text-sm text-ink-3">
            <CheckSquare className="h-4 w-4" /> {t("dashboard.widgets.attendance.none")}
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {cells.map((c) => (
              <div key={c.key} className="rounded-md bg-surface-elevated px-3 py-4 text-center">
                <div className={`tnum text-2xl font-semibold ${c.tone}`}>{f.number(c.value)}</div>
                <div className="mt-1 text-xs text-ink-3">{c.label}</div>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

export { SkeletonCard as TodaysAttendanceSkeleton };
