import { Phone, Mail, MapPin, UserRound, Siren } from "lucide-react";
import { Card, CardHeader, CardTitle, CardBody, Badge, EmptyState } from "@/components/ui";
import type { Guardian } from "@/lib/data/families";

export function ParentContactSection({
  guardians,
  familyPhone,
  familyAddress,
  emergencyName,
  emergencyPhone,
}: {
  guardians: Guardian[];
  familyPhone: string | null;
  familyAddress: string | null;
  emergencyName?: string | null;
  emergencyPhone?: string | null;
}) {
  return (
    <Card>
      <CardHeader><CardTitle>Parent / guardian contact</CardTitle></CardHeader>
      <CardBody className="space-y-4">
        {guardians.length === 0 ? (
          <EmptyState icon={<UserRound className="h-5 w-5" />} title="No guardians linked" description="Invite a parent to link them to this family." />
        ) : (
          <ul className="space-y-3">
            {guardians.map((g) => (
              <li key={g.id} className="rounded-md bg-surface-elevated px-4 py-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-ink">{g.name ?? "Guardian"}</span>
                  {g.isPrimary && <Badge tone="maroon">primary</Badge>}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3">
                  {g.relation && <span className="capitalize">{g.relation}</span>}
                  {g.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{g.email}</span>}
                  {g.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{g.phone}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="grid grid-cols-1 gap-2 border-t border-line-soft pt-4 sm:grid-cols-2">
          {familyPhone && (
            <div className="flex items-center gap-2 text-sm text-ink-2"><Phone className="h-4 w-4 text-ink-3" />{familyPhone}</div>
          )}
          {familyAddress && (
            <div className="flex items-center gap-2 text-sm text-ink-2"><MapPin className="h-4 w-4 text-ink-3" />{familyAddress}</div>
          )}
        </div>

        {(emergencyName || emergencyPhone) && (
          <div className="flex items-center gap-2 rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-sm">
            <Siren className="h-4 w-4 text-danger" />
            <span className="text-ink">Emergency: {emergencyName ?? "—"}{emergencyPhone ? ` · ${emergencyPhone}` : ""}</span>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
