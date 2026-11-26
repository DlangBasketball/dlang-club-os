import Link from "next/link";
import {
  Users, UserCircle, CalendarRange, FileText, BellRing, CheckSquare, Dumbbell, Download,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui";
import { getTranslations } from "@/lib/i18n/server";
import { getTenant } from "@/lib/tenant/server";
import { labelsFor } from "@/lib/sportsops/labels";

export async function QuickActions() {
  const [t, tenant] = await Promise.all([getTranslations(), getTenant()]);
  const labels = labelsFor(tenant.terminology);
  const actions: { key: string; label: string; href: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { key: "family", label: t("dashboard.widgets.quick.addFamily"), href: "/admin/families/new", icon: Users },
    { key: "athlete", label: t("dashboard.widgets.quick.addAthlete", { label: labels.athlete }), href: "/admin/athletes/new", icon: UserCircle },
    { key: "program", label: t("dashboard.widgets.quick.createProgram"), href: "/admin/programs/new", icon: CalendarRange },
    { key: "invoice", label: t("dashboard.widgets.quick.createInvoice"), href: "/admin/invoices/new", icon: FileText },
    { key: "overdue", label: t("dashboard.widgets.quick.sendReminder"), href: "/admin/invoices?status=overdue", icon: BellRing },
    { key: "attendance", label: t("dashboard.widgets.quick.openAttendance"), href: "/admin/attendance", icon: CheckSquare },
    { key: "training", label: t("dashboard.widgets.quick.trainingService"), href: "/admin/bookings", icon: Dumbbell },
    { key: "export", label: t("dashboard.widgets.quick.exportData"), href: "/admin/export?type=invoices", icon: Download },
  ];
  return (
    <Card>
      <CardHeader><CardTitle>{t("dashboard.widgets.quick.title")}</CardTitle></CardHeader>
      <CardBody className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {actions.map(({ key, label, href, icon: Icon }) => (
          <Link
            key={key}
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
