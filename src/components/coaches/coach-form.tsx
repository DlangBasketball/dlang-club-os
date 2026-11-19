"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, Textarea, FieldHint } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { createCoach, updateCoach } from "@/lib/actions/coaches";
import { COACH_BIO_MAX, COACH_NAME_MAX, COACH_TITLE_MAX } from "@/lib/coaches/validation";

export type CoachFormValues = {
  displayName: string;
  roleTitle: string;
  bio: string;
  isActive: boolean;
  serves: string[];
};

/** Create / edit a coach (admin). Every field of the coaches row except the login link and photo. */
export function CoachForm({
  coachId,
  initial,
  services,
}: {
  coachId?: string;
  initial?: Partial<CoachFormValues>;
  services: { slug: string; name: string }[];
}) {
  const t = useT();
  const router = useRouter();
  const [f, setF] = React.useState<CoachFormValues>({
    displayName: "",
    roleTitle: "",
    bio: "",
    isActive: true,
    serves: [],
    ...initial,
  });
  const [pending, setPending] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const set = <K extends keyof CoachFormValues>(k: K, v: CoachFormValues[K]) => setF((s) => ({ ...s, [k]: v }));
  // Keep services that are no longer offered by the club, so saving never drops them silently.
  const extraServes = f.serves.filter((s) => !services.some((o) => o.slug === s));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setMsg(null);
    const res = coachId ? await updateCoach(coachId, f) : await createCoach(f);
    setPending(false);
    if (!res.ok) return setMsg({ ok: false, text: res.error });
    if (!coachId && res.data && "id" in res.data) {
      router.push(`/admin/coaches/${res.data.id}`);
      return;
    }
    setMsg({ ok: true, text: res.message ?? t("coaches.messages.saved") });
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="c-name">{t("coaches.form.displayName")}</Label>
          <Input id="c-name" required maxLength={COACH_NAME_MAX} value={f.displayName}
            onChange={(e) => set("displayName", e.target.value)} placeholder={t("coaches.form.displayNamePlaceholder")} />
        </div>
        <div>
          <Label htmlFor="c-title">{t("coaches.form.roleTitle")}</Label>
          <Input id="c-title" maxLength={COACH_TITLE_MAX} value={f.roleTitle}
            onChange={(e) => set("roleTitle", e.target.value)} placeholder={t("coaches.form.roleTitlePlaceholder")} />
        </div>
      </div>
      <div>
        <Label htmlFor="c-bio">{t("coaches.form.bio")}</Label>
        <Textarea id="c-bio" maxLength={COACH_BIO_MAX} value={f.bio} onChange={(e) => set("bio", e.target.value)} />
        <FieldHint>{t("coaches.form.bioHint")}</FieldHint>
      </div>
      {(services.length > 0 || extraServes.length > 0) && (
        <fieldset>
          <legend className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">{t("coaches.form.serves")}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {[...services, ...extraServes.map((slug) => ({ slug, name: slug }))].map((s) => (
              <label key={s.slug} className="flex items-center gap-2 text-sm text-ink-2">
                <input type="checkbox" className="h-4 w-4 accent-[var(--red-primary)]"
                  checked={f.serves.includes(s.slug)}
                  onChange={(e) => set("serves", e.target.checked ? [...f.serves, s.slug] : f.serves.filter((x) => x !== s.slug))} />
                {s.name}
              </label>
            ))}
          </div>
          <FieldHint>{t("coaches.form.servesHint")}</FieldHint>
        </fieldset>
      )}
      <label className="flex items-center gap-2 text-sm text-ink-2">
        <input type="checkbox" checked={f.isActive} onChange={(e) => set("isActive", e.target.checked)} className="h-4 w-4 accent-[var(--red-primary)]" />
        {t("coaches.form.active")}
      </label>
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}
      <div className="flex gap-2">
        <Button type="submit" loading={pending} disabled={pending}>
          {pending ? t("coaches.form.saving") : coachId ? t("coaches.form.save") : t("coaches.form.create")}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.push(coachId ? `/admin/coaches/${coachId}` : "/admin/coaches")}>
          {t("coaches.form.cancel")}
        </Button>
      </div>
    </form>
  );
}
