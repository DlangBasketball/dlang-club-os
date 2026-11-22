"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Plus, Trash2 } from "lucide-react";
import { Badge, Button, Input, Label, Select, Textarea } from "@/components/ui";
import { useFormat, useT } from "@/lib/i18n/client";
import { previewMembership, issueMembership, type MembershipIssueResult, type MembershipPreview } from "@/lib/actions/billing";
import { loadMembershipPlayer } from "@/lib/actions/player-directory";
import type { MembershipFormPlayer, MembershipFormSeason, MembershipFormType } from "@/lib/data/player-billing";
import { defaultFirstDueMonth, monthLabel, parseAmount, payersPayload, scheduleDisplay, type PayerFormKind, type PayerFormRow } from "@/lib/billing/player-billing";
import { newRequestId } from "@/lib/billing/request-id";
import { PlayerSearch } from "./player-search";

export type MembershipFormDefaults = { installmentCount: number; dueDay: number; firstInstallmentMonth: number; currency: string };

const PAYER_KINDS: PayerFormKind[] = ["family", "guardian", "other_parent", "sponsor", "other"];


/**
 * Club membership (season fee) form: season, player (directory search; a
 * new player only when not found), agreed fee (default from a membership
 * type), payers with fixed or percent shares, instalments → Preview (server:
 * membership_preview, exact per-payer and per-month amounts, months without
 * an instalment shown) → Confirm and issue (membership_issue). The request
 * id is created once per form open, so a double click or a retry never
 * issues twice. Team assignment stays on the team screens.
 */
export function MembershipForm({ seasons, types, defaults, initialPlayer, initialSeasonId, canIssue, canCreatePlayer }: {
  seasons: MembershipFormSeason[]; types: MembershipFormType[]; defaults: MembershipFormDefaults; initialPlayer: MembershipFormPlayer | null;
  initialSeasonId: string | null; canIssue: boolean; canCreatePlayer: boolean;
}) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const id = React.useId();
  const [requestId] = React.useState(newRequestId);
  const firstSeason = seasons.find((s) => s.id === initialSeasonId) ?? seasons.find((s) => s.isCurrent) ?? seasons[0] ?? null;
  const [seasonId, setSeasonId] = React.useState(firstSeason?.id ?? "");
  const season = seasons.find((s) => s.id === seasonId) ?? null;
  const [player, setPlayer] = React.useState<MembershipFormPlayer | null>(initialPlayer);
  const [typeId, setTypeId] = React.useState("");
  const [fee, setFee] = React.useState("");
  const [sponsored, setSponsored] = React.useState(false);
  const [sponsoredNotes, setSponsoredNotes] = React.useState("");
  const [count, setCount] = React.useState(String(defaults.installmentCount));
  const [firstMonth, setFirstMonth] = React.useState(() => (firstSeason ? defaultFirstDueMonth(firstSeason.startsOn, defaults.firstInstallmentMonth).slice(0, 7) : ""));
  const [dueDay, setDueDay] = React.useState(String(defaults.dueDay));
  const [payers, setPayers] = React.useState<PayerFormRow[]>([{ kind: "family", profileId: null, name: "", email: "", shareKind: "percent", shareValue: "100" }]);
  const [preview, setPreview] = React.useState<MembershipPreview | null>(null);
  const [result, setResult] = React.useState<MembershipIssueResult | null>(null);
  const [busy, setBusy] = React.useState<null | "preview" | "issue" | "player">(null);
  const [error, setError] = React.useState<string | null>(null);
  const currency = defaults.currency;
  const existingId = player && seasonId ? player.existing[seasonId] ?? null : null;
  const locked = !!result;

  // Any change invalidates the preview (the issue must match what was previewed).
  const touch = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPreview(null); setError(null); };

  function changeSeason(v: string) {
    touch(setSeasonId)(v);
    const s = seasons.find((x) => x.id === v);
    if (s) setFirstMonth(defaultFirstDueMonth(s.startsOn, defaults.firstInstallmentMonth).slice(0, 7));
  }
  function changeType(v: string) {
    touch(setTypeId)(v);
    const ty = types.find((x) => x.id === v);
    if (ty) setFee(String(ty.price));
  }
  async function choosePlayer(athleteId: string) {
    setBusy("player");
    setError(null);
    const res = await loadMembershipPlayer(athleteId);
    setBusy(null);
    if (!res.ok) return setError(res.error);
    setPlayer(res.data);
    setPreview(null);
    setPayers([{ kind: "family", profileId: null, name: "", email: "", shareKind: "percent", shareValue: "100" }]);
  }
  function setPayer(i: number, patch: Partial<PayerFormRow>) {
    setPayers((rows) => rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
    setPreview(null);
    setError(null);
  }

  function input() {
    const agreed = parseAmount(fee);
    return {
      athleteId: player?.id ?? "", seasonId, agreedFee: agreed != null && Number.isFinite(agreed) ? agreed : -1, currency,
      installmentCount: Number(count) || defaults.installmentCount, firstDueMonth: firstMonth ? `${firstMonth}-01` : null,
      dueDay: Number(dueDay) || defaults.dueDay, sponsored, sponsoredNotes: sponsoredNotes || null,
      payers: (agreed ?? 0) > 0 ? payersPayload(payers, player?.familyId ?? null) : [],
    };
  }

  async function runPreview(e: React.FormEvent) {
    e.preventDefault();
    if (!player) return setError(t("playerBilling.form.choosePlayerFirst"));
    if ((parseAmount(fee) ?? -1) < 0 || Number.isNaN(parseAmount(fee))) return setError(t("billing.errors.INVALID_AMOUNT"));
    setBusy("preview");
    setError(null);
    const res = await previewMembership(input());
    setBusy(null);
    if (!res.ok) return setError(res.error);
    setPreview(res.data ?? null);
  }

  async function issue() {
    if (!preview || busy) return;
    setBusy("issue");
    setError(null);
    const res = await issueMembership({ ...input(), requestId });
    setBusy(null);
    if (!res.ok) return setError(res.error);
    setResult(res.data ?? null);
    router.refresh();
  }

  const display = preview ? scheduleDisplay({
    payers: preview.payers.map((p) => ({ index: p.index, name: p.name, kind: p.kind, amount: p.amount, schedule: p.schedule })),
    monthsWithoutInstallment: preview.months_without_installment, agreedFee: preview.agreed_fee, currency: preview.currency,
  }) : null;
  const money = (n: number) => f.money(n, preview?.currency ?? currency);
  const kindLabel = (k: string) => t.dynamic(`playerBilling.payerKinds.${k}`, undefined, k);

  if (result) {
    return (
      <div className="space-y-4" role="status">
        <p className="flex items-center gap-2 text-sm font-medium text-success"><CheckCircle2 className="h-4 w-4" aria-hidden /> {result.replayed ? t("playerBilling.form.alreadyIssued") : t("billing.membership.issued")}</p>
        <ul className="divide-y divide-border-soft rounded-md border border-border">
          {result.invoices.map((i) => (
            <li key={i.payer_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span>{kindLabel(i.payer_kind)}</span>
              <span className="flex items-center gap-2">
                <span className="tnum">{money(i.amount)}</span>
                {i.invoice_id && <Link href={`/admin/invoices/${i.invoice_id}`} className="tnum font-medium text-brand-primary hover:underline">{i.number}</Link>}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Link href={`/admin/memberships/${result.membership_id}`}><Button size="sm">{t("playerBilling.form.openMembership")}</Button></Link>
          <Link href={`/admin/athletes/${result.athlete_id}?tab=membership`}><Button size="sm" variant="secondary">{t("playerBilling.form.openPlayer")}</Button></Link>
          <Link href="/admin/memberships/new"><Button size="sm" variant="ghost">{t("playerBilling.form.another")}</Button></Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={runPreview} className="space-y-6" aria-busy={busy !== null}>
      <section className="space-y-3">
        <h2 className="font-display text-lg text-text">{t("playerBilling.form.playerSection")}</h2>
        {player ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface-elevated px-3 py-2">
            <span>
              <Link href={`/admin/athletes/${player.id}`} className="font-medium text-text hover:text-brand-primary">{player.name}</Link>
              <span className="ml-2 text-xs text-text-muted">{[player.dob ? f.date(player.dob) : null, player.familyName].filter(Boolean).join(" · ")}</span>
            </span>
            {!locked && <Button type="button" size="sm" variant="ghost" onClick={() => { setPlayer(null); setPreview(null); }}>{t("playerBilling.form.changePlayer")}</Button>}
          </div>
        ) : (
          <PlayerSearch onSelect={(h) => choosePlayer(h.id)} allowCreate={canCreatePlayer} autoFocus />
        )}
        {player && (
          <p className="text-xs text-text-muted">
            {player.teams.length ? t("playerBilling.form.teamsLine", { teams: player.teams.map((x) => x.name).join(", ") }) : t("playerBilling.membership.noTeams")}
            {" "}{t("playerBilling.membership.teamsNeverChangeFee")}
          </p>
        )}
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor={`${id}-season`}>{t("playerBilling.form.season")}</Label>
          <Select id={`${id}-season`} value={seasonId} onChange={(e) => changeSeason(e.target.value)} required>
            {seasons.length === 0 && <option value="">{t("playerBilling.form.noSeasons")}</option>}
            {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}{s.isCurrent ? ` (${t("playerBilling.membership.currentSeason")})` : ""}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor={`${id}-type`}>{t("playerBilling.form.type")}</Label>
          <Select id={`${id}-type`} value={typeId} onChange={(e) => changeType(e.target.value)}>
            <option value="">{t("playerBilling.form.typeNone")}</option>
            {types.map((ty) => <option key={ty.id} value={ty.id}>{ty.name} · {f.money(ty.price, ty.currency ?? currency)}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor={`${id}-fee`}>{t("playerBilling.form.agreedFee", { currency })}</Label>
          <Input id={`${id}-fee`} inputMode="decimal" required value={fee} onChange={(e) => touch(setFee)(e.target.value)} />
        </div>
        <div className="sm:col-span-3">
          <label className="inline-flex items-center gap-2 text-sm text-text">
            <input type="checkbox" checked={sponsored} onChange={(e) => touch(setSponsored)(e.target.checked)} /> {t("playerBilling.form.sponsored")}
          </label>
          {sponsored && (
            <Textarea className="mt-2" aria-label={t("playerBilling.form.sponsoredNotes")} placeholder={t("playerBilling.form.sponsoredNotes")} maxLength={1000}
              value={sponsoredNotes} onChange={(e) => touch(setSponsoredNotes)(e.target.value)} />
          )}
        </div>
      </section>

      {existingId && (
        <p role="alert" className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning">
          <AlertTriangle className="h-4 w-4" aria-hidden /> {t("billing.errors.ALREADY_MEMBER")}{" "}
          <Link href={`/admin/memberships/${existingId}`} className="underline">{t("playerBilling.membership.open")}</Link>
        </p>
      )}

      <section className="space-y-3">
        <h2 className="font-display text-lg text-text">{t("playerBilling.form.payersSection")}</h2>
        <p className="text-xs text-text-muted">{t("playerBilling.form.payersHint")}</p>
        {payers.map((p, i) => (
          <fieldset key={i} className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-6">
            <legend className="sr-only">{t("playerBilling.form.payerN", { n: i + 1 })}</legend>
            <div className="sm:col-span-2">
              <Label htmlFor={`${id}-pk-${i}`}>{t("playerBilling.form.payerKind")}</Label>
              <Select id={`${id}-pk-${i}`} value={p.kind} onChange={(e) => setPayer(i, { kind: e.target.value as PayerFormKind, profileId: null })}>
                {PAYER_KINDS.map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}
              </Select>
            </div>
            {p.kind === "family" && (
              <p className="self-end text-sm text-text-secondary sm:col-span-2">{player?.familyContact.name ?? player?.familyName ?? "—"}</p>
            )}
            {p.kind === "guardian" && (
              <div className="sm:col-span-2">
                <Label htmlFor={`${id}-pg-${i}`}>{t("playerBilling.form.guardian")}</Label>
                <Select id={`${id}-pg-${i}`} value={p.profileId ?? ""} required onChange={(e) => setPayer(i, { profileId: e.target.value || null })}>
                  <option value="">{player?.guardians.length ? t("playerBilling.form.chooseGuardian") : t("playerBilling.form.noGuardians")}</option>
                  {(player?.guardians ?? []).map((g) => <option key={g.profileId} value={g.profileId}>{g.name ?? g.email ?? "—"}</option>)}
                </Select>
              </div>
            )}
            {(p.kind === "other_parent" || p.kind === "sponsor" || p.kind === "other") && (
              <>
                <div>
                  <Label htmlFor={`${id}-pn-${i}`}>{t("playerBilling.form.payerName")}</Label>
                  <Input id={`${id}-pn-${i}`} required maxLength={140} value={p.name} onChange={(e) => setPayer(i, { name: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor={`${id}-pe-${i}`}>{t("playerBilling.form.payerEmail")}</Label>
                  <Input id={`${id}-pe-${i}`} type="email" maxLength={200} value={p.email} onChange={(e) => setPayer(i, { email: e.target.value })} />
                </div>
              </>
            )}
            <div>
              <Label htmlFor={`${id}-sk-${i}`}>{t("playerBilling.form.shareKind")}</Label>
              <Select id={`${id}-sk-${i}`} value={p.shareKind} onChange={(e) => setPayer(i, { shareKind: e.target.value as "fixed" | "percent" })}>
                <option value="percent">{t("playerBilling.form.sharePercent")}</option>
                <option value="fixed">{t("playerBilling.form.shareFixed", { currency })}</option>
              </Select>
            </div>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Label htmlFor={`${id}-sv-${i}`}>{t("playerBilling.form.shareValue")}</Label>
                <Input id={`${id}-sv-${i}`} inputMode="decimal" required value={p.shareValue} onChange={(e) => setPayer(i, { shareValue: e.target.value })} />
              </div>
              {payers.length > 1 && (
                <Button type="button" size="sm" variant="ghost" aria-label={t("playerBilling.form.removePayer")} onClick={() => { setPayers((rows) => rows.filter((_, k) => k !== i)); setPreview(null); }}>
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              )}
            </div>
          </fieldset>
        ))}
        {payers.length < 10 && (
          <Button type="button" size="sm" variant="ghost" onClick={() => { setPayers((rows) => [...rows, { kind: "guardian", profileId: null, name: "", email: "", shareKind: "percent", shareValue: "" }]); setPreview(null); }}>
            <Plus className="h-4 w-4" aria-hidden /> {t("playerBilling.form.addPayer")}
          </Button>
        )}
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor={`${id}-count`}>{t("playerBilling.form.installments")}</Label>
          <Input id={`${id}-count`} type="number" min={1} max={24} required value={count} onChange={(e) => touch(setCount)(e.target.value)} />
        </div>
        <div>
          <Label htmlFor={`${id}-first`}>{t("playerBilling.form.firstMonth")}</Label>
          <Input id={`${id}-first`} type="month" required value={firstMonth} onChange={(e) => touch(setFirstMonth)(e.target.value)} />
        </div>
        <div>
          <Label htmlFor={`${id}-day`}>{t("playerBilling.form.dueDay")}</Label>
          <Input id={`${id}-day`} type="number" min={1} max={31} required value={dueDay} onChange={(e) => touch(setDueDay)(e.target.value)} />
        </div>
        {season && <p className="text-xs text-text-muted sm:col-span-3">{t("playerBilling.form.seasonRange", { range: f.dateRange(season.startsOn, season.endsOn) })}</p>}
      </section>

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="secondary" disabled={busy !== null || !player || !!existingId}>{busy === "preview" ? t("common.loading") : t("playerBilling.form.preview")}</Button>
      </div>

      {preview && display && (
        <section className="space-y-3 rounded-md border border-border p-4" aria-live="polite">
          <h2 className="font-display text-lg text-text">{t("playerBilling.form.previewTitle")}</h2>
          <p className="text-sm text-text-secondary">
            {t("playerBilling.form.previewSummary", { player: player?.name ?? "", season: preview.season.name, fee: money(preview.agreed_fee), count: preview.installment_count })}
          </p>
          <ul className="flex flex-wrap gap-2">
            {preview.payers.map((p) => (
              <li key={p.index}><Badge tone="neutral">{p.name ?? kindLabel(p.kind)} · {money(p.amount)}</Badge></li>
            ))}
          </ul>
          <div className="overflow-x-auto rounded-md border border-border-soft">
            <table className="w-full min-w-[28rem] text-sm">
              <thead className="bg-surface-elevated text-left text-[11px] uppercase tracking-[0.1em] text-text-muted">
                <tr>
                  <th className="px-3 py-1.5">{t("playerBilling.form.month")}</th>
                  <th className="px-3 py-1.5">{t("playerBilling.common.dueOn")}</th>
                  {preview.payers.map((p) => <th key={p.index} className="px-3 py-1.5 text-right">{p.name ?? kindLabel(p.kind)}</th>)}
                  {preview.payers.length > 1 && <th className="px-3 py-1.5 text-right">{t("playerBilling.form.total")}</th>}
                </tr>
              </thead>
              <tbody>
                {display.rows.map((r) => (
                  <tr key={r.month} className={`border-t border-border-soft ${r.noInstallment ? "bg-surface-elevated/50" : ""}`}>
                    <td className="px-3 py-1.5 text-text">{monthLabel(r.month, f.locale)}</td>
                    <td className="px-3 py-1.5 tnum text-text-secondary">{r.noInstallment ? <span className="text-text-muted">{t("playerBilling.form.noInstallment")}</span> : r.dueOn ? f.date(r.dueOn) : ""}</td>
                    {r.perPayer.map((x, k) => <td key={k} className="px-3 py-1.5 text-right tnum text-text">{r.noInstallment ? "—" : money(x)}</td>)}
                    {preview.payers.length > 1 && <td className="px-3 py-1.5 text-right tnum text-text">{r.noInstallment ? "—" : money(r.total)}</td>}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border font-medium">
                  <td className="px-3 py-1.5 text-text" colSpan={2}>{t("playerBilling.form.total")}</td>
                  {display.payerTotals.map((x, k) => <td key={k} className="px-3 py-1.5 text-right tnum text-text">{money(x)}</td>)}
                  {preview.payers.length > 1 && <td className="px-3 py-1.5 text-right tnum text-text">{money(display.total)}</td>}
                </tr>
              </tfoot>
            </table>
          </div>
          {preview.months_without_installment.length > 0 && (
            <p className="text-xs text-text-muted">
              {t("playerBilling.form.monthsWithout", { months: preview.months_without_installment.map((m) => monthLabel(m, f.locale)).join(", ") })}
            </p>
          )}
          <p className={`text-xs ${display.balanced ? "text-success" : "text-danger"}`}>
            {display.balanced ? t("playerBilling.form.balanced", { fee: money(preview.agreed_fee) }) : t("playerBilling.form.unbalanced")}
          </p>
          {canIssue ? (
            <Button type="button" onClick={issue} disabled={busy !== null || !display.balanced || !!preview.existing_membership_id}>
              {busy === "issue" ? t("common.saving") : t("playerBilling.form.confirmIssue")}
            </Button>
          ) : <p className="text-sm text-text-muted">{t("playerBilling.form.adminOnlyIssue")}</p>}
        </section>
      )}
    </form>
  );
}
