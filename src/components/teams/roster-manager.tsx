"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2, UserPlus } from "lucide-react";
import { Badge, Button, Card, Input, Label, statusTone } from "@/components/ui";
import { addTeamMember, removeTeamMember, updateTeamMember } from "@/lib/sportsops/actions";
import type { RosterEntry } from "@/lib/sportsops/data";
import { FormError, Select } from "./fields";

type Status = RosterEntry["status"];
const STATUSES: Status[] = ["active", "trial", "injured", "inactive"];

function Row({ teamId, m, editable }: { teamId: string; m: RosterEntry; editable: boolean }) {
  const router = useRouter();
  const [jersey, setJersey] = React.useState(m.jerseyNumber?.toString() ?? "");
  const [position, setPosition] = React.useState(m.position ?? "");
  const [status, setStatus] = React.useState<Status>(m.status);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const dirty = jersey !== (m.jerseyNumber?.toString() ?? "") || position !== (m.position ?? "") || status !== m.status;

  async function save() {
    setBusy(true); setErr(null);
    const res = await updateTeamMember(m.membershipId, teamId, { jerseyNumber: jersey === "" ? null : Number(jersey), position, status });
    setBusy(false);
    if (!res.ok) setErr(res.error); else router.refresh();
  }
  async function remove() {
    if (!confirm(`Remove ${m.name} from the roster? Use status "inactive" to keep history.`)) return;
    setBusy(true);
    const res = await removeTeamMember(m.membershipId, teamId);
    setBusy(false);
    if (!res.ok) setErr(res.error); else router.refresh();
  }

  return (
    <tr className="border-b border-line-soft last:border-0">
      <td className="px-4 py-2.5">
        {editable ? <Input aria-label={`Jersey for ${m.name}`} className="h-8 w-16 tnum" inputMode="numeric" value={jersey} onChange={(e) => setJersey(e.target.value.replace(/\D/g, "").slice(0, 3))} />
          : <span className="font-mono tnum">{m.jerseyNumber ?? "—"}</span>}
      </td>
      <td className="px-4 py-2.5 font-medium text-ink">{m.name}{err && <p className="text-xs text-danger">{err}</p>}</td>
      <td className="px-4 py-2.5">
        {editable ? <Input aria-label={`Position for ${m.name}`} className="h-8" maxLength={60} value={position} onChange={(e) => setPosition(e.target.value)} placeholder="—" />
          : <span className="text-ink-2">{m.position ?? "—"}</span>}
      </td>
      <td className="px-4 py-2.5">
        {editable ? (
          <Select aria-label={`Status for ${m.name}`} className="h-8 w-28" value={status} onChange={(e) => setStatus(e.target.value as Status)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        ) : <Badge tone={statusTone(m.status)}>{m.status}</Badge>}
      </td>
      {editable && (
        <td className="px-4 py-2.5 text-right">
          <div className="flex justify-end gap-1">
            {dirty && <Button size="sm" onClick={save} disabled={busy}>Save</Button>}
            <Button size="icon" variant="ghost" aria-label={`Remove ${m.name}`} onClick={remove} disabled={busy}><Trash2 className="h-4 w-4" /></Button>
          </div>
        </td>
      )}
    </tr>
  );
}

export function RosterManager({ teamId, roster, athletes, editable = true, canAdd = true }: {
  teamId: string; roster: RosterEntry[]; athletes: { id: string; name: string }[]; editable?: boolean; canAdd?: boolean;
}) {
  const router = useRouter();
  const onRoster = new Set(roster.map((r) => r.athleteId));
  const available = athletes.filter((a) => !onRoster.has(a.id));
  const [athleteId, setAthleteId] = React.useState("");
  const [jersey, setJersey] = React.useState("");
  const [position, setPosition] = React.useState("");
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!athleteId) return;
    setBusy(true); setErr(null);
    const res = await addTeamMember(teamId, { athleteId, jerseyNumber: jersey === "" ? null : Number(jersey), position });
    setBusy(false);
    if (!res.ok) return setErr(res.error);
    setAthleteId(""); setJersey(""); setPosition("");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line-soft text-left text-xs uppercase tracking-wide text-ink-3">
              <th className="px-4 py-3 font-medium">#</th><th className="px-4 py-3 font-medium">Athlete</th>
              <th className="px-4 py-3 font-medium">Position</th><th className="px-4 py-3 font-medium">Status</th>
              {editable && <th className="px-4 py-3" />}
            </tr></thead>
            <tbody>
              {roster.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-ink-3">No athletes on this roster yet.</td></tr>}
              {roster.map((m) => <Row key={m.membershipId} teamId={teamId} m={m} editable={editable} />)}
            </tbody>
          </table>
        </div>
      </Card>
      {editable && canAdd && (
        <form onSubmit={add} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_96px_1fr_auto]">
          <div><Label htmlFor="r-ath">Add athlete</Label>
            <Select id="r-ath" value={athleteId} onChange={(e) => setAthleteId(e.target.value)}>
              <option value="">Select…</option>
              {available.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select></div>
          <div><Label htmlFor="r-j">Jersey</Label><Input id="r-j" inputMode="numeric" value={jersey} onChange={(e) => setJersey(e.target.value.replace(/\D/g, "").slice(0, 3))} /></div>
          <div><Label htmlFor="r-p">Position</Label><Input id="r-p" maxLength={60} value={position} onChange={(e) => setPosition(e.target.value)} placeholder="Optional" /></div>
          <Button type="submit" disabled={busy || !athleteId}><UserPlus className="h-4 w-4" /> Add</Button>
          <div className="sm:col-span-4"><FormError message={err} /></div>
        </form>
      )}
    </div>
  );
}
