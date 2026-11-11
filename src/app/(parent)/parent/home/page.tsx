import Link from "next/link";
import { UserCircle, Receipt, Bell, ChevronRight, CalendarClock, MapPin, FileText, ClipboardList } from "lucide-react";
import { PageHeader, Card, CardBody, Badge, EmptyState, ErrorState } from "@/components/ui";
import { getParentDashboard } from "@/lib/data/parent";
import { getSessionUser } from "@/lib/auth/get-user";
import { formatCHF, formatDate, formatTime } from "@/lib/utils";

export default async function ParentHomePage() {
  const [user, { data, error }] = await Promise.all([getSessionUser(), getParentDashboard()]);
  if (error) return (<div className="animate-fade-up"><PageHeader title="Home" /><ErrorState title="Couldn't load your dashboard" message={error} /></div>);
  const d = data!;
  const first = user?.fullName?.split(" ")[0] ?? "there";

  return (
    <div className="animate-fade-up space-y-6">
      <div><p className="text-sm text-ink-3">Welcome</p><h1 className="text-2xl font-semibold">Hi {first}</h1></div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Link href="/parent/invoices" className="block">
          <Card className="bg-radial-maroon transition active:scale-[0.99]">
            <CardBody>
              <p className="text-xs uppercase tracking-wide text-ink-3">Balance due</p>
              <p className="mt-1 tnum text-2xl font-semibold">{formatCHF(d.openInvoices.balance)}</p>
              <p className="mt-1 text-xs text-ink-3">{d.openInvoices.count} open invoice{d.openInvoices.count === 1 ? "" : "s"}</p>
            </CardBody>
          </Card>
        </Link>
        <Link href="/parent/notifications" className="block">
          <Card className="transition active:scale-[0.99] hover:border-maroon/40">
            <CardBody>
              <p className="text-xs uppercase tracking-wide text-ink-3">Notifications</p>
              <p className="mt-1 text-2xl font-semibold">{d.unreadNotifications}</p>
              <p className="mt-1 text-xs text-ink-3">unread</p>
            </CardBody>
          </Card>
        </Link>
        <Card>
          <CardBody>
            <p className="text-xs uppercase tracking-wide text-ink-3">Active registrations</p>
            <p className="mt-1 text-2xl font-semibold">{d.activeRegistrations}</p>
            <p className="mt-1 text-xs text-ink-3">{d.documentCount} document{d.documentCount === 1 ? "" : "s"} on file</p>
          </CardBody>
        </Card>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink-2">My children</h2>
        {d.children.length === 0 ? (
          <EmptyState icon={<UserCircle className="h-5 w-5" />} title="No children yet" description="Register for a program to add your child." />
        ) : (
          <div className="space-y-2">
            {d.children.map((c) => (
              <Link key={c.id} href={`/parent/children/${c.id}`}>
                <Card className="transition active:scale-[0.99] hover:border-maroon/40">
                  <CardBody className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-elevated text-maroon"><UserCircle className="h-5 w-5" /></div>
                    <div className="flex-1"><div className="font-medium text-ink">{c.name}</div>{c.age !== null && <div className="text-xs text-ink-3">Age {c.age}</div>}</div>
                    <ChevronRight className="h-4 w-4 text-ink-4" />
                  </CardBody>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink-2"><CalendarClock className="h-4 w-4" /> Upcoming sessions</h2>
        {d.upcomingSessions.length === 0 ? (
          <Card><CardBody className="py-4 text-sm text-ink-3">No upcoming sessions scheduled.</CardBody></Card>
        ) : (
          <Card><CardBody className="p-0">
            {d.upcomingSessions.map((s) => (
              <div key={s.id} className="flex items-center justify-between border-b border-line-soft px-4 py-3 last:border-0">
                <div><div className="text-sm text-ink">{s.programName}</div><div className="text-xs text-ink-3">{formatDate(s.startsAt)} · {formatTime(s.startsAt)}{s.location ? ` · ${s.location}` : ""}</div></div>
              </div>
            ))}
          </CardBody></Card>
        )}
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { href: "/parent/invoices", label: "Invoices", Icon: Receipt },
          { href: "/parent/documents", label: "Documents", Icon: FileText },
          { href: "/parent/bookings", label: "Bookings", Icon: ClipboardList },
          { href: "/parent/account", label: "Account", Icon: UserCircle },
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
