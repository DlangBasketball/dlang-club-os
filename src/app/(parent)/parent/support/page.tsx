import Link from "next/link";
import { LifeBuoy, Mail, Receipt, CalendarClock, ShieldCheck } from "lucide-react";
import { PageHeader, Card, CardHeader, CardTitle, CardBody } from "@/components/ui";

const FAQ = [
  { q: "How do I pay an invoice?", a: "Open Invoices, choose an invoice and pay by card, or use the TWINT / bank transfer details with the payment reference shown." },
  { q: "How do I update medical information?", a: "Open your child's profile and edit the medical section. Changes are saved immediately and recorded for safety." },
  { q: "How do I book a training session?", a: "If booking is enabled, go to Bookings, pick a child, a service and an open slot." },
  { q: "Who can see my data?", a: "Only you and authorised club staff. Other families can never see your information." },
];

export default function ParentSupportPage() {
  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title="Help & support" description="Answers to common questions, and how to reach the club." />
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Mail className="h-4 w-4 text-maroon" /> Contact the club</CardTitle></CardHeader>
        <CardBody className="space-y-1 text-sm text-ink-2">
          <p>Email: <a href="mailto:hello@dlangbasketball.ch" className="text-maroon hover:underline">hello@dlangbasketball.ch</a></p>
          <p>We typically reply within one business day.</p>
        </CardBody>
      </Card>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><LifeBuoy className="h-4 w-4" /> FAQ</CardTitle></CardHeader>
        <CardBody className="divide-y divide-line-soft">
          {FAQ.map((f, i) => (
            <div key={i} className="py-3 first:pt-0 last:pb-0">
              <p className="text-sm font-medium text-ink">{f.q}</p>
              <p className="mt-1 text-sm text-ink-3">{f.a}</p>
            </div>
          ))}
        </CardBody>
      </Card>
      <div className="grid grid-cols-3 gap-3">
        <Link href="/parent/invoices"><Card className="transition active:scale-95 hover:border-maroon/40"><CardBody className="flex flex-col items-center gap-2 py-4 text-center"><Receipt className="h-5 w-5 text-maroon" /><span className="text-xs text-ink-2">Invoices</span></CardBody></Card></Link>
        <Link href="/parent/bookings"><Card className="transition active:scale-95 hover:border-maroon/40"><CardBody className="flex flex-col items-center gap-2 py-4 text-center"><CalendarClock className="h-5 w-5 text-maroon" /><span className="text-xs text-ink-2">Bookings</span></CardBody></Card></Link>
        <Link href="/parent/documents"><Card className="transition active:scale-95 hover:border-maroon/40"><CardBody className="flex flex-col items-center gap-2 py-4 text-center"><ShieldCheck className="h-5 w-5 text-maroon" /><span className="text-xs text-ink-2">Consents</span></CardBody></Card></Link>
      </div>
    </div>
  );
}
