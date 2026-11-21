"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UserMinus, UserPlus } from "lucide-react";
import { Badge, Button, Card, Input, Label, statusTone } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { removeTeamMember, updateTeamMember } from "@/lib/sportsops/actions";
import { assignToTeam } from "@/lib/actions/roster";
import { parseJersey, POSITION_MAX } from "@/lib/sportsops/roster-validation";
import type { RosterEntry } from "@/lib/sportsops/data";
import { FormError, Select } from "./fields";
import { PlayerPicker, type PickerPlayer } from "./player-picker";
import { DeletePersonButton } from "@/components/people/delete-person";

type Status = RosterEntry["status"];
const STATUSES: Status[] = ["active", "trial", "injured", "inactive"];

function digits(v: string): string {
  return v.replace(/\D/g, "").slice(0, 3);
}

function Row({ teamId, m, editable, linkPlayers, canDeletePeople }: { teamId: string; m: RosterEntry; editable: boolean; linkPlayers: boolean; canDeletePeople: boolean }) {
  const t = useT();
  const router = useRouter();
  const [jersey, setJersey] = React.useState(m.jerseyNumber?.toString() ?? "");
  const [position, setPosition] = React.useState(m.position ?? "");
  const [status, setStatus] = React.useState<Status>(m.status);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const dirty = jersey !== (m.jerseyNumber?.toString() ?? "") || position !== (m.position ?? "") || status !== m.status;
  const statusLabel = (s: Status) => t.dynamic(`media.roster.status.${s}`, undefined, s);

  async function save() {
    setBusy(true); setErr(null);
    const res = await updateTeamMember(m.membershipId, teamId, { jerseyNumber: jersey === "" ? null : Number(jersey), position, status });
    setBusy(false);
    if (!res.ok) setErr(res.error); else router.refresh();
  }
  async function remove() {
    if (!confirm(t("media.roster.confirmRemoveRow", { name: m.name }))) return;
    setBusy(true);
    const res = await removeTeamMember(m.membershipId, teamId);
    setBusy(false);
    if (!res.ok) setErr(res.error); else router.refresh();
  }

  return (
    <tr className="border-b border-line-soft last:border-0">
      <td className="px-4 py-2.5">
        {editable ? <Input aria-label={t("media.roster.jerseyFor", { name: m.name })} className="h-8 w-16 tnum" inputMode="numeric" value={jersey} onChange={(e) => setJersey(digits(e.target.value))} />
          : <span className="font-mono tnum">{m.jerseyNumber ?? "—"}</span>}
      </td>
      <td className="px-4 py-2.5 font-medium text-ink">
        {linkPlayers ? <Link href={`/admin/athletes/${m.athleteId}`} className="hover:text-brand-primary">{m.name}</Link> : m.name}
        {err && <p className="text-xs text-danger">{err}</p>}
      </td>
      <td className="px-4 py-2.5">
        {editable ? <Input aria-label={t("media.roster.positionFor", { name: m.name })} className="h-8" maxLength={POSITION_MAX} value={position} onChange={(e) => setPosition(e.target.value)} placeholder="—" />
          : <span className="text-ink-2">{m.position ?? "—"}</span>}
      </td>
      <td className="px-4 py-2.5">
        {editable ? (
          <Select aria-label={t("media.roster.statusFor", { name: m.name })} className="h-8 w-28" value={status} onChange={(e) => setStatus(e.target.value as Status)}>
            {STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </Select>
        ) : <Badge tone={statusTone(m.status)}>{statusLabel(m.status)}</Badge>}
      </td>
      {editable && (
        <td className="px-4 py-2.5 text-right">
          <div className="flex justify-end gap-1">
            {dirty && <Button size="sm" onClick={save} disabled={busy}>{t("common.save")}</Button>}
            <Button size="icon" variant="ghost" aria-label={t("media.roster.removeName", { name: m.name })} title={t("media.roster.removeName", { name: m.name })} onClick={remove} disabled={busy}><UserMinus className="h-4 w-4" /></Button>
            {canDeletePeople && <DeletePersonButton kind="athlete" id={m.athleteId} name={m.name} variant="icon" />}
          </div>
        </td>
      )}
    </tr>
  );
}

/** "Add player": type-ahead search, optional number / position inline, one click. */
function AddPlayer({ teamId, athletes, onRoster }: { teamId: string; athletes: PickerPlayer[]; onRoster: string[] }) {
  const t = useT();
  const router = useRouter();
  const [player, setPlayer] = React.useState<PickerPlayer | null>(null);
  const [jersey, setJersey] = React.useState("");
  const [position, setPosition] = React.useState("");
  const [err, setErr] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!player) return;
    if (parseJersey(jersey) === undefined) return setErr(t("media.roster.errors.jersey"));
    setBusy(true); setErr(null); setOk(null);
    const res = await assignToTeam({ athleteId: player.id, teamId, jerseyNumber: jersey, position });
    setBusy(false);
    if (!res.ok) return setErr(res.error);
    setOk(t("media.roster.addedPlayer", { name: player.name }));
    setPlayer(null); setJersey(""); setPosition("");
    router.refresh();
  }

  return (
    <form onSubmit={add} className="grid grid-cols-[5rem_1fr] items-end gap-3 sm:grid-cols-[minmax(12rem,1.5fr)_5rem_1fr_auto]">
      <div className="col-span-2 sm:col-span-1">
        <Label htmlFor={`r-ath-${teamId}`}>{t("media.roster.addPlayer")}</Label>
        <PlayerPicker id={`r-ath-${teamId}`} players={athletes} excludeIds={onRoster} value={player} onChange={setPlayer} disabled={busy} />
      </div>
      <div>
        <Label htmlFor={`r-j-${teamId}`}>{t("media.roster.jersey")}</Label>
        <Input id={`r-j-${teamId}`} inputMode="numeric" className="tnum" value={jersey} onChange={(e) => setJersey(digits(e.target.value))} placeholder="—" />
      </div>
      <div>
        <Label htmlFor={`r-p-${teamId}`}>{t("media.roster.position")}</Label>
        <Input id={`r-p-${teamId}`} maxLength={POSITION_MAX} value={position} onChange={(e) => setPosition(e.target.value)} placeholder={t("media.roster.positionPlaceholder")} />
      </div>
      <Button type="submit" className="col-span-2 sm:col-span-1" loading={busy} disabled={busy || !player}><UserPlus className="h-4 w-4" /> {t("media.roster.add")}</Button>
      <div className="col-span-2 sm:col-span-4">
        <FormError message={err} />
        {ok && <p role="status" className="text-sm text-success">{ok}</p>}
      </div>
    </form>
  );
}

export function RosterManager({ teamId, roster, athletes, editable = true, canAdd = true, linkPlayers = false, canDeletePeople = false }: {
  teamId: string; roster: RosterEntry[]; athletes: { id: string; name: string }[]; editable?: boolean; canAdd?: boolean;
  /** Admins also get "Delete" (the person, everywhere) next to "Remove from team". Never for coaches. */
  canDeletePeople?: boolean;
  /** Link names to the admin player profile (admin pages). */
  linkPlayers?: boolean;
}) {
  const t = useT();
  const onRoster = React.useMemo(() => roster.map((r) => r.athleteId), [roster]);

  return (
    <div className="space-y-4">
      {editable && canAdd && (
        <Card className="p-4">
          <AddPlayer teamId={teamId} athletes={athletes} onRoster={onRoster} />
        </Card>
      )}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line-soft text-left text-xs uppercase tracking-wide text-ink-3">
              <th className="px-4 py-3 font-medium">#</th><th className="px-4 py-3 font-medium">{t("media.roster.player")}</th>
              <th className="px-4 py-3 font-medium">{t("media.roster.position")}</th><th className="px-4 py-3 font-medium">{t("media.roster.statusLabel")}</th>
              {editable && <th className="px-4 py-3" />}
            </tr></thead>
            <tbody>
              {roster.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-ink-3">{t("media.roster.emptyRoster")}</td></tr>}
              {roster.map((m) => <Row key={m.membershipId} teamId={teamId} m={m} editable={editable} linkPlayers={linkPlayers} canDeletePeople={canDeletePeople} />)}
            </tbody>
          </table>
        </div>
      </Card>
      {editable && canDeletePeople && roster.length > 0 && <p className="text-xs text-text-muted">{t("personDelete.removeFromTeamHint")}</p>}
    </div>
  );
}
