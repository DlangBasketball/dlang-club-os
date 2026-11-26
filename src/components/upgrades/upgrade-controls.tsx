"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import {
  cancelPlanChange,
  changePlan,
  setAddon,
  setShowLockedModules,
  startFeatureTrial,
  type UpgradeResult,
} from "@/lib/upgrades/actions";

/**
 * Client controls of the upgrade flow. Every label that depends on money or
 * dates is formatted on the server (org currency + locale) and passed in, so
 * this file only renders and calls the server actions, which re-check
 * everything (admin role, price, dependencies) on the server.
 */

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<UpgradeResult | null>(null);
  const run = React.useCallback(
    async (fn: () => Promise<UpgradeResult>) => {
      setBusy(true);
      setResult(null);
      try {
        const r = await fn();
        setResult(r);
        if (r.ok) router.refresh();
        return r;
      } finally {
        setBusy(false);
      }
    },
    [router],
  );
  return { busy, result, run, setResult };
}

function ResultLine({ result }: { result: UpgradeResult | null }) {
  if (!result) return null;
  return (
    <p role={result.ok ? "status" : "alert"} className={cn("text-xs", result.ok ? "text-success" : "text-danger")}>
      {result.ok ? result.message : result.error}
    </p>
  );
}

function Dialog({
  title,
  children,
  onClose,
  busy,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  busy: boolean;
}) {
  const id = React.useId();
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" onClick={() => !busy && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className="w-full max-w-md space-y-3 rounded-t-2xl border border-border bg-surface p-5 text-left shadow-lg sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id={id} className="font-display text-lg font-medium text-text">
          {title}
        </h3>
        {children}
      </div>
    </div>
  );
}

export type AddonDialogLabels = {
  name: string;
  /** "CHF 29" — monthly price in the club's currency. */
  price: string;
  /** Estimated prorated charge today, or null (not billed through Stripe). */
  proration: string | null;
  /** End of the billing period, formatted. */
  periodEnd: string;
};

/**
 * The add-on switch: ON opens a confirmation with price and proration (or a
 * request to the platform team when online billing is not set up); OFF
 * schedules removal at the end of the period.
 */
export function AddonToggle({
  featureKey,
  checked,
  pending,
  billable,
  labels,
  disabled,
}: {
  featureKey: string;
  checked: boolean;
  pending: boolean;
  billable: boolean;
  labels: AddonDialogLabels;
  disabled?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = React.useState<null | "on" | "off">(null);
  const { busy, result, run } = useAction();
  const on = checked || pending;

  const confirm = async () => {
    const r = await run(() => setAddon(featureKey, open === "on"));
    if (r.ok) setOpen(null);
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={t("upgrades.page.toggleLabel", { feature: labels.name })}
        disabled={disabled || busy}
        onClick={() => setOpen(on ? "off" : "on")}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-150 focus-visible:outline-none focus-visible:shadow-focus disabled:opacity-50",
          on ? "border-brand-primary bg-brand-primary" : "border-border bg-surface-elevated",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "inline-block h-4 w-4 rounded-full bg-text shadow-sm transition-transform duration-150",
            on ? "translate-x-6 bg-on-brand" : "translate-x-1",
          )}
        />
      </button>
      {!open && <ResultLine result={result} />}
      {open === "on" && (
        <Dialog title={t("upgrades.dialog.addTitle", { feature: labels.name })} onClose={() => setOpen(null)} busy={busy}>
          {billable ? (
            <>
              <p className="text-sm text-text-muted">{t("upgrades.dialog.addBody", { price: labels.price })}</p>
              {labels.proration && <p className="text-sm text-text-muted">{t("upgrades.dialog.proration", { amount: labels.proration })}</p>}
            </>
          ) : (
            <>
              <p className="text-sm text-text-muted">{t("upgrades.dialog.addBody", { price: labels.price })}</p>
              <p className="text-sm text-text-muted">{t("upgrades.dialog.requestBody")}</p>
            </>
          )}
          <p className="text-xs text-text-muted">{t("upgrades.gate.priceNote")}</p>
          <ResultLine result={result} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => setOpen(null)}>
              {t("upgrades.dialog.cancel")}
            </Button>
            <Button onClick={confirm} loading={busy} disabled={busy}>
              {busy
                ? t("upgrades.dialog.working")
                : billable
                  ? t("upgrades.dialog.confirmAdd", { price: labels.price })
                  : t("upgrades.dialog.confirmRequest")}
            </Button>
          </div>
        </Dialog>
      )}
      {open === "off" && (
        <Dialog title={t("upgrades.dialog.removeTitle", { feature: labels.name })} onClose={() => setOpen(null)} busy={busy}>
          <p className="text-sm text-text-muted">
            {pending ? t("upgrades.dialog.removeBodyPending") : t("upgrades.dialog.removeBody", { date: labels.periodEnd })}
          </p>
          <ResultLine result={result} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => setOpen(null)}>
              {t("upgrades.dialog.cancel")}
            </Button>
            <Button variant="danger" onClick={confirm} loading={busy} disabled={busy}>
              {busy ? t("upgrades.dialog.working") : t("upgrades.dialog.confirmRemove")}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

/** "Start 14-day trial" (admins). */
export function TrialButton({ featureKey, label, size = "sm" }: { featureKey: string; label: string; size?: "sm" | "md" }) {
  const { busy, result, run } = useAction();
  return (
    <div className="flex flex-col items-start gap-1">
      <Button variant="secondary" size={size} loading={busy} disabled={busy} onClick={() => run(() => startFeatureTrial(featureKey))}>
        {label}
      </Button>
      <ResultLine result={result} />
    </div>
  );
}

/** "Add to plan" on the upsell screen: the same confirmation as the toggle. */
export function AddButton({
  featureKey,
  billable,
  labels,
  label,
}: {
  featureKey: string;
  billable: boolean;
  labels: AddonDialogLabels;
  label: string;
}) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const { busy, result, run } = useAction();
  const confirm = async () => {
    const r = await run(() => setAddon(featureKey, true));
    if (r.ok) setOpen(false);
  };
  return (
    <div className="flex flex-col items-start gap-1">
      <Button onClick={() => setOpen(true)}>{label}</Button>
      {!open && <ResultLine result={result} />}
      {open && (
        <Dialog title={t("upgrades.dialog.addTitle", { feature: labels.name })} onClose={() => setOpen(false)} busy={busy}>
          <p className="text-sm text-text-muted">{t("upgrades.dialog.addBody", { price: labels.price })}</p>
          {billable
            ? labels.proration && <p className="text-sm text-text-muted">{t("upgrades.dialog.proration", { amount: labels.proration })}</p>
            : <p className="text-sm text-text-muted">{t("upgrades.dialog.requestBody")}</p>}
          <p className="text-xs text-text-muted">{t("upgrades.gate.priceNote")}</p>
          <ResultLine result={result} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
              {t("upgrades.dialog.cancel")}
            </Button>
            <Button onClick={confirm} loading={busy} disabled={busy}>
              {busy ? t("upgrades.dialog.working") : billable ? t("upgrades.dialog.confirmAdd", { price: labels.price }) : t("upgrades.dialog.confirmRequest")}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

export type PlanChoice = {
  code: string;
  name: string;
  price: string | null;
  current: boolean;
  custom: boolean;
  direction: "upgrade" | "downgrade" | "same";
  /** How the switch happens for this club. */
  mode: "stripe" | "trial" | "manual";
  lose: string[];
  gain: string[];
};

/** Plan picker with a preview of what locks / unlocks before confirming. */
export function PlanSwitcher({
  plans,
  periodEnd,
  canChange,
  salesHref,
}: {
  plans: PlanChoice[];
  periodEnd: string;
  canChange: boolean;
  salesHref: string;
}) {
  const t = useT();
  const [target, setTarget] = React.useState<PlanChoice | null>(null);
  const { busy, result, run } = useAction();
  const confirm = async () => {
    if (!target) return;
    const r = await run(() => changePlan(target.code));
    if (r.ok) setTarget(null);
  };
  const body = (p: PlanChoice) => {
    if (p.mode === "trial") return t("upgrades.dialog.trialBody");
    if (p.mode === "manual") return t("upgrades.dialog.manualBody");
    return p.direction === "upgrade"
      ? t("upgrades.dialog.upgradeBody", { price: p.price ?? "" })
      : t("upgrades.dialog.downgradeBody", { date: periodEnd });
  };
  return (
    <div className="space-y-2">
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {plans.map((p) => (
          <li
            key={p.code}
            className={cn(
              "flex flex-col gap-2 rounded-md border p-4",
              p.current ? "border-brand-primary bg-brand-primary-soft" : "border-border bg-surface",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-display text-lg font-medium text-text">{p.name}</span>
              {p.current && <span className="text-xs font-medium text-brand-primary">{t("upgrades.page.currentBadge")}</span>}
            </div>
            {p.price && <span className="text-sm text-text-muted">{t("upgrades.page.perMonth", { price: p.price })}</span>}
            {!p.current && canChange && (
              p.custom ? (
                <a href={salesHref} className="text-sm text-brand-primary underline-offset-4 hover:underline">
                  {t("upgrades.page.contactSales")}
                </a>
              ) : (
                <Button size="sm" variant={p.direction === "upgrade" ? "primary" : "secondary"} onClick={() => setTarget(p)}>
                  {t("upgrades.page.switchTo", { plan: p.name })}
                </Button>
              )
            )}
          </li>
        ))}
      </ul>
      {!target && <ResultLine result={result} />}
      {target && (
        <Dialog
          title={target.direction === "upgrade" ? t("upgrades.dialog.upgradeTitle", { plan: target.name }) : t("upgrades.dialog.downgradeTitle", { plan: target.name })}
          onClose={() => setTarget(null)}
          busy={busy}
        >
          <p className="text-sm text-text-muted">{body(target)}</p>
          {target.lose.length > 0 ? (
            <div className="text-sm">
              <p className="font-medium text-warning">{t("upgrades.dialog.lose")}</p>
              <ul className="mt-1 list-disc pl-5 text-text-muted">
                {target.lose.map((n) => <li key={n}>{n}</li>)}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-text-muted">{t("upgrades.dialog.nothingLost")}</p>
          )}
          {target.gain.length > 0 && (
            <div className="text-sm">
              <p className="font-medium text-success">{t("upgrades.dialog.gain")}</p>
              <ul className="mt-1 list-disc pl-5 text-text-muted">
                {target.gain.map((n) => <li key={n}>{n}</li>)}
              </ul>
            </div>
          )}
          <ResultLine result={result} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => setTarget(null)}>
              {t("upgrades.dialog.cancel")}
            </Button>
            <Button onClick={confirm} loading={busy} disabled={busy}>
              {busy ? t("upgrades.dialog.working") : t("upgrades.dialog.confirm")}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

export function WithdrawPlanChange() {
  const t = useT();
  const { busy, result, run } = useAction();
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="ghost" loading={busy} disabled={busy} onClick={() => run(() => cancelPlanChange())}>
        {t("upgrades.page.withdraw")}
      </Button>
      <ResultLine result={result} />
    </span>
  );
}

export function ShowLockedToggle({ initial, disabled }: { initial: boolean; disabled?: boolean }) {
  const t = useT();
  const [on, setOn] = React.useState(initial);
  const { busy, result, run } = useAction();
  return (
    <div className="flex items-start gap-3">
      <input
        id="upgrades-show-locked"
        type="checkbox"
        className="mt-1 h-4 w-4 accent-brand-primary"
        checked={on}
        disabled={disabled || busy}
        onChange={async (e) => {
          const next = e.target.checked;
          setOn(next);
          const r = await run(() => setShowLockedModules(next));
          if (!r.ok) setOn(!next);
        }}
      />
      <label htmlFor="upgrades-show-locked" className="text-sm">
        <span className="text-text">{t("upgrades.page.showLocked")}</span>
        <span className="block text-xs text-text-muted">{t("upgrades.page.showLockedHint")}</span>
        <ResultLine result={result} />
      </label>
    </div>
  );
}
