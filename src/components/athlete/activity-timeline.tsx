import { ClipboardList, CheckSquare, FileCheck } from "lucide-react";
import { Card, CardHeader, CardTitle, CardBody, EmptyState } from "@/components/ui";
import { timeAgo } from "@/lib/utils";
import { getFormatter } from "@/lib/i18n/server";
import type { TimelineEvent } from "@/lib/data/athletes";

const ICON = {
  registration: ClipboardList,
  attendance: CheckSquare,
  consent: FileCheck,
} as const;

const DOT = {
  maroon: "bg-maroon",
  success: "bg-success",
  warning: "bg-warning",
  neutral: "bg-ink-4",
} as const;

export async function ActivityTimeline({ events }: { events: TimelineEvent[] }) {
  const f = await getFormatter();
  return (
    <Card>
      <CardHeader><CardTitle>Activity timeline</CardTitle></CardHeader>
      <CardBody>
        {events.length === 0 ? (
          <EmptyState icon={<ClipboardList className="h-5 w-5" />} title="No activity yet" description="Registrations, attendance and consents will appear here." />
        ) : (
          <ol className="relative space-y-5 pl-6">
            <span className="absolute left-[7px] top-1 bottom-1 w-px bg-line" aria-hidden />
            {events.map((e) => {
              const Icon = ICON[e.kind];
              return (
                <li key={e.id} className="relative">
                  <span className={`absolute -left-[22px] top-1 h-3.5 w-3.5 rounded-full ring-4 ring-bg ${DOT[e.tone]}`} />
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 text-sm text-ink">
                        <Icon className="h-3.5 w-3.5 text-ink-3" />
                        {e.label}
                      </div>
                      {e.sublabel && <div className="mt-0.5 text-xs text-ink-3 capitalize">{e.sublabel}</div>}
                    </div>
                    <time className="shrink-0 text-xs text-ink-4" title={f.date(e.at)}>{timeAgo(e.at)}</time>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardBody>
    </Card>
  );
}
