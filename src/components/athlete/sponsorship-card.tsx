"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { HandHeart } from "lucide-react";
import { Button, Card, CardHeader, CardTitle, CardBody } from "@/components/ui";
import { useFormat, useT } from "@/lib/i18n/client";
import { applySponsorshipOpenInvoices, previewSponsorshipOpenInvoices, type SponsorshipInvoiceChange } from "@/lib/actions/sponsorship";
import { isSponsored, type Sponsorship } from "@/lib/people/sponsorship";
import { SponsorshipBadge } from "./sponsorship-badge";
import { SponsorshipFields } from "./sponsorship-form";

function Item({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-md bg-surface-elevated px-3 py-2">
      <div className="text-xs text-text-muted">{label}</div>
      <div className="text-sm text-text">{value?.trim() ? value : "—"}</div>
    </div>
  );
}

/** Coverage / sponsor / validity lines shared by the card and the family page. */
export function useSponsorshipText() {
  const t = useT();
  const f = useFormat();
  return {
    coverage: (s: Sponsorship) =>
      t("sponsorship.coverage", {
        percent: f.number(s.percent ?? 0),
        scopes: s.scope.map((x) => t(`sponsorship.scopes.${x}`)).join(", "),
      }),
    window: (s: Sponsorship) =>
      s.from && s.until ? t("sponsorship.window", { from: f.date(s.from), until: f.date(s.until) })
        : s.from ? t("sponsorship.openEnded", { from: f.date(s.from) })
        : s.until ? t("sponsorship.window", { from: "…", until: f.date(s.until) })
        : t("sponsorship.always"),
    sponsor: (s: Sponsorship) => s.sponsorName ?? t("sponsorship.sponsorClub"),
  };
}

/**
 * Sponsorship on the admin player profile (admin / finance). Shows the terms
 * and offers "Apply sponsorship to open invoices" (preview first, then a
 * confirmation dialog). Editing lives on the edit page (`editHref`).
 */
export function SponsorshipCard({ athleteId, sponsorship, editHref, inlineEdit = false }: {
  athleteId: string; sponsorship: Sponsorship; editHref?: string; inlineEdit?: boolean;
}) {
  const t = useT();
  const f = useFormat();
  const text = useSponsorshipText();
  const on = isSponsored(sponsorship);
  const [editing, setEditing] = React.useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><HandHeart className="h-4 w-4" aria-hidden /> {t("sponsorship.title")}</CardTitle>
        {editHref && <Link href={editHref} className="text-xs text-brand-primary hover:underline">{t("sponsorship.edit")}</Link>}
        {!editHref && inlineEdit && (
          <button type="button" onClick={() => setEditing((v) => !v)} className="text-xs text-brand-primary hover:underline">{t("sponsorship.edit")}</button>
        )}
      </CardHeader>
      <CardBody className="space-y-3">
        {editing ? (
          <SponsorshipFields target={{ athleteId }} initial={sponsorship} onDone={() => setEditing(false)} />
        ) : on ? (
          <>
            <SponsorshipBadge kind={sponsorship.kind} percent={sponsorship.percent} />
            <div className="grid grid-cols-1 gap-2">
              <Item label={t("sponsorship.sponsorName")} value={text.sponsor(sponsorship)} />
              <Item label={t("sponsorship.scope")} value={text.coverage(sponsorship)} />
              <Item label={t("sponsorship.from")} value={text.window(sponsorship)} />
              {sponsorship.reason && <Item label={t("sponsorship.reason")} value={sponsorship.reason} />}
            </div>
            {sponsorship.sponsoredAt && <p className="text-xs text-text-muted">{t("sponsorship.since", { date: f.date(sponsorship.sponsoredAt) })}</p>}
            <ApplySponsorshipButton athleteId={athleteId} />
          </>
        ) : (
          <p className="text-sm text-text-muted">{t("sponsorship.none")}</p>
        )}
      </CardBody>
    </Card>
  );
}

/** Admin action with a confirmation dialog listing what will change. */
export function ApplySponsorshipButton({ athleteId }: { athleteId: string }) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const ref = React.useRef<HTMLDialogElement>(null);
  const id = React.useId();
  const [loading, setLoading] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [changes, setChanges] = React.useState<SponsorshipInvoiceChange[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<string | null>(null);

  async function open() {
    setError(null);
    setDone(null);
    setChanges(null);
    setLoading(true);
    ref.current?.showModal();
    const res = await previewSponsorshipOpenInvoices(athleteId);
    setLoading(false);
    if (res.ok) setChanges(res.data ?? []);
    else setError(res.error);
  }

  async function confirm() {
    setPending(true);
    setError(null);
    const res = await applySponsorshipOpenInvoices(athleteId);
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    ref.current?.close();
    setDone(res.message ?? null);
    router.refresh();
  }

  return (
    <>
      <Button type="button" size="sm" variant="secondary" onClick={open}>{t("sponsorship.apply.button")}</Button>
      {done && <p role="status" className="text-sm text-success">{done}</p>}
      <dialog ref={ref} aria-labelledby={`${id}-title`}
        className="w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-black/60">
        <div className="space-y-4 p-5">
          <h2 id={`${id}-title`} className="font-display text-lg text-ink">{t("sponsorship.apply.title")}</h2>
          {loading && <p className="text-sm text-ink-2">{t("sponsorship.apply.loading")}</p>}
          {changes && changes.length === 0 && <p className="text-sm text-ink-2">{t("sponsorship.apply.none")}</p>}
          {changes && changes.length > 0 && (
            <>
              <p className="text-sm text-ink-2">{t("sponsorship.apply.intro")}</p>
              <ul className="divide-y divide-border-soft rounded-md border border-border-soft">
                {changes.map((c) => (
                  <li key={c.invoiceId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="tnum text-text">{c.number}</span>
                    <span className="text-xs text-text-muted">{c.method === "cancellation" ? t("sponsorship.apply.cancel") : t("sponsorship.apply.credit")}</span>
                    <span className="tnum text-text">{f.money(c.amount, c.currency)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => ref.current?.close()} disabled={pending}>{t("sponsorship.apply.back")}</Button>
            <Button type="button" size="sm" onClick={confirm} disabled={pending || loading || !changes || changes.length === 0}>
              {pending ? t("sponsorship.apply.working") : t("sponsorship.apply.confirm")}
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}

/** Family page shortcut: a button opening the sponsorship editor for every child. */
export function FamilySponsorshipButton({ familyId }: { familyId: string }) {
  const t = useT();
  const ref = React.useRef<HTMLDialogElement>(null);
  const id = React.useId();
  return (
    <>
      <Button type="button" size="sm" variant="secondary" onClick={() => ref.current?.showModal()}>
        <HandHeart className="h-4 w-4" aria-hidden /> {t("sponsorship.family.button")}
      </Button>
      <dialog ref={ref} aria-labelledby={`${id}-title`}
        className="w-[min(36rem,calc(100vw-2rem))] rounded-lg border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-black/60">
        <div className="space-y-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 id={`${id}-title`} className="font-display text-lg text-ink">{t("sponsorship.family.title")}</h2>
            <Button type="button" variant="ghost" size="sm" onClick={() => ref.current?.close()}>{t("sponsorship.family.close")}</Button>
          </div>
          <p className="text-sm text-ink-2">{t("sponsorship.family.hint")}</p>
          <SponsorshipFields target={{ familyId }} />
        </div>
      </dialog>
    </>
  );
}
