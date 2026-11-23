"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, LogOut, UserPlus } from "lucide-react";
import { Button, FieldHint, Input, Label, Select } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { rosterAdd, rosterLeave, rosterTransfer } from "@/lib/actions/team-attendance";
import { PlayerPicker, type PickerPlayer } from "@/components/teams/player-picker";

/**
 * Effective-dated roster actions (team_member_add / leave / transfer RPCs).
 * Every change takes the date it applies from; leaving and transfers need a
 * reason. A player may stay on several teams at once (add without leaving).
 */

function digits(v: string): string {
  return v.replace(/\D/g, "").slice(0, 3);
}

export function AddPlayerForm({ teamId, players, excludeIds, today }: { teamId: string; players: PickerPlayer[]; excludeIds: string[]; today: string }) {
  const t = useT();
  const router = useRouter();
  const [player, setPlayer] = React.useState<PickerPlayer | null>(null);
  const [date, setDate] = React.useState(today);
  const [jersey, setJersey] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!player) return;
    setBusy(true); setError(null); setMessage(null);
    const res = await rosterAdd({ teamId, athleteId: player.id, effectiveOn: date || null, jerseyNumber: jersey === "" ? null : Number(jersey) });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setMessage(t("adminAttendance.roster.added", { name: player.name }));
    setPlayer(null); setJersey("");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(12rem,1.6fr)_10rem_5rem_auto] sm:items-end">
        <div>
          <Label htmlFor={`add-${teamId}`}>{t("adminAttendance.roster.addPlayer")}</Label>
          <PlayerPicker id={`add-${teamId}`} players={players} excludeIds={excludeIds} value={player} onChange={setPlayer} disabled={busy} />
        </div>
        <div>
          <Label htmlFor={`add-date-${teamId}`}>{t("adminAttendance.roster.effectiveFrom")}</Label>
          <Input id={`add-date-${teamId}`} type="date" value={date} onChange={(e) => setDate(e.target.value)} required disabled={busy} />
        </div>
        <div>
          <Label htmlFor={`add-j-${teamId}`}>{t("adminAttendance.roster.jersey")}</Label>
          <Input id={`add-j-${teamId}`} inputMode="numeric" className="tnum" value={jersey} onChange={(e) => setJersey(digits(e.target.value))} placeholder="—" disabled={busy} />
        </div>
        <Button type="submit" size="md" disabled={busy || !player}><UserPlus className="h-4 w-4" aria-hidden /> {t("adminAttendance.roster.add")}</Button>
      </div>
      <FieldHint>{t("adminAttendance.roster.multiTeamHint")}</FieldHint>
      {error && <FieldHint error>{error}</FieldHint>}
      {message && <FieldHint>{message}</FieldHint>}
    </form>
  );
}

type Mode = null | "leave" | "transfer";

export function RosterRowActions({ teamId, athleteId, name, teams, today }: {
  teamId: string; athleteId: string; name: string; teams: { id: string; name: string }[]; today: string;
}) {
  const t = useT();
  const router = useRouter();
  const [mode, setMode] = React.useState<Mode>(null);
  const [date, setDate] = React.useState(today);
  const [reason, setReason] = React.useState("");
  const [toTeam, setToTeam] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const res = mode === "transfer"
      ? await rosterTransfer({ fromTeamId: teamId, toTeamId: toTeam, athleteId, effectiveOn: date, reason })
      : await rosterLeave({ teamId, athleteId, effectiveOn: date, reason });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setMode(null); setReason(""); setToTeam("");
    router.refresh();
  }

  return (
    <div className="flex flex-col items-stretch gap-2 sm:items-end">
      <div className="flex justify-end gap-1">
        <Button size="sm" variant={mode === "transfer" ? "secondary" : "ghost"} onClick={() => setMode(mode === "transfer" ? null : "transfer")}
          aria-expanded={mode === "transfer"} aria-label={t("adminAttendance.roster.transferName", { name })}>
          <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden /> {t("adminAttendance.roster.transfer")}
        </Button>
        <Button size="sm" variant={mode === "leave" ? "secondary" : "ghost"} onClick={() => setMode(mode === "leave" ? null : "leave")}
          aria-expanded={mode === "leave"} aria-label={t("adminAttendance.roster.leaveName", { name })}>
          <LogOut className="h-3.5 w-3.5" aria-hidden /> {t("adminAttendance.roster.leave")}
        </Button>
      </div>
      {mode && (
        <form onSubmit={submit} className="w-full space-y-2 rounded-md bg-surface-elevated p-3 text-left sm:w-[26rem]">
          {mode === "transfer" && (
            <div>
              <Label htmlFor={`to-${athleteId}`}>{t("adminAttendance.roster.toTeam")}</Label>
              <Select id={`to-${athleteId}`} value={toTeam} onChange={(e) => setToTeam(e.target.value)} required disabled={busy}>
                <option value="">{t("adminAttendance.roster.chooseTeam")}</option>
                {teams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </Select>
            </div>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[10rem_1fr]">
            <div>
              <Label htmlFor={`d-${athleteId}`}>{mode === "transfer" ? t("adminAttendance.roster.effectiveFrom") : t("adminAttendance.roster.offFrom")}</Label>
              <Input id={`d-${athleteId}`} type="date" value={date} onChange={(e) => setDate(e.target.value)} required disabled={busy} />
            </div>
            <div>
              <Label htmlFor={`r-${athleteId}`}>{t("adminAttendance.roster.reason")}</Label>
              <Input id={`r-${athleteId}`} value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} maxLength={500} required disabled={busy} />
            </div>
          </div>
          <FieldHint>{mode === "transfer" ? t("adminAttendance.roster.transferHint") : t("adminAttendance.roster.leaveHint")}</FieldHint>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy || reason.trim().length < 3 || (mode === "transfer" && !toTeam)}>
              {mode === "transfer" ? t("adminAttendance.roster.confirmTransfer") : t("adminAttendance.roster.confirmLeave")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setMode(null)} disabled={busy}>{t("common.cancel")}</Button>
          </div>
          {error && <FieldHint error>{error}</FieldHint>}
        </form>
      )}
    </div>
  );
}
