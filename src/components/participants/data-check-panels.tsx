"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GitMerge, Link2, ShieldCheck } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Label, Textarea } from "@/components/ui";
import { useFormat, useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { decideSelfLink, mergeAthletes, runAthleteDataCheck } from "@/lib/actions/my-athletes";
import type { DuplicatePair, MergeCard, SelfLinkFinding } from "@/lib/participants/admin-data";

type Msg = { ok: boolean; text: string } | null;

/** "Run athlete checks": duplicates, possible self links, athletes without a guardian. */
export function AthleteDataCheckButton() {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<Msg>(null);
  async function run() {
    setBusy(true); setMsg(null);
    const res = await runAthleteDataCheck();
    setBusy(false);
    setMsg(res.ok ? { ok: true, text: res.message ?? "" } : { ok: false, text: res.error });
    if (res.ok) router.refresh();
  }
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button size="sm" variant="secondary" loading={busy} onClick={() => void run()}>
        <ShieldCheck className="h-4 w-4" aria-hidden /> {t("myAthletes.dataCheck.run")}
      </Button>
      {msg && <span role="status" className={msg.ok ? "text-xs text-success" : "text-xs text-danger"}>{msg.text}</span>}
    </span>
  );
}

function Side({ c, keep, onKeep, name }: { c: MergeCard; keep: boolean; onKeep: () => void; name: string }) {
  const t = useT();
  const f = useFormat();
  return (
    <label className={cn("block cursor-pointer space-y-1 rounded-md border p-3 text-sm transition-colors",
      keep ? "border-brand-primary bg-brand-primary-soft" : "border-border hover:border-brand-primary/50")}>
      <span className="flex items-center gap-2">
        <input type="radio" name={name} checked={keep} onChange={onKeep} className="h-4 w-4 accent-[var(--red-primary)]" />
        <Link href={`/admin/athletes/${c.id}`} className="font-medium text-text hover:text-brand-primary">{c.firstName} {c.lastName}</Link>
        {keep && <Badge tone="success">{t("myAthletes.merge.keep")}</Badge>}
      </span>
      <span className="block text-xs text-text-muted">
        {c.dob ? f.date(c.dob) : "—"} · {c.familyName ?? t("myAthletes.merge.noFamily")} · {t("myAthletes.merge.createdOn", { date: f.date(c.createdAt) })}
      </span>
      <span className="block text-xs text-text-muted">
        {t("myAthletes.merge.links", { teams: c.teams, registrations: c.registrations, invoices: c.invoices })}
        {c.hasLogin ? ` · ${t("myAthletes.merge.hasLogin")}` : ""}
      </span>
    </label>
  );
}

function PairMerge({ pair }: { pair: DuplicatePair }) {
  const t = useT();
  const router = useRouter();
  // Default: keep the older record (more history), merge the newer one into it.
  const older = pair.match.createdAt <= pair.athlete.createdAt ? pair.match : pair.athlete;
  const [keepId, setKeepId] = React.useState(older.id);
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<Msg>(null);
  const requestId = React.useRef(crypto.randomUUID());
  const dupId = keepId === pair.athlete.id ? pair.match.id : pair.athlete.id;
  async function merge() {
    if (!window.confirm(t("myAthletes.merge.confirm"))) return;
    setBusy(true); setMsg(null);
    const res = await mergeAthletes({ keepId, duplicateId: dupId, reason, requestId: requestId.current });
    setBusy(false);
    if (!res.ok) { setMsg({ ok: false, text: res.error }); requestId.current = crypto.randomUUID(); return; }
    const conflicts = res.data?.conflicts ?? [];
    setMsg({ ok: true, text: [res.message ?? "", ...conflicts.map((c) => t.dynamic(`myAthletes.merge.conflict.${c.kept}`, { table: c.table }, c.table))].filter(Boolean).join(" ") });
    router.refresh();
  }
  const name = `merge-${pair.flagId}`;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Side c={pair.athlete} keep={keepId === pair.athlete.id} onKeep={() => setKeepId(pair.athlete.id)} name={name} />
        <Side c={pair.match} keep={keepId === pair.match.id} onKeep={() => setKeepId(pair.match.id)} name={name} />
      </div>
      <p className="text-xs text-text-muted">{t("myAthletes.merge.explain")}</p>
      <div>
        <Label htmlFor={`${name}-reason`}>{t("myAthletes.merge.reason")}</Label>
        <Textarea id={`${name}-reason`} rows={1} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" loading={busy} disabled={busy} onClick={() => void merge()}>
          <GitMerge className="h-4 w-4" aria-hidden /> {t("myAthletes.merge.submit")}
        </Button>
        {msg && <span role="status" className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</span>}
      </div>
    </div>
  );
}

/** Staff merge of possible duplicates (server-side, one transaction, audited). */
export function DuplicateMergePanel({ pairs }: { pairs: DuplicatePair[] }) {
  const t = useT();
  if (!pairs.length) return null;
  return (
    <Card>
      <CardHeader><CardTitle>{t("myAthletes.merge.title")}</CardTitle></CardHeader>
      <CardBody className="space-y-5 divide-y divide-border-soft">
        {pairs.map((p) => <div key={p.flagId} className="pt-4 first:pt-0"><PairMerge pair={p} /></div>)}
      </CardBody>
    </Card>
  );
}

function SelfLinkRow({ s }: { s: SelfLinkFinding }) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const [busy, setBusy] = React.useState<"link" | "dismiss" | null>(null);
  const [msg, setMsg] = React.useState<Msg>(null);
  async function decide(decision: "link" | "dismiss") {
    setBusy(decision); setMsg(null);
    const res = await decideSelfLink({ flagId: s.flagId, decision });
    setBusy(null);
    setMsg(res.ok ? { ok: true, text: res.message ?? "" } : { ok: false, text: res.error });
    if (res.ok) router.refresh();
  }
  return (
    <div className="space-y-2">
      <p className="text-sm text-text">
        {t("myAthletes.selfLink.match", { athlete: s.athleteName, login: s.profileName ?? "—" })}
      </p>
      <p className="text-xs text-text-muted">{s.profileEmail ?? "—"} · {f.dateTime(s.createdAt)} · <Link className="text-brand-primary hover:underline" href={`/admin/athletes/${s.athleteId}`}>{t("adminAttendance.review.openRecord")}</Link></p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" loading={busy === "link"} disabled={busy !== null} onClick={() => void decide("link")}>
          <Link2 className="h-4 w-4" aria-hidden /> {t("myAthletes.selfLink.link")}
        </Button>
        <Button type="button" size="sm" variant="secondary" loading={busy === "dismiss"} disabled={busy !== null} onClick={() => void decide("dismiss")}>
          {t("myAthletes.selfLink.dismiss")}
        </Button>
      </div>
      {msg && <p role="status" className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}
    </div>
  );
}

/** Adult players that probably belong to an existing login: linked only when staff confirm. */
export function SelfLinkPanel({ findings }: { findings: SelfLinkFinding[] }) {
  const t = useT();
  if (!findings.length) return null;
  return (
    <Card>
      <CardHeader><CardTitle>{t("myAthletes.selfLink.title")}</CardTitle></CardHeader>
      <CardBody className="space-y-5 divide-y divide-border-soft">
        <p className="text-xs text-text-muted">{t("myAthletes.selfLink.explain")}</p>
        {findings.map((s) => <div key={s.flagId} className="pt-4 first:pt-0"><SelfLinkRow s={s} /></div>)}
      </CardBody>
    </Card>
  );
}
