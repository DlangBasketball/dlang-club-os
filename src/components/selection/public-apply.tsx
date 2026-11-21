"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { Button, Card, CardBody, CardHeader, CardTitle, Input, Select } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { submitSelectionPublic } from "@/lib/actions/selection";
import type { DivisionRule } from "@/lib/selection/rules";
import type { PublicConsent } from "@/lib/data/public-registration";
import { Field, Notice, PackagePicker, type PackageOption } from "./shared";
import { ApplicationExtras, DivisionChooser, type ExtrasState } from "./family";

/**
 * Public application (anyone, including players of other clubs): parent,
 * player, division (suggested from the date of birth), package, consents and
 * an account (sign-in link or password) for the parent app.
 */
export function PublicSelectionApply({ slug, divisions, packages, consents, currency, today }: {
  slug: string; divisions: DivisionRule[]; packages: PackageOption[]; consents: PublicConsent[]; currency: string; today: string;
}) {
  const t = useT();
  const router = useRouter();
  const [parent, setParent] = React.useState({ name: "", email: "", phone: "", emergencyName: "", emergencyPhone: "" });
  const [child, setChild] = React.useState({ firstName: "", lastName: "", dob: "", gender: "" });
  const [divisionId, setDivisionId] = React.useState("");
  const [packageId, setPackageId] = React.useState(packages[0]?.id ?? "");
  const [extras, setExtras] = React.useState<ExtrasState>({ currentClub: "", position: "", notes: "", videoUrl: "" });
  const [accepted, setAccepted] = React.useState<Set<string>>(new Set());
  const [account, setAccount] = React.useState<{ mode: "none" | "password" | "link"; password: string }>({ mode: "link", password: "" });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const setP = (k: keyof typeof parent) => (e: React.ChangeEvent<HTMLInputElement>) => setParent((s) => ({ ...s, [k]: e.target.value }));
  const setC = (k: keyof typeof child) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setChild((s) => ({ ...s, [k]: e.target.value }));
  const toggle = (k: string) => setAccepted((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const validDob = /^\d{4}-\d{2}-\d{2}$/.test(child.dob) ? child.dob : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null); setErrors({});
    const res = await submitSelectionPublic({
      programSlug: slug, parent, child, divisionId, packageId, consents: Array.from(accepted),
      account: account.mode === "password" ? { mode: "password", password: account.password } : { mode: account.mode }, ...extras,
    });
    if (!res.ok) {
      setBusy(false);
      setErrors(res.errors ?? {});
      setMsg({ tone: "err", text: res.error });
      return;
    }
    router.push(res.data?.redirect ?? `/register/${slug}/success?applied=1`);
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <Card>
        <CardHeader><CardTitle>{t("selection.public.parentTitle")}</CardTitle></CardHeader>
        <CardBody className="grid gap-3 sm:grid-cols-2">
          <Field label={t("selection.public.parentName")} htmlFor="p-name" error={errors["parent.name"]}><Input id="p-name" autoComplete="name" value={parent.name} onChange={setP("name")} required /></Field>
          <Field label={t("selection.public.email")} htmlFor="p-email" error={errors["parent.email"]}><Input id="p-email" type="email" autoComplete="email" value={parent.email} onChange={setP("email")} required /></Field>
          <Field label={t("selection.public.phone")} htmlFor="p-phone" error={errors["parent.phone"]}><Input id="p-phone" type="tel" autoComplete="tel" value={parent.phone} onChange={setP("phone")} required /></Field>
          <span className="hidden sm:block" />
          <Field label={t("selection.public.emergencyName")} htmlFor="p-en" error={errors["parent.emergencyName"]}><Input id="p-en" value={parent.emergencyName} onChange={setP("emergencyName")} required /></Field>
          <Field label={t("selection.public.emergencyPhone")} htmlFor="p-ep" error={errors["parent.emergencyPhone"]}><Input id="p-ep" type="tel" value={parent.emergencyPhone} onChange={setP("emergencyPhone")} required /></Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("selection.public.playerTitle")}</CardTitle></CardHeader>
        <CardBody className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("selection.public.firstName")} htmlFor="c-first" error={errors["child.firstName"]}><Input id="c-first" value={child.firstName} onChange={setC("firstName")} required /></Field>
            <Field label={t("selection.public.lastName")} htmlFor="c-last" error={errors["child.lastName"]}><Input id="c-last" value={child.lastName} onChange={setC("lastName")} required /></Field>
            <Field label={t("selection.public.dob")} htmlFor="c-dob" error={errors["child.dob"]}><Input id="c-dob" type="date" max={today} value={child.dob} onChange={setC("dob")} required /></Field>
            <Field label={t("selection.public.gender")} htmlFor="c-gender">
              <Select id="c-gender" value={child.gender} onChange={setC("gender")}>
                <option value="">{t("selection.public.genderUnset")}</option>
                <option value="female">{t("selection.public.genders.female")}</option>
                <option value="male">{t("selection.public.genders.male")}</option>
                <option value="other">{t("selection.public.genders.other")}</option>
              </Select>
            </Field>
          </div>
          <DivisionChooser key={validDob ?? "none"} divisions={divisions} dob={validDob} value={divisionId} onChange={setDivisionId} today={today} />
          <ApplicationExtras value={extras} onChange={setExtras} errors={errors} askClub />
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("selection.apply.package")}</CardTitle></CardHeader>
        <CardBody className="space-y-2">
          <PackagePicker name="pub-pkg" packages={packages} value={packageId} onChange={setPackageId} currency={currency} />
          <p className="text-xs text-text-muted">{t("selection.public.payAfterApproval")}</p>
        </CardBody>
      </Card>

      {consents.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t("selection.public.agreements")}</CardTitle></CardHeader>
          <CardBody className="space-y-2">
            {consents.map((c) => (
              <label key={c.key} className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={accepted.has(c.key)} onChange={() => toggle(c.key)} />
                <span>{t.dynamic(`registration.consents.${c.key}`, undefined, c.title)}{c.required && <span className="text-danger"> *</span>}</span>
              </label>
            ))}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>{t("selection.public.accountTitle")}</CardTitle></CardHeader>
        <CardBody className="space-y-2 text-sm">
          <p className="text-xs text-text-muted">{t("selection.public.accountHint")}</p>
          {(["link", "password", "none"] as const).map((m) => (
            <label key={m} className="flex items-center gap-2">
              <input type="radio" name="acc" checked={account.mode === m} onChange={() => setAccount((a) => ({ ...a, mode: m }))} />
              {t(`selection.public.account.${m}`)}
            </label>
          ))}
          {account.mode === "password" && (
            <Field label={t("selection.public.password")} htmlFor="acc-pw" hint={t("selection.public.passwordHint")}>
              <Input id="acc-pw" type="password" autoComplete="new-password" minLength={8} value={account.password} onChange={(e) => setAccount((a) => ({ ...a, password: e.target.value }))} />
            </Field>
          )}
        </CardBody>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" disabled={busy || !packageId}><ShieldCheck className="h-4 w-4" /> {t("selection.public.submit")}</Button>
        <Notice msg={msg} />
      </div>
    </form>
  );
}
