"use client";

import * as React from "react";
import { UserPlus } from "lucide-react";
import { Badge, Button, Input, Label, Select } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { ensureSelfParticipant } from "@/lib/actions/participants";
import {
  ageOn, initialMode, isAdultOn, mergeParticipants, pickerModes, selectParticipant, SEXES,
  type ParticipantOption, type PickerMode, type SelfState,
} from "@/lib/participants/validation";
import { AddParticipantDialog } from "./add-participant-dialog";
import { SomeoneElseForm, type SomeoneElseSlotContext } from "./someone-else-form";
import { useRequestId } from "./portal-dialog";

export type { SomeoneElseSlotContext } from "./someone-else-form";

export type ParticipantPickerProps = {
  /** The adult's participants from getParticipantChoices() (self first, then children). */
  participants: ParticipantOption[];
  /** "Myself" state: existing self profile, or the prefill to create it on first use. */
  self: SelfState;
  /** Selected athlete ids (controlled). */
  value: string[];
  /** New selection + the full list including participants created in the picker. */
  onChange: (ids: string[], all: ParticipantOption[]) => void;
  /** Several participants (camp week) or exactly one (training request). */
  multiple?: boolean;
  /** First day of the activity (YYYY-MM-DD): "Myself" requires 18+ on it. */
  activityDate: string;
  allowSelf?: boolean;
  allowOther?: boolean;
  /** Why a participant cannot be chosen (e.g. outside the camp's ages); null = selectable. */
  disabledReason?: (p: ParticipantOption) => string | null;
  /** Extra badge / note next to a participant. */
  renderBadge?: (p: ParticipantOption) => React.ReactNode;
  /** Per-participant options under a selected participant (camp days, questions). */
  renderSelected?: (p: ParticipantOption) => React.ReactNode;
  /**
   * "Someone else" slot (Workstream B). Defaults to <SomeoneElseForm>, which
   * calls createThirdPartyParticipant(). Call ctx.onCreated(participant) to add
   * the new participant to the list and select it.
   */
  someoneElse?: (ctx: SomeoneElseSlotContext) => React.ReactNode;
  /** After a participant is created here (e.g. refresh server data or navigate). */
  onCreated?: (p: ParticipantOption) => void;
  idPrefix?: string;
  disabled?: boolean;
  legend?: string;
};

/**
 * Who is this booking for? "Myself", "A child in my family" or "Someone
 * else". Adding a child or creating the self profile happens inline (dialog /
 * mini form) and the new participant is selected at once, so the rest of the
 * booking form (activity, dates, options) keeps its state.
 */
export function ParticipantPicker(props: ParticipantPickerProps) {
  const {
    self, value, onChange, multiple = false, activityDate, allowSelf = true, allowOther = true,
    disabledReason, renderBadge, renderSelected, someoneElse, onCreated, idPrefix = "pp", disabled, legend,
  } = props;
  const t = useT();
  const [added, setAdded] = React.useState<ParticipantOption[]>([]);
  const [selfState, setSelfState] = React.useState<SelfState>(self);
  const all = React.useMemo(() => mergeParticipants(props.participants, added), [props.participants, added]);
  const modes = pickerModes({ allowSelf, allowOther, self: selfState, on: activityDate });
  const [mode, setMode] = React.useState<PickerMode>(() => initialMode(value, all, modes));
  const [adding, setAdding] = React.useState(false);
  const activeMode = modes.includes(mode) ? mode : "child";

  const selfOption = all.find((p) => p.kind === "self") ?? null;
  const children = all.filter((p) => p.kind === "child");
  const others = all.filter((p) => p.kind === "other");

  function toggle(p: ParticipantOption, list = all) {
    onChange(selectParticipant(value, p.id, multiple), list);
  }
  function created(p: ParticipantOption) {
    const list = mergeParticipants(all, [p]);
    setAdded((a) => mergeParticipants(a, [p]));
    if (p.kind === "self") setSelfState((s) => ({ ...s, athleteId: p.id, dob: p.dob }));
    onChange(multiple ? Array.from(new Set([...value, p.id])) : [p.id], list);
    onCreated?.(p);
  }

  const modeLabel: Record<PickerMode, string> = {
    self: t("participants.picker.self"),
    child: t("participants.picker.child"),
    other: t("participants.picker.other"),
  };

  function row(p: ParticipantOption) {
    const on = value.includes(p.id);
    const reason = on ? null : disabledReason?.(p) ?? null;
    const age = ageOn(p.dob, activityDate);
    return (
      <li key={p.id} className="space-y-2">
        <label className={cn("flex cursor-pointer items-center gap-2 text-sm text-text", reason && "cursor-not-allowed opacity-60")}>
          <input type={multiple ? "checkbox" : "radio"} name={`${idPrefix}-participant`} checked={on} disabled={disabled || !!reason}
            className="h-4 w-4 accent-[var(--red-primary)]" onChange={() => toggle(p)} />
          <span>{p.name}</span>
          {age !== null && <span className="text-xs text-text-muted">{t("participants.picker.age", { age })}</span>}
          {p.kind === "other" && <Badge tone="info">{t("participants.picker.otherBadge")}</Badge>}
          {renderBadge?.(p)}
        </label>
        {reason && <p className="text-xs text-text-muted">{reason}</p>}
        {on && renderSelected?.(p)}
      </li>
    );
  }

  return (
    <fieldset className="space-y-3" disabled={disabled}>
      {legend && <legend className="mb-1 text-lg font-semibold text-text">{legend}</legend>}
      {modes.length > 1 && (
        <div role="radiogroup" aria-label={t("participants.picker.label")} className="flex flex-wrap gap-2">
          {modes.map((m) => (
            <button key={m} type="button" role="radio" aria-checked={activeMode === m} onClick={() => setMode(m)}
              className={cn("touch-target rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:shadow-focus",
                activeMode === m ? "border-brand-primary bg-brand-primary-soft text-text" : "border-border text-text-muted hover:text-text")}>
              {modeLabel[m]}
            </button>
          ))}
        </div>
      )}

      {activeMode === "self" && (
        selfOption
          ? <ul className="space-y-3">{row(selfOption)}</ul>
          : <SelfProfileForm initial={selfState} activityDate={activityDate} idPrefix={idPrefix} onCreated={created} />
      )}

      {activeMode === "child" && (
        <div className="space-y-3">
          {children.length === 0 && <p className="text-sm text-text-muted">{t("participants.picker.noChildren")}</p>}
          <ul className="space-y-3">{children.map((p) => row(p))}</ul>
          <Button type="button" variant="secondary" size="sm" onClick={() => setAdding(true)} disabled={disabled}>
            <UserPlus className="h-4 w-4" aria-hidden /> {t("participants.add.child")}
          </Button>
          <AddParticipantDialog open={adding} onClose={() => setAdding(false)} onCreated={created} />
        </div>
      )}

      {activeMode === "other" && (
        <div className="space-y-3">
          {others.length > 0 && <ul className="space-y-3">{others.map((p) => row(p))}</ul>}
          {(someoneElse ?? ((ctx: SomeoneElseSlotContext) => <SomeoneElseForm {...ctx} />))({
            activityDate, idPrefix, onCreated: created, onCancel: () => setMode("child"),
          })}
        </div>
      )}

      {/* Selected participants of the other modes stay visible (multi-select). */}
      {multiple && all.filter((p) => value.includes(p.id) && modeOf(p) !== activeMode).length > 0 && (
        <p className="text-xs text-text-muted">
          {t("participants.picker.alsoSelected", { names: all.filter((p) => value.includes(p.id) && modeOf(p) !== activeMode).map((p) => p.name).join(", ") })}
        </p>
      )}
    </fieldset>
  );
}

function modeOf(p: ParticipantOption): PickerMode {
  return p.kind === "self" ? "self" : p.kind === "other" ? "other" : "child";
}

/** "Myself" on first use: the adult's name (prefilled), DOB (required: 18+), sex. */
function SelfProfileForm({ initial, activityDate, idPrefix, onCreated }: {
  initial: SelfState; activityDate: string; idPrefix: string; onCreated: (p: ParticipantOption) => void;
}) {
  const t = useT();
  const [d, setD] = React.useState({ firstName: initial.firstName, lastName: initial.lastName, dob: initial.dob ?? "", sex: "" });
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [requestId, resetRequestId] = useRequestId();
  const set = (k: keyof typeof d) => (v: string) => { setErr(null); setD((x) => ({ ...x, [k]: v })); };
  const minor = !!d.dob && !isAdultOn(d.dob, activityDate);

  async function submit() {
    if (minor) { setErr(t("participants.errors.SELF_MUST_BE_ADULT")); return; }
    setBusy(true); setErr(null);
    const res = await ensureSelfParticipant({ firstName: d.firstName, lastName: d.lastName, dob: d.dob, sex: d.sex as "" | (typeof SEXES)[number], at: activityDate }, requestId());
    setBusy(false);
    if (!res.ok) { setErr(res.error); return; }
    resetRequestId();
    onCreated(res.data.participant);
  }

  const id = (k: string) => `${idPrefix}-self-${k}`;
  return (
    <div className="space-y-3 rounded-md border border-border p-4">
      <p className="text-sm text-text-muted">{t("participants.self.intro")}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div><Label htmlFor={id("fn")}>{t("participants.fields.firstName")}</Label>
          <Input id={id("fn")} maxLength={80} value={d.firstName} onChange={(e) => set("firstName")(e.target.value)} /></div>
        <div><Label htmlFor={id("ln")}>{t("participants.fields.lastName")}</Label>
          <Input id={id("ln")} maxLength={80} value={d.lastName} onChange={(e) => set("lastName")(e.target.value)} /></div>
        <div><Label htmlFor={id("dob")}>{t("participants.fields.dob")}</Label>
          <Input id={id("dob")} type="date" value={d.dob} onChange={(e) => set("dob")(e.target.value)} /></div>
        <div><Label htmlFor={id("sex")}>{t("participants.fields.sexOptional")}</Label>
          <Select id={id("sex")} value={d.sex} onChange={(e) => set("sex")(e.target.value)}>
            <option value="">—</option>
            {SEXES.map((s) => <option key={s} value={s}>{t(`participants.sex.${s}`)}</option>)}
          </Select></div>
      </div>
      {minor && <p className="text-xs text-danger">{t("participants.errors.SELF_MUST_BE_ADULT")}</p>}
      {err && !minor && <p role="alert" className="text-sm text-danger">{err}</p>}
      <div className="flex justify-end">
        <Button type="button" size="sm" loading={busy} disabled={!d.firstName.trim() || !d.lastName.trim() || !d.dob || minor || busy}
          onClick={() => void submit()}>{t("participants.self.submit")}</Button>
      </div>
    </div>
  );
}
