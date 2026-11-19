"use client";

import * as React from "react";
import { Tag } from "lucide-react";
import { Button, FieldHint, Input, Label } from "@/components/ui";
import { useFormat, useT } from "@/lib/i18n/client";
import { previewTrainingPrice, type TrainingPricePreview } from "@/lib/actions/training-discounts";

/**
 * Promo code field + price preview for a training package / single session
 * (shared discounts: early bird, promo code). The chosen code goes with the
 * purchase; the database applies and locks it.
 */
export function TrainingPromo({ serviceId, packageId, start, athleteId, clubSlug, code, onCode }: {
  serviceId: string; packageId: string | null; start?: string | null; athleteId?: string | null; clubSlug?: string;
  code: string; onCode: (code: string) => void;
}) {
  const t = useT();
  const f = useFormat();
  const [draft, setDraft] = React.useState(code);
  const [preview, setPreview] = React.useState<TrainingPricePreview | null>(null);
  const id = React.useId();

  const load = React.useCallback(async (promoCode: string) => {
    const res = await previewTrainingPrice({ serviceId, packageId, promoCode, start: start ?? null, athleteId: athleteId ?? null, clubSlug });
    setPreview(res);
    onCode(res.ok && res.promo === "applied" ? promoCode : "");
  }, [serviceId, packageId, start, athleteId, clubSlug, onCode]);

  React.useEffect(() => { void load(""); setDraft(""); }, [serviceId, packageId, start, athleteId, load]);

  return (
    <div className="space-y-2">
      {preview?.ok && preview.discountTotal > 0 && (
        <p className="text-sm">
          <span className="text-text-muted line-through">{f.money(preview.listPrice, preview.currency)}</span>{" "}
          <span className="font-medium">{f.money(preview.amount, preview.currency)}</span>{" "}
          <span className="text-success">{t("shop.training.discount", { amount: f.money(preview.discountTotal, preview.currency) })}</span>
        </p>
      )}
      <div>
        <Label htmlFor={id}>{t("shop.checkout.promo")}</Label>
        <div className="flex max-w-sm gap-2">
          <Input id={id} value={draft} maxLength={40} className="font-mono" onChange={(e) => setDraft(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ""))} />
          <Button type="button" size="sm" variant="secondary" disabled={!draft.trim()} onClick={() => load(draft.trim())}>
            <Tag className="h-4 w-4" aria-hidden /> {t("shop.checkout.apply")}
          </Button>
        </div>
        {preview?.promo === "applied" && <FieldHint>{t("shop.checkout.promoApplied")}</FieldHint>}
        {preview?.promo === "rejected" && <FieldHint error>{preview.promoMessage}</FieldHint>}
      </div>
    </div>
  );
}
