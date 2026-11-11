import Link from "next/link";
import { ShieldAlert, Lock, Pencil } from "lucide-react";
import { Card, CardHeader, CardTitle, CardBody, Badge, Button } from "@/components/ui";
import type { Medical } from "@/lib/data/athletes";

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-md bg-surface-elevated px-3 py-2">
      <div className="text-xs text-ink-3">{label}</div>
      <div className="text-sm text-ink">{value?.trim() ? value : "—"}</div>
    </div>
  );
}

export function MedicalSection({
  medical,
  athleteId,
  canView,
}: {
  medical: Medical;
  athleteId: string;
  canView: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-maroon" /> Medical
        </CardTitle>
        <div className="flex items-center gap-2">
          <Badge tone="danger">Sensitive</Badge>
          {canView && (
            <Link href={`/admin/athletes/${athleteId}/edit#medical`} className="text-ink-3 hover:text-ink">
              <Pencil className="h-4 w-4" />
            </Link>
          )}
        </div>
      </CardHeader>
      <CardBody>
        {!canView ? (
          <div className="flex items-center gap-2 py-4 text-sm text-ink-3">
            <Lock className="h-4 w-4" /> Medical information is restricted to club admins.
          </div>
        ) : !medical ? (
          <div className="flex flex-col items-start gap-3 py-2">
            <p className="text-sm text-ink-3">No medical information recorded yet.</p>
            <Link href={`/admin/athletes/${athleteId}/edit#medical`}>
              <Button size="sm" variant="secondary">Add medical info</Button>
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field label="Allergies" value={medical.allergies} />
            <Field label="Conditions" value={medical.conditions} />
            <Field label="Medications" value={medical.medications} />
            <Field label="Insurance" value={medical.insurance} />
            <Field label="Emergency contact" value={medical.emergencyContactName} />
            <Field label="Emergency phone" value={medical.emergencyContactPhone} />
            {medical.notes ? (
              <div className="sm:col-span-2"><Field label="Notes" value={medical.notes} /></div>
            ) : null}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
