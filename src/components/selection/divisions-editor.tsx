"use client";

import * as React from "react";
import Link from "next/link";
import { Pencil, Plus, Trash2, Users, X } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Input, Select } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { deleteDivision, saveDivision } from "@/lib/actions/selection";
import { confirmationMatches } from "@/lib/people/person-delete";
import { defaultDivisionTeamName, type PickerTeam } from "@/lib/teams/programme-teams";
import { TeamOptionGroups } from "@/components/teams/team-option-groups";
import { Field, Notice } from "./shared";
import { useRun, type SetupDivision } from "./setup-editor";

type TeamMode = "create" | "link" | "none";
type DivForm = {
  name: string; minBirthYear: string; maxBirthYear: string; ageUnder: string; ageCutoff: string; teamId: string; capacity: string; sort: string; isActive: boolean;
  teamMode: TeamMode; teamName: string;
};
const emptyDiv: DivForm = {
  name: "", minBirthYear: "", maxBirthYear: "", ageUnder: "", ageCutoff: "", teamId: "", capacity: "", sort: "0", isActive: true, teamMode: "create", teamName: "",
};
const s = (n: number | null | undefined) => (n == null ? "" : String(n));
type TeamDeleteChoice = "keep" | "archive" | "delete";
const TEAM_MODES: TeamMode[] = ["create", "link", "none"];
const TEAM_DELETE_CHOICES: TeamDeleteChoice[] = ["keep", "archive", "delete"];

/**
 * Divisions of a selection programme. A division gets its own team (created
 * here: "<programme short name> <division>", same sport, age group, level and
 * the programme's season) or is linked to an existing team; the linked team
 * links to its roster. Deleting a division with live applications needs
 * another division to move them to; its team is then kept, archived or
 * deleted (typed team name).
 */
export function DivisionsEditor({ programId, programName, divisions, teams, liveApplications = {} }: {
  programId: string; programName: string; divisions: SetupDivision[]; teams: PickerTeam[]; liveApplications?: Record<string, number>;
}) {
  const t = useT();
  const [editing, setEditing] = React.useState<string | "new" | null>(null);
  const [form, setForm] = React.useState<DivForm>(emptyDiv);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [removing, setRemoving] = React.useState<SetupDivision | null>(null);
  const [del, setDel] = React.useState<{ moveTo: string; team: TeamDeleteChoice; typed: string }>({ moveTo: "", team: "keep", typed: "" });
  const { busy, msg, run } = useRun();
  const teamById = new Map(teams.map((x) => [x.id, x]));
  const set = (k: keyof DivForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value }));
  const suggested = defaultDivisionTeamName(programName, form.name || "U14");
  const linked = form.teamId ? teamById.get(form.teamId) : undefined;

  function open(d?: SetupDivision) {
    setErrors({});
    setRemoving(null);
    setEditing(d?.id ?? "new");
    setForm(d ? {
      name: d.name, minBirthYear: s(d.minBirthYear), maxBirthYear: s(d.maxBirthYear), ageUnder: s(d.ageUnder), ageCutoff: d.ageCutoff ?? "",
      teamId: d.teamId ?? "", capacity: s(d.capacity), sort: String(d.sort), isActive: d.isActive,
      teamMode: d.teamId ? "link" : "none", teamName: "",
    } : { ...emptyDiv, sort: String(divisions.length + 1) });
  }
  async function save() {
    const res = await saveDivision(programId, editing === "new" ? null : editing, form);
    if (!res.ok) setErrors(("errors" in res && res.errors) || {});
    await run(async () => res, () => setEditing(null));
  }
  function askRemove(d: SetupDivision) {
    setEditing(null);
    setRemoving(d);
    setDel({ moveTo: "", team: "keep", typed: "" });
  }
  const removeTeam = removing?.teamId ? teamById.get(removing.teamId) ?? null : null;
  const live = removing ? liveApplications[removing.id] ?? 0 : 0;
  const others = removing ? divisions.filter((d) => d.id !== removing.id) : [];
  const canRemove = !!removing && !busy && (live === 0 || !!del.moveTo)
    && (del.team !== "delete" || !removeTeam || confirmationMatches(del.typed, removeTeam.name));
  async function remove() {
    if (!removing) return;
    await run(() => deleteDivision(programId, removing.id, {
      moveTo: del.moveTo || null,
      teamMode: removeTeam ? del.team : "keep",
      confirmTeamName: del.team === "delete" ? del.typed : undefined,
    }), () => setRemoving(null));
  }
  const rule = (d: SetupDivision) => {
    const parts: string[] = [];
    if (d.minBirthYear != null || d.maxBirthYear != null) parts.push(t("selection.divisions.bornRange", { from: d.minBirthYear ?? "…", to: d.maxBirthYear ?? "…" }));
    if (d.ageUnder != null) parts.push(t("selection.divisions.underAge", { age: d.ageUnder }));
    return parts.join(" · ") || t("selection.divisions.anyAge");
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>{t("selection.divisions.title")}</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/admin/teams/new?program=${programId}`} className="text-xs text-brand-primary hover:underline">{t("teamAdmin.division.newTeamLink")}</Link>
          <Button size="sm" variant="secondary" onClick={() => open()}><Plus className="h-4 w-4" /> {t("selection.divisions.add")}</Button>
        </div>
      </CardHeader>
      <CardBody className="space-y-3">
        {divisions.length === 0 && <p className="text-sm text-text-muted">{t("selection.divisions.empty")}</p>}
        <ul className="divide-y divide-border">
          {divisions.map((d) => {
            const team = d.teamId ? teamById.get(d.teamId) : undefined;
            return (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div>
                  <span className="font-medium text-text">{d.name}</span>{" "}
                  {!d.isActive && <Badge>{t("selection.common.inactive")}</Badge>}
                  <span className="block text-xs text-text-muted">
                    {rule(d)}
                    {d.capacity != null && <> · {t("selection.divisions.capacity")}: {d.capacity}</>}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
                    <Users className="h-3.5 w-3.5" aria-hidden />
                    {team ? (
                      <>
                        <Link href={`/admin/teams/${team.id}`} className="text-brand-primary hover:underline"
                          aria-label={t("teamAdmin.division.openRoster", { team: team.name })}>{team.name}</Link>
                        {!team.isActive && <Badge>{t("teamAdmin.list.archived")}</Badge>}
                      </>
                    ) : (
                      <span>{t("teamAdmin.division.noTeam")}</span>
                    )}
                  </span>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" aria-label={t("common.edit")} onClick={() => open(d)}><Pencil className="h-4 w-4" /></Button>
                  <Button size="sm" variant="ghost" aria-label={t("teamAdmin.division.deleteAria", { name: d.name })} disabled={busy} onClick={() => askRemove(d)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>

        {removing && (
          <div className="space-y-3 rounded-lg border border-danger/40 p-3 text-sm" role="group" aria-label={t("teamAdmin.division.deleteTitle", { name: removing.name })}>
            <p className="font-medium text-text">{t("teamAdmin.division.deleteTitle", { name: removing.name })}</p>
            {live > 0 ? (
              <Field label={t("teamAdmin.division.moveTo")} htmlFor="div-move" hint={t("teamAdmin.division.moveHint", { count: live })}>
                <Select id="div-move" value={del.moveTo} onChange={(e) => setDel((x) => ({ ...x, moveTo: e.target.value }))}>
                  <option value="">{t("teamAdmin.division.chooseDivision")}</option>
                  {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </Select>
              </Field>
            ) : (
              <p className="text-text-muted">{t("teamAdmin.division.noLiveApplications")}</p>
            )}
            {live > 0 && others.length === 0 && <p className="text-xs text-danger" role="alert">{t("teamAdmin.division.noOtherDivision")}</p>}
            {removeTeam && (
              <fieldset className="space-y-1.5">
                <legend className="mb-1 text-text">{t("teamAdmin.division.teamQuestion", { team: removeTeam.name })}</legend>
                {TEAM_DELETE_CHOICES.map((m) => (
                  <label key={m} className="flex items-start gap-2">
                    <input type="radio" name="div-team-mode" className="mt-1" checked={del.team === m} onChange={() => setDel((x) => ({ ...x, team: m }))} />
                    <span>
                      <span className="text-text">{t.dynamic(`teamAdmin.division.teamChoice.${m}`)}</span>
                      <span className="block text-xs text-text-muted">{t.dynamic(`teamAdmin.division.teamChoiceHint.${m}`)}</span>
                    </span>
                  </label>
                ))}
                {del.team === "delete" && (
                  <Field label={t("teamAdmin.delete.typeToConfirm", { name: removeTeam.name })} htmlFor="div-team-typed">
                    <Input id="div-team-typed" value={del.typed} autoComplete="off" spellCheck={false} onChange={(e) => setDel((x) => ({ ...x, typed: e.target.value }))} />
                  </Field>
                )}
              </fieldset>
            )}
            <div className="flex gap-2">
              <Button size="sm" variant="danger" disabled={!canRemove} loading={busy} onClick={remove}><Trash2 className="h-4 w-4" /> {t("teamAdmin.division.confirmDelete")}</Button>
              <Button size="sm" variant="ghost" onClick={() => setRemoving(null)}><X className="h-4 w-4" /> {t("common.cancel")}</Button>
            </div>
          </div>
        )}

        {editing && (
          <div className="space-y-3 rounded-lg border border-border p-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t("selection.divisions.name")} htmlFor="div-name" error={errors.name}><Input id="div-name" value={form.name} onChange={set("name")} placeholder="U14" /></Field>
              <Field label={t("selection.divisions.minBirthYear")} htmlFor="div-min" error={errors.minBirthYear}><Input id="div-min" inputMode="numeric" value={form.minBirthYear} onChange={set("minBirthYear")} /></Field>
              <Field label={t("selection.divisions.maxBirthYear")} htmlFor="div-max" error={errors.maxBirthYear}><Input id="div-max" inputMode="numeric" value={form.maxBirthYear} onChange={set("maxBirthYear")} /></Field>
              <Field label={t("selection.divisions.ageUnder")} htmlFor="div-under" error={errors.ageUnder} hint={t("selection.divisions.ageUnderHint")}><Input id="div-under" inputMode="numeric" value={form.ageUnder} onChange={set("ageUnder")} /></Field>
              <Field label={t("selection.divisions.ageCutoff")} htmlFor="div-cut" error={errors.ageCutoff}><Input id="div-cut" type="date" value={form.ageCutoff} onChange={set("ageCutoff")} /></Field>
              <Field label={t("selection.divisions.capacity")} htmlFor="div-cap" error={errors.capacity}><Input id="div-cap" inputMode="numeric" value={form.capacity} onChange={set("capacity")} /></Field>
              <Field label={t("selection.common.sort")} htmlFor="div-sort"><Input id="div-sort" inputMode="numeric" value={form.sort} onChange={set("sort")} /></Field>
              <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={form.isActive} onChange={set("isActive")} /> {t("selection.common.active")}</label>
            </div>
            <fieldset className="space-y-2 rounded-md border border-border p-3 text-sm">
              <legend className="px-1 text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">{t("selection.divisions.team")}</legend>
              <p className="text-xs text-text-muted">{t("selection.divisions.teamHint")}</p>
              {TEAM_MODES.map((m) => (
                <label key={m} className="flex items-start gap-2">
                  <input type="radio" name="div-team" className="mt-1" checked={form.teamMode === m} onChange={() => setForm((f) => ({ ...f, teamMode: m }))} />
                  <span className="text-text">{t.dynamic(`teamAdmin.division.mode.${m}`)}</span>
                </label>
              ))}
              {form.teamMode === "create" && (
                <Field label={t("teamAdmin.division.teamName")} htmlFor="div-team-name" error={errors.teamName} hint={t("teamAdmin.division.teamNameHint")}>
                  <Input id="div-team-name" maxLength={120} value={form.teamName} onChange={set("teamName")} placeholder={suggested} />
                </Field>
              )}
              {form.teamMode === "link" && (
                <Field label={t("teamAdmin.division.existingTeam")} htmlFor="div-team">
                  <Select id="div-team" value={form.teamId} onChange={set("teamId")}>
                    <option value="">{t("teamAdmin.division.chooseTeam")}</option>
                    {linked && !linked.isActive && <option value={linked.id}>{linked.name}</option>}
                    <TeamOptionGroups teams={teams} />
                  </Select>
                </Field>
              )}
            </fieldset>
            <div className="flex gap-2">
              <Button size="sm" disabled={busy || (form.teamMode === "link" && !form.teamId)} onClick={save}>{t("common.save")}</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(null)}><X className="h-4 w-4" /> {t("common.cancel")}</Button>
            </div>
          </div>
        )}
        <Notice msg={msg} />
      </CardBody>
    </Card>
  );
}
