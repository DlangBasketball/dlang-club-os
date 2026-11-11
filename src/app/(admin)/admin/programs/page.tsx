import { CalendarRange, Plus } from "lucide-react";
import { PageHeader, Button, Card, CardBody, Badge } from "@/components/ui";
import { formatCHF } from "@/lib/utils";

const PROGRAMS = [
  { name: "SPSA Summer Camp · Week 1", kind: "camp", price: 1490, spots: "12 / 24", public: true },
  { name: "SPSA Summer Camp · Week 2", kind: "camp", price: 1490, spots: "5 / 24", public: true },
  { name: "Big Ballers (U12)", kind: "recurring_team", price: 290, spots: "18 / 30", public: false },
  { name: "Mini Ballers (U8)", kind: "recurring_team", price: 180, spots: "9 / 30", public: false },
];

export default function ProgramsPage() {
  return (
    <div className="animate-fade-up">
      <PageHeader title="Programs & camps" description="Camps and recurring teams open for registration."
        actions={<Button><Plus className="h-4 w-4" /> New program</Button>} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {PROGRAMS.map((p) => (
          <Card key={p.name}>
            <CardBody>
              <div className="flex items-start justify-between">
                <h3 className="text-base font-semibold">{p.name}</h3>
                {p.public && <Badge tone="maroon">public</Badge>}
              </div>
              <div className="mt-3 flex items-center justify-between text-sm text-ink-2">
                <span>Capacity {p.spots}</span>
                <span className="tnum text-ink">{formatCHF(p.price)}</span>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
