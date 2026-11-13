"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Button, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { useT } from "@/lib/i18n/client";
import { startChannel, startDirectThread } from "@/lib/actions/messaging";
import { broadcastShareText, whatsappShareUrl } from "@/lib/messaging/whatsapp";
import type { ContactRow } from "@/lib/messaging/db";
import type { ScopeOption } from "@/lib/messaging/data";

const OFFICE = "office";

/** Start a direct thread: a person from the caller's contact list, or (guardians) the club office. */
export function NewThreadForm({
  contacts, families, canWriteOffice, isStaff, presetTarget,
}: {
  contacts: ContactRow[];
  families: { id: string; name: string }[];
  canWriteOffice: boolean;
  isStaff: boolean;
  presetTarget?: string | null;
}) {
  const t = useT();
  const router = useRouter();
  const [target, setTarget] = React.useState<string>(presetTarget ?? (canWriteOffice ? OFFICE : ""));
  const [familyId, setFamilyId] = React.useState<string>("");
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const [sensitive, setSensitive] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const chosen = contacts.find((c) => `${c.profile_id}|${c.family_id ?? ""}` === target);
  const groups: { key: "office" | "coach" | "guardian"; label: string }[] = [
    { key: "office", label: t("messaging.compose.groupOffice") },
    { key: "coach", label: t("messaging.compose.groupCoaches") },
    { key: "guardian", label: t("messaging.compose.groupFamilies") },
  ];

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const res = await startDirectThread({
      targetId: target === OFFICE ? null : chosen?.profile_id ?? null,
      familyId: chosen?.family_id ?? (familyId || null),
      subject,
      body,
      sensitive: isStaff ? sensitive : true,
    });
    setBusy(false);
    if (!res.ok) return setErr(res.error);
    if (res.data) router.push(res.data.path as never);
  }

  return (
    <Card>
      <CardHeader><CardTitle>{t("messaging.compose.newMessage")}</CardTitle></CardHeader>
      <CardBody>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label htmlFor="nt-to">{t("messaging.compose.to")}</Label>
            <Select id="nt-to" value={target} onChange={(e) => setTarget(e.target.value)} required>
              <option value="" disabled>{t("messaging.compose.choose")}</option>
              {canWriteOffice && <option value={OFFICE}>{t("messaging.compose.clubOffice")}</option>}
              {groups.map((g) => {
                const list = contacts.filter((c) => c.kind === g.key);
                if (!list.length) return null;
                return (
                  <optgroup key={g.key} label={g.label}>
                    {list.map((c) => (
                      <option key={`${c.profile_id}|${c.family_id ?? ""}`} value={`${c.profile_id}|${c.family_id ?? ""}`}>
                        {c.display_name ?? t("messaging.common.someone")}{c.family_name ? ` · ${c.family_name}` : ""}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </Select>
            <FieldHint>{t("messaging.compose.toHint")}</FieldHint>
          </div>
          {!isStaff && families.length > 1 && (
            <div>
              <Label htmlFor="nt-family">{t("messaging.compose.family")}</Label>
              <Select id="nt-family" value={familyId} onChange={(e) => setFamilyId(e.target.value)}>
                <option value="">{t("messaging.compose.anyFamily")}</option>
                {families.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </Select>
            </div>
          )}
          <div>
            <Label htmlFor="nt-subject">{t("messaging.compose.subject")}</Label>
            <Input id="nt-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={160} />
          </div>
          <div>
            <Label htmlFor="nt-body">{t("messaging.compose.message")}</Label>
            <Textarea id="nt-body" value={body} onChange={(e) => setBody(e.target.value)} rows={5} maxLength={5000} required />
          </div>
          {isStaff && (
            <label className="flex items-start gap-2 text-sm text-text-secondary">
              <input type="checkbox" checked={sensitive} onChange={(e) => setSensitive(e.target.checked)} className="mt-1" />
              <span>{t("messaging.compose.sensitive")}<span className="block text-xs text-text-muted">{t("messaging.compose.sensitiveHint")}</span></span>
            </label>
          )}
          <p className="text-xs text-text-muted">{t("messaging.safeguarding.oversight")} {t("messaging.safeguarding.privacy")}</p>
          {err && <p role="alert" className="text-sm text-danger">{err}</p>}
          <Button type="submit" loading={busy} disabled={busy || !target}>
            <Send className="h-4 w-4" /> {t("messaging.thread.send")}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

/** Staff: open a team / programme / camp-edition channel (parents read, reply per settings). */
export function NewChannelForm({ scopes }: { scopes: ScopeOption[] }) {
  const t = useT();
  const router = useRouter();
  const [scope, setScope] = React.useState(scopes[0] ? `${scopes[0].scope}|${scopes[0].id}` : "");
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const [allowReplies, setAllowReplies] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  if (!scopes.length) return <p className="text-sm text-text-muted">{t("messaging.compose.noScopes")}</p>;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const [s, id] = scope.split("|");
    setBusy(true);
    setErr(null);
    const res = await startChannel({ scope: s as ScopeOption["scope"], scopeId: id, subject, body, allowReplies, sensitive: false });
    setBusy(false);
    if (!res.ok) return setErr(res.error);
    if (res.data) router.push(res.data.path as never);
  }

  const share = body.trim() ? whatsappShareUrl(broadcastShareText({ title: subject, body })) : null;

  return (
    <Card>
      <CardHeader><CardTitle>{t("messaging.compose.newChannel")}</CardTitle></CardHeader>
      <CardBody>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label htmlFor="nc-scope">{t("messaging.compose.audience")}</Label>
            <Select id="nc-scope" value={scope} onChange={(e) => setScope(e.target.value)} required>
              {(["team", "program", "camp_edition"] as const).map((k) => {
                const list = scopes.filter((s) => s.scope === k);
                if (!list.length) return null;
                return (
                  <optgroup key={k} label={t(`messaging.scope.${k}`)}>
                    {list.map((s) => <option key={s.id} value={`${s.scope}|${s.id}`}>{s.label}</option>)}
                  </optgroup>
                );
              })}
            </Select>
          </div>
          <div>
            <Label htmlFor="nc-subject">{t("messaging.compose.subject")}</Label>
            <Input id="nc-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={160} required />
          </div>
          <div>
            <Label htmlFor="nc-body">{t("messaging.compose.message")}</Label>
            <Textarea id="nc-body" value={body} onChange={(e) => setBody(e.target.value)} rows={5} maxLength={5000} required />
          </div>
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input type="checkbox" checked={allowReplies} onChange={(e) => setAllowReplies(e.target.checked)} />
            {t("messaging.compose.allowReplies")}
          </label>
          {err && <p role="alert" className="text-sm text-danger">{err}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" loading={busy} disabled={busy || !scope}>
              <Send className="h-4 w-4" /> {t("messaging.compose.post")}
            </Button>
            {share && (
              <a href={share} target="_blank" rel="noopener noreferrer" className="text-sm text-brand-primary underline-offset-4 hover:underline">
                {t("messaging.whatsapp.share")}
              </a>
            )}
          </div>
          <p className="text-xs text-text-muted">{t("messaging.whatsapp.hint")}</p>
        </form>
      </CardBody>
    </Card>
  );
}
