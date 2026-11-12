import Link from "next/link";
import { UserCircle, Receipt, Bell, ChevronRight, CalendarClock, MapPin, FileText, ClipboardList } from "lucide-react";
import { PageHeader, Card, CardBody, Badge, EmptyState, ErrorState } from "@/components/ui";
import { getParentDashboard } from "@/lib/data/parent";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";

export default async function ParentHomePage() {
  const [user, { data, error }, { t, f }] = await Promise.all([getSessionUser(), getParentDashboard(), getI18n()]);
  if (error) return (<div className="animate-fade-up"><PageHeader title={t("nav.home")} /><ErrorState title={t("dashboard.loadError")} message={error} /></div>);
  const d = data!;
  const first = user?.fullName?.split(" ")[0] ?? t("dashboard.greetingFallback");

  return (
    <div className="animate-fade-up space-y-6">
      <div><p className="text-sm text-ink-3">{t("dashboard.welcome")}</p><h1 className="text-2xl font-semibold">{t("dashboard.greeting", { name: first })}</h1></div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Link href="/parent/invoices" className="block">
          <Card className="bg-radial-maroon transition active:scale-[0.99]">
            <CardBody>
              <p className="text-xs uppercase tracking-wide text-ink-3">{t("parentHome.balanceDue")}</p>
              <p className="mt-1 tnum text-2xl font-semibold">{f.money(d.openInvoices.balance)}</p>
              <p className="mt-1 text-xs text-ink-3">{t("parentHome.openInvoices", { count: d.openInvoices.count })}</p>
            </CardBody>
          </Card>
        </Link>
        <Link href="/parent/notifications" className="block">
          <Card className="transition active:scale-[0.99] hover:border-maroon/40">
            <CardBody>
              <p className="text-xs uppercase tracking-wide text-ink-3">{t("parentHome.notifications")}</p>
              <p className="mt-1 text-2xl font-semibold">{d.unreadNotifications}</p>
              <p className="mt-1 text-xs text-ink-3">{t("parentHome.unread")}</p>
            </CardBody>
          </Card>
        </Link>
        <Card>
          <CardBody>
            <p className="text-xs uppercase tracking-wide text-ink-3">{t("parentHome.activeRegistrations")}</p>
            <p className="mt-1 text-2xl font-semibold">{d.activeRegistrations}</p>
            <p className="mt-1 text-xs text-ink-3">{t("parentHome.documentsOnFile", { count: d.documentCount })}</p>
          </CardBody>
        </Card>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink-2">{t("parentHome.myChildren")}</h2>
        {d.children.length === 0 ? (
          <EmptyState icon={<UserCircle className="h-5 w-5" />} title={t("parentHome.noChildren")} description={t("parentHome.noChildrenHint")} />
        ) : (
          <div className="space-y-2">
            {d.children.map((c) => (
              <Link key={c.id} href={`/parent/children/${c.id}`}>
                <Card className="transition active:scale-[0.99] hover:border-maroon/40">
                  <CardBody className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-elevated text-maroon"><UserCircle className="h-5 w-5" /></div>
                    <div className="flex-1"><div className="font-medium text-ink">{c.name}</div>{c.age !== null && <div className="text-xs text-ink-3">{t("common.ageYears", { age: c.age })}</div>}</div>
                    <ChevronRight className="h-4 w-4 text-ink-4" />
                  </CardBody>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink-2"><CalendarClock className="h-4 w-4" /> {t("parentHome.upcomingSessions")}</h2>
        {d.upcomingSessions.length === 0 ? (
          <Card><CardBody className="py-4 text-sm text-ink-3">{t("parentHome.noUpcomingSessions")}</CardBody></Card>
        ) : (
          <Card><CardBody className="p-0">
            {d.upcomingSessions.map((s) => (
              <div key={s.id} className="flex items-center justify-between border-b border-line-soft px-4 py-3 last:border-0">
                <div><div className="text-sm text-ink">{s.programName}</div><div className="text-xs text-ink-3">{f.date(s.startsAt, { weekday: true })} · {f.time(s.startsAt)}{s.location ? ` · ${s.location}` : ""}</div></div>
              </div>
            ))}
          </CardBody></Card>
        )}
      </section>

      <section aria-label={t("parentHome.shortcuts")} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { href: "/parent/invoices", label: t("nav.invoices"), Icon: Receipt },
          { href: "/parent/documents", label: t("nav.documents"), Icon: FileText },
          { href: "/parent/bookings", label: t("nav.bookings"), Icon: ClipboardList },
          { href: "/parent/account", label: t("nav.account"), Icon: UserCircle },
        ].map((q) => (
          <Link key={q.href} href={q.href}>
            <Card className="transition active:scale-95 hover:border-maroon/40">
              <CardBody className="flex flex-col items-center gap-2 py-4 text-center">
                <q.Icon className="h-5 w-5 text-maroon" /><span className="text-xs text-ink-2">{q.label}</span>
              </CardBody>
            </Card>
          </Link>
        ))}
      </section>
    </div>
  );
}
