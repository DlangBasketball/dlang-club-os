import Link from "next/link";
import {
  Users, UserCircle, CalendarRange, FileText, BellRing, CheckSquare, Dumbbell, Download,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui";

const ACTIONS: { label: string; href: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { label: "Add family", href: "/admin/families", icon: Users },
  { label: "Add athlete", href: "/admin/athletes", icon: UserCircle },
  { label: "Create program", href: "/admin/programs", icon: CalendarRange },
  { label: "Create invoice", href: "/admin/invoices", icon: FileText },
  { label: "Send reminder", href: "/admin/invoices?filter=overdue", icon: BellRing },
  { label: "Open attendance", href: "/admin/attendance", icon: CheckSquare },
  { label: "Training service", href: "/admin/bookings", icon: Dumbbell },
  { label: "Export data", href: "/admin/export?type=invoices", icon: Download },
];

export function QuickActions() {
  return (
    <Card>
      <CardHeader><CardTitle>Quick actions</CardTitle></CardHeader>
      <CardBody className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {ACTIONS.map(({ label, href, icon: Icon }) => (
          <Link
            key={label}
            href={href as never}
            prefetch={false}
            className="flex flex-col items-center gap-2 rounded-md border border-line bg-surface-elevated px-3 py-4 text-center text-xs text-ink-2 transition-all hover:border-maroon/50 hover:text-ink"
          >
            <span className="text-maroon"><Icon className="h-5 w-5" /></span>
            {label}
          </Link>
        ))}
      </CardBody>
    </Card>
  );
}
