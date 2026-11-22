"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, MoreHorizontal, Plus, Shield, Trash2, X } from "lucide-react";
import { Button, Card, CardBody, CardHeader, CardTitle, Input, Label, Select } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import { assignToTeam, moveMembership, removeMembership, updateMembership } from "@/lib/actions/roster";
import { parseJersey, POSITION_MAX, sortTeamsForPicker, type TeamPickerOption } from "@/lib/sportsops/roster-validation";
import type { PlayerTeam } from "@/lib/data/player-profile";
import { TeamOptionGroups } from "./team-option-groups";

type Msg = { ok: boolean; text: string } | null;

function digits(v: string): string {
  return v.replace(/\D/g, "").slice(0, 3);
}

/** Colour dot for a team: the team colour is data (a tenant choice), never a literal here. */
function TeamDot({ color }: { color: string | null }) {
  return (
    <span
      aria-hidden
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-border-strong bg-brand-primary"
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}

/** Grouped options: current season, selection programmes (EYBL U14, EYBL U16 …), other seasons, no season. */
function TeamOptions({ options }: { options: TeamPickerOption[] }) {
  return <TeamOptionGroups teams={options} />;
}

function ChipEditor({ m, moveOptions, onDone }: { m: PlayerTeam; moveOptions: TeamPickerOption[]; onDone: (msg: Msg) => void }) {
  const t = useT();
  const router = useRouter();
  const [jersey, setJersey] = React.useState(m.jerseyNumber?.toString() ?? "");
  const [position, setPosition] = React.useState(m.position ?? "");
  const [toTeam, setToTeam] = React.useState("");
  const [busy, setBusy] = React.useState<null | "save" | "move" | "remove">(null);
  const [err, setErr] = React.useState<string | null>(null);
  const idp = `chip-${m.membershipId}`;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (parseJersey(jersey) === undefined) return setErr(t("media.roster.errors.jersey"));
    setBusy("save");
    setErr(null);
    const res = await updateMembership({ membershipId: m.membershipId, jerseyNumber: jersey, position });
    setBusy(null);
    if (!res.ok) return setErr(res.error);
    onDone({ ok: true, text: res.message ?? t("media.roster.updated") });
    router.refresh();
  }
  async function move() {
    if (!toTeam) return;
    setBusy("move");
    setErr(null);
    const res = await moveMembership({ membershipId: m.membershipId, toTeamId: toTeam });
    setBusy(null);
    if (!res.ok) return setErr(res.error);
    onDone({ ok: true, text: res.message ?? t("media.roster.updated") });
    router.refresh();
  }
  async function remove() {
    if (!window.confirm(t("media.roster.confirmRemove", { team: m.teamName }))) return;
    setBusy("remove");
    setErr(null);
    const res = await removeMembership(m.membershipId);
    setBusy(null);
    if (!res.ok) return setErr(res.error);
    onDone({ ok: true, text: res.message ?? t("media.roster.removed") });
    router.refresh();
  }

  return (
    <div className="space-y-4 rounded-md border border-border bg-surface-elevated p-3">
      <form onSubmit={save} className="grid grid-cols-[5rem_1fr] gap-2 sm:grid-cols-[5rem_1fr_auto] sm:items-end">
        <div>
          <Label htmlFor={`${idp}-j`}>{t("media.roster.jersey")}</Label>
          <Input id={`${idp}-j`} inputMode="numeric" className="tnum" value={jersey} onChange={(e) => setJersey(digits(e.target.value))} placeholder="—" />
        </div>
        <div>
          <Label htmlFor={`${idp}-p`}>{t("media.roster.position")}</Label>
          <Input id={`${idp}-p`} maxLength={POSITION_MAX} value={position} onChange={(e) => setPosition(e.target.value)} placeholder={t("media.roster.positionPlaceholder")} />
        </div>
        <Button type="submit" size="sm" className="col-span-2 sm:col-span-1" loading={busy === "save"} disabled={!!busy}>{t("common.save")}</Button>
      </form>
      {moveOptions.length > 0 && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <Label htmlFor={`${idp}-m`}>{t("media.roster.moveTo")}</Label>
            <Select id={`${idp}-m`} value={toTeam} onChange={(e) => setToTeam(e.target.value)}>
              <option value="">{t("media.roster.chooseTeam")}</option>
              <TeamOptions options={moveOptions} />
            </Select>
          </div>
          <Button type="button" size="sm" variant="secondary" onClick={move} loading={busy === "move"} disabled={!toTeam || !!busy}>
            <ArrowRightLeft className="h-4 w-4" aria-hidden /> {t("media.roster.move")}
          </Button>
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <Link href={`/admin/teams/${m.teamId}`} className="text-xs text-brand-primary hover:underline">{t("media.roster.openTeam")}</Link>
        <Button type="button" size="sm" variant="ghost" onClick={remove} loading={busy === "remove"} disabled={!!busy}>
          <Trash2 className="h-4 w-4" aria-hidden /> {t("media.roster.removeFromTeam")}
        </Button>
      </div>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
    </div>
  );
}

/**
 * "Teams" card on the player profile / edit page. Each team is a chip; admins
 * get a small menu per chip (number / position, move to another team, remove)
 * and an "Add to team…" dropdown with optional number and position inline.
 */
export function PlayerTeamsCard({
  athleteId,
  teams,
  options,
  editable,
  className,
}: {
  athleteId: string;
  teams: PlayerTeam[];
  options: TeamPickerOption[];
  editable: boolean;
  className?: string;
}) {
  const t = useT();
  const router = useRouter();
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [teamId, setTeamId] = React.useState("");
  const [jersey, setJersey] = React.useState("");
  const [position, setPosition] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<Msg>(null);
  const onTeams = teams.map((m) => m.teamId);
  const addable = sortTeamsForPicker(options, onTeams);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!teamId) return;
    if (parseJersey(jersey) === undefined) return setMsg({ ok: false, text: t("media.roster.errors.jersey") });
    setBusy(true);
    setMsg(null);
    const res = await assignToTeam({ athleteId, teamId, jerseyNumber: jersey, position });
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: res.error });
    setMsg({ ok: true, text: res.message ?? t("media.roster.updated") });
    setTeamId("");
    setJersey("");
    setPosition("");
    router.refresh();
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Shield className="h-4 w-4" aria-hidden /> {t("media.roster.teamsTitle")}</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        {teams.length === 0 ? (
          <p className="text-sm text-text-muted">{t("media.roster.noTeams")}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {teams.map((m) => {
              const meta = [m.jerseyNumber !== null ? `#${m.jerseyNumber}` : null, m.position].filter(Boolean).join(" · ");
              const open = openId === m.membershipId;
              return (
                <li key={m.membershipId}>
                  <span
                    className={cn(
                      "inline-flex items-center gap-2 rounded-full border bg-surface-elevated py-1 pl-3 text-sm text-text",
                      open ? "border-brand-primary" : "border-border",
                      editable ? "pr-1" : "pr-3",
                    )}
                  >
                    <TeamDot color={m.color} />
                    <span className="font-medium">{m.teamName}</span>
                    {meta && <span className="tnum text-xs text-text-muted">{meta}</span>}
                    {m.status !== "active" && <span className="text-xs text-warning">{t.dynamic(`media.roster.status.${m.status}`, undefined, m.status)}</span>}
                    {editable && (
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-label={t("media.roster.chipMenu", { team: m.teamName })}
                        onClick={() => setOpenId(open ? null : m.membershipId)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-text-muted hover:bg-surface hover:text-text focus-visible:shadow-focus"
                      >
                        {open ? <X className="h-4 w-4" aria-hidden /> : <MoreHorizontal className="h-4 w-4" aria-hidden />}
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {editable && openId && (() => {
          const m = teams.find((x) => x.membershipId === openId);
          if (!m) return null;
          return (
            <ChipEditor
              key={m.membershipId}
              m={m}
              moveOptions={sortTeamsForPicker(options, onTeams)}
              onDone={(res) => {
                setMsg(res);
                setOpenId(null);
              }}
            />
          );
        })()}

        {editable && (
          addable.length === 0 ? (
            <p className="text-xs text-text-muted">{options.length ? t("media.roster.onAllTeams") : t("media.roster.noTeamsInClub")}</p>
          ) : (
            <form onSubmit={add} className="grid grid-cols-[5rem_1fr] gap-2 sm:grid-cols-[minmax(10rem,1.4fr)_5rem_1fr_auto] sm:items-end">
              <div className="col-span-2 sm:col-span-1">
                <Label htmlFor={`add-team-${athleteId}`}>{t("media.roster.addToTeam")}</Label>
                <Select id={`add-team-${athleteId}`} value={teamId} onChange={(e) => setTeamId(e.target.value)} required>
                  <option value="">{t("media.roster.chooseTeam")}</option>
                  <TeamOptions options={addable} />
                </Select>
              </div>
              <div>
                <Label htmlFor={`add-j-${athleteId}`}>{t("media.roster.jersey")}</Label>
                <Input id={`add-j-${athleteId}`} inputMode="numeric" className="tnum" value={jersey} onChange={(e) => setJersey(digits(e.target.value))} placeholder="—" />
              </div>
              <div>
                <Label htmlFor={`add-p-${athleteId}`}>{t("media.roster.position")}</Label>
                <Input id={`add-p-${athleteId}`} maxLength={POSITION_MAX} value={position} onChange={(e) => setPosition(e.target.value)} placeholder={t("media.roster.positionPlaceholder")} />
              </div>
              <Button type="submit" className="col-span-2 sm:col-span-1" loading={busy} disabled={!teamId || busy}>
                <Plus className="h-4 w-4" aria-hidden /> {t("common.save")}
              </Button>
            </form>
          )
        )}
        {msg && <p role="status" className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}
      </CardBody>
    </Card>
  );
}
