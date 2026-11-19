"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, UserPlus, X } from "lucide-react";
import { Button, Input, Label } from "@/components/ui";
import { saveTeam, type TeamInput } from "@/lib/sportsops/actions";
import { quickCreateCoach } from "@/lib/actions/coaches";
import { useT } from "@/lib/i18n/client";
import { COACH_NAME_MAX, COACH_TITLE_MAX } from "@/lib/coaches/validation";
import { FormError, Select, Textarea } from "./fields";

type Opt = { id: string; name: string };
type CoachRole = "head" | "assistant" | "manager" | "trainer";

export type TeamFormValues = {
  name: string; seasonId: string; programId: string; sport: string; ageGroup: string; gender: string; level: string;
  color: string; notes: string; isActive: boolean; coaches: { coachId: string; role: CoachRole }[];
};

export function TeamForm({ teamId, initial, seasons, programs, coaches, defaultSport }: {
  teamId?: string; initial?: Partial<TeamFormValues>; seasons: Opt[]; programs: Opt[]; coaches: Opt[]; defaultSport?: string;
}) {
  const router = useRouter();
  const tr = useT();
  const [coachOptions, setCoachOptions] = React.useState<Opt[]>(coaches);
  const [quick, setQuick] = React.useState<{ open: boolean; name: string; title: string; pending: boolean; msg: { ok: boolean; text: string } | null }>(
    { open: false, name: "", title: "", pending: false, msg: null },
  );
  const [f, setF] = React.useState<TeamFormValues>({
    name: "", seasonId: seasons[0]?.id ?? "", programId: "", sport: defaultSport ?? "", ageGroup: "", gender: "", level: "",
    color: "", notes: "", isActive: true, coaches: [], ...initial,
  });
  const [err, setErr] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const set = <K extends keyof TeamFormValues>(k: K, v: TeamFormValues[K]) => setF((s) => ({ ...s, [k]: v }));

  /** "+ New coach": create the coach, add it to the picker and to this team. */
  async function addQuickCoach() {
    if (!quick.name.trim() || quick.pending) return;
    setQuick((q) => ({ ...q, pending: true, msg: null }));
    const res = await quickCreateCoach({ displayName: quick.name, roleTitle: quick.title });
    if (!res.ok || !res.data) {
      setQuick((q) => ({ ...q, pending: false, msg: { ok: false, text: res.ok ? tr("coaches.errors.generic") : res.error } }));
      return;
    }
    const created = res.data;
    setCoachOptions((opts) => [...opts, { id: created.id, name: created.name }].sort((a, b) => a.name.localeCompare(b.name)));
    setF((s) => {
      const empty = s.coaches.findIndex((c) => !c.coachId);
      const coachesNext = empty >= 0
        ? s.coaches.map((c, j) => (j === empty ? { ...c, coachId: created.id } : c))
        : [...s.coaches, { coachId: created.id, role: s.coaches.length ? "assistant" as const : "head" as const }];
      return { ...s, coaches: coachesNext };
    });
    setQuick({ open: false, name: "", title: "", pending: false, msg: { ok: true, text: tr("coaches.team.added", { name: created.name }) } });
  }

  function onQuickKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault(); // never submit the team form from the quick-add fields
      void addQuickCoach();
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true); setErr(null);
    const payload: TeamInput = { ...f, coaches: f.coaches.filter((c) => c.coachId) };
    const res = await saveTeam(teamId ?? null, payload);
    setPending(false);
    if (!res.ok) return setErr(res.error);
    router.push(`/admin/teams/${res.data?.id ?? teamId}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><Label htmlFor="t-name">Team name</Label><Input id="t-name" required maxLength={120} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. U12 Girls A" /></div>
        <div><Label htmlFor="t-season">Season</Label>
          <Select id="t-season" value={f.seasonId} onChange={(e) => set("seasonId", e.target.value)}>
            <option value="">No season</option>
            {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select></div>
        <div><Label htmlFor="t-program">Linked program (billing)</Label>
          <Select id="t-program" value={f.programId} onChange={(e) => set("programId", e.target.value)}>
            <option value="">None</option>
            {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select></div>
        <div><Label htmlFor="t-sport">Sport</Label><Input id="t-sport" maxLength={60} value={f.sport} onChange={(e) => set("sport", e.target.value)} placeholder="Basketball, soccer, swimming…" /></div>
        <div><Label htmlFor="t-age">Age group</Label><Input id="t-age" maxLength={40} value={f.ageGroup} onChange={(e) => set("ageGroup", e.target.value)} placeholder="U12, Varsity, Seniors" /></div>
        <div><Label htmlFor="t-gender">Gender</Label>
          <Select id="t-gender" value={f.gender} onChange={(e) => set("gender", e.target.value)}>
            <option value="">—</option><option value="girls">Girls</option><option value="boys">Boys</option><option value="mixed">Mixed</option>
            <option value="women">Women</option><option value="men">Men</option><option value="open">Open</option>
          </Select></div>
        <div><Label htmlFor="t-level">Level / league</Label><Input id="t-level" maxLength={80} value={f.level} onChange={(e) => set("level", e.target.value)} placeholder="Competitive, Recreational, league name" /></div>
        <div><Label htmlFor="t-color">Calendar colour</Label>
          <div className="flex items-center gap-2">
            <input id="t-color" type="color" value={f.color || "#961f1f"} onChange={(e) => set("color", e.target.value)} className="h-10 w-14 cursor-pointer rounded border border-line bg-surface-input" />
            {f.color && <button type="button" className="text-xs text-ink-3 hover:text-ink" onClick={() => set("color", "")}>Clear</button>}
          </div></div>
        <label className="flex items-center gap-2 self-end text-sm text-ink-2"><input type="checkbox" checked={f.isActive} onChange={(e) => set("isActive", e.target.checked)} className="h-4 w-4 accent-[var(--red-primary)]" /> Active</label>
      </div>

      <fieldset className="space-y-2">
        <legend className="mb-1.5 text-xs font-medium text-ink-2">Coaches</legend>
        {f.coaches.map((c, i) => (
          <div key={i} className="flex gap-2">
            <Select aria-label="Coach" value={c.coachId} onChange={(e) => set("coaches", f.coaches.map((x, j) => (j === i ? { ...x, coachId: e.target.value } : x)))}>
              <option value="">Select coach…</option>
              {coachOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </Select>
            <Select aria-label="Role" className="w-40" value={c.role} onChange={(e) => set("coaches", f.coaches.map((x, j) => (j === i ? { ...x, role: e.target.value as CoachRole } : x)))}>
              <option value="head">{tr("coaches.roles.head")}</option><option value="assistant">{tr("coaches.roles.assistant")}</option>
              <option value="manager">{tr("coaches.roles.manager")}</option><option value="trainer">{tr("coaches.roles.trainer")}</option>
            </Select>
            <Button type="button" variant="ghost" size="icon" aria-label="Remove coach" onClick={() => set("coaches", f.coaches.filter((_, j) => j !== i))}><X className="h-4 w-4" /></Button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => set("coaches", [...f.coaches, { coachId: "", role: f.coaches.length ? "assistant" : "head" }])}>
            <Plus className="h-4 w-4" /> Add coach
          </Button>
          <Button type="button" variant="ghost" size="sm" aria-expanded={quick.open} aria-controls="quick-coach"
            onClick={() => setQuick((q) => ({ ...q, open: !q.open, msg: null }))}>
            <UserPlus className="h-4 w-4" /> {tr("coaches.team.newCoach")}
          </Button>
          <Link href="/admin/coaches" className="text-xs text-ink-3 hover:text-ink">{tr("coaches.team.editCoaches")} →</Link>
        </div>
        {quick.open && (
          <div id="quick-coach" role="group" aria-label={tr("coaches.team.quickTitle")} className="space-y-3 rounded border border-line bg-bg-secondary p-3">
            <p className="text-xs font-medium text-ink-2">{tr("coaches.team.quickTitle")}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div><Label htmlFor="qc-name">{tr("coaches.team.name")}</Label>
                <Input id="qc-name" autoFocus maxLength={COACH_NAME_MAX} value={quick.name} onKeyDown={onQuickKey}
                  onChange={(e) => setQuick((q) => ({ ...q, name: e.target.value }))} placeholder={tr("coaches.form.displayNamePlaceholder")} /></div>
              <div><Label htmlFor="qc-title">{tr("coaches.team.title")}</Label>
                <Input id="qc-title" maxLength={COACH_TITLE_MAX} value={quick.title} onKeyDown={onQuickKey}
                  onChange={(e) => setQuick((q) => ({ ...q, title: e.target.value }))} placeholder={tr("coaches.form.roleTitlePlaceholder")} /></div>
            </div>
            <div className="flex gap-2">
              <Button type="button" size="sm" loading={quick.pending} disabled={quick.pending || !quick.name.trim()} onClick={() => void addQuickCoach()}>
                {quick.pending ? tr("coaches.team.adding") : tr("coaches.team.add")}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setQuick({ open: false, name: "", title: "", pending: false, msg: null })}>
                {tr("coaches.team.cancel")}
              </Button>
            </div>
          </div>
        )}
        {quick.msg && <p role={quick.msg.ok ? "status" : "alert"} className={quick.msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{quick.msg.text}</p>}
      </fieldset>

      <div><Label htmlFor="t-notes">Notes</Label><Textarea id="t-notes" maxLength={2000} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></div>
      <FormError message={err} />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : teamId ? "Save team" : "Create team"}</Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}
