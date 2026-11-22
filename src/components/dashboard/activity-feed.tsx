import { Bell } from "lucide-react";
import { Card, CardHeader, CardTitle, CardBody, Badge, EmptyState, ErrorState, SkeletonCard } from "@/components/ui";
import { getActivityFeed, type ActivityItem } from "@/lib/data/dashboard";
import { getI18n } from "@/lib/i18n/server";

const TONE: Record<string, "maroon" | "success" | "warning" | "neutral"> = {
  registration: "maroon",
  payment: "success",
  practice: "neutral",
  training: "neutral",
  system: "warning",
};

export async function ActivityFeed() {
  const { t, f } = await getI18n();
  const { data, error } = await getActivityFeed(8);
  if (error) return <ErrorState title={t("dashboard.widgets.activity.loadError")} message={error} />;
  const items = data!;
  return (
    <Card>
      <CardHeader><CardTitle>{t("dashboard.widgets.activity.title")}</CardTitle></CardHeader>
      <CardBody className="p-2">
        {items.length === 0 ? (
          <div className="p-3"><EmptyState icon={<Bell className="h-5 w-5" />} title={t("dashboard.widgets.activity.emptyTitle")} description={t("dashboard.widgets.activity.emptyBody")} /></div>
        ) : (
          <ul className="space-y-1">
            {items.map((item: ActivityItem) => (
              <li key={item.id} className="flex items-start gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-surface-elevated/60">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-maroon" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink">{item.title}</p>
                  {item.body && <p className="truncate text-xs text-ink-3">{item.body}</p>}
                  <p className="mt-0.5 text-xs text-ink-4">{f.relative(item.createdAt)}</p>
                </div>
                <Badge tone={TONE[item.type] ?? "neutral"}>{t.dynamic(`notifications.types.${item.type}`, undefined, item.type)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

export { SkeletonCard as ActivityFeedSkeleton };
