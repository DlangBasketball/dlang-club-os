"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ImagePlus, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, FieldHint, Input, Label } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { removeCardBrandAsset, saveCardBrand, uploadCardBrandAsset } from "@/lib/actions/member-card-brands";
import type { CardBrandRow } from "@/lib/member-cards/courtside-data";
import { PHOTO_INPUT_ACCEPT } from "@/lib/people/validation";
import { PREVIEW_NAMES } from "@/lib/member-cards/courtside";
import { CourtsideCard, type CourtsideLabels } from "./courtside-card";

type Msg = { ok: boolean; text: string } | null;

/**
 * Settings -> Billing entities -> Member card brands. One brand per billing
 * entity: name on the card, optional second line ("Powered by ..."), logo
 * and optional watermark (defaults to the logo). A brand without a logo shows
 * a text-only lockup. Live preview with a synthetic name.
 */
export function MemberCardBrandsEditor({ rows, canEdit }: { rows: CardBrandRow[]; canEdit: boolean }) {
  const t = useT();
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>{t("memberCard.brands.title")}</CardTitle>
        <Link href="/admin/settings/billing-entities/card-preview" className="text-sm text-brand-primary hover:underline">
          {t("memberCard.brands.previewLink")}
        </Link>
      </CardHeader>
      <CardBody className="space-y-6">
        <p className="text-sm text-text-muted">{t("memberCard.brands.intro")}</p>
        {rows.length === 0 && <p className="text-sm text-text-muted">{t("memberCard.brands.noEntities")}</p>}
        {rows.map((r) => <BrandRow key={r.entityId} row={r} canEdit={canEdit} />)}
      </CardBody>
    </Card>
  );
}

function BrandRow({ row, canEdit }: { row: CardBrandRow; canEdit: boolean }) {
  const t = useT();
  const router = useRouter();
  const [displayName, setDisplayName] = React.useState(row.displayName ?? row.entityName);
  const [subtitle, setSubtitle] = React.useState(row.subtitle ?? "");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<Msg>(null);
  const [pending, setPending] = React.useState<{ kind: "logo" | "watermark"; file: File; url: string } | null>(null);

  React.useEffect(() => () => { if (pending) URL.revokeObjectURL(pending.url); }, [pending]);

  const logoUrl = pending?.kind === "logo" ? pending.url : row.logoUrl;
  const watermarkUrl = pending?.kind === "watermark" ? pending.url : row.watermarkUrl;

  const labels: CourtsideLabels = {
    member: t("memberCard.memberLabel"), tapToEnlarge: t("memberCard.tapToEnlarge"), enlargeQr: t("memberCard.enlargeQr"),
    inactive: t("memberCard.inactive"), photoAlt: "", cardAria: t("memberCard.brands.previewAria", { brand: displayName || row.entityName }),
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy("save"); setMsg(null);
    const res = await saveCardBrand({ entityId: row.entityId, displayName, subtitle });
    setBusy(null);
    setMsg(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
    if (res.ok) router.refresh();
  }

  function pick(kind: "logo" | "watermark") {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      setMsg(null);
      if (pending) URL.revokeObjectURL(pending.url);
      setPending({ kind, file, url: URL.createObjectURL(file) });
    };
  }

  async function upload() {
    if (!pending) return;
    setBusy("upload"); setMsg(null);
    const fd = new FormData();
    fd.append("entityId", row.entityId);
    fd.append("kind", pending.kind);
    fd.append("file", pending.file);
    const res = await uploadCardBrandAsset(fd);
    setBusy(null);
    if (res.ok) { setPending(null); setMsg({ ok: true, text: res.message }); router.refresh(); }
    else setMsg({ ok: false, text: res.error });
  }

  async function remove(kind: "logo" | "watermark") {
    setBusy(`rm-${kind}`); setMsg(null);
    const res = await removeCardBrandAsset(row.entityId, kind);
    setBusy(null);
    setMsg(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
    if (res.ok) router.refresh();
  }

  const id = `brand-${row.entityId}`;
  return (
    <section aria-labelledby={`${id}-h`} className="grid gap-5 border-t border-border pt-5 first-of-type:border-0 first-of-type:pt-0 lg:grid-cols-[1fr_minmax(0,22rem)]">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id={`${id}-h`} className="font-medium text-text">{row.entityName}</h3>
          {row.isDefault && <Badge tone="accent">{t("memberCard.brands.default")}</Badge>}
          {!row.isActive && <Badge>{t("memberCard.brands.inactive")}</Badge>}
        </div>
        <form className="space-y-3" onSubmit={save}>
          <div>
            <Label htmlFor={`${id}-name`}>{t("memberCard.brands.displayName")}</Label>
            <Input id={`${id}-name`} value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={60} disabled={!canEdit} />
          </div>
          <div>
            <Label htmlFor={`${id}-sub`}>{t("memberCard.brands.subtitle")}</Label>
            <Input id={`${id}-sub`} value={subtitle} onChange={(e) => setSubtitle(e.target.value)} maxLength={80} disabled={!canEdit}
              placeholder={t("memberCard.brands.subtitlePlaceholder")} />
          </div>
          {canEdit && <Button type="submit" size="sm" loading={busy === "save"} disabled={!!busy}>{t("common.save")}</Button>}
        </form>

        {canEdit && (
          <div className="space-y-3">
            {(["logo", "watermark"] as const).map((kind) => {
              const has = kind === "logo" ? !!row.logoPath : !!row.watermarkPath;
              return (
                <div key={kind} className="space-y-1.5">
                  <Label htmlFor={`${id}-${kind}`}>{t(kind === "logo" ? "memberCard.brands.logo" : "memberCard.brands.watermark")}</Label>
                  <div className="flex flex-wrap items-center gap-2">
                    <input id={`${id}-${kind}`} type="file" accept={PHOTO_INPUT_ACCEPT} className="sr-only" onChange={pick(kind)} disabled={!!busy} />
                    <label htmlFor={`${id}-${kind}`}
                      className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] hover:border-brand-primary">
                      <ImagePlus className="h-4 w-4" aria-hidden /> {has ? t("memberCard.brands.replaceImage") : t("memberCard.brands.chooseImage")}
                    </label>
                    {has && (
                      <Button type="button" size="sm" variant="ghost" onClick={() => remove(kind)} loading={busy === `rm-${kind}`} disabled={!!busy}>
                        <Trash2 className="h-4 w-4" aria-hidden /> {t("memberCard.brands.removeImage")}
                      </Button>
                    )}
                  </div>
                  <FieldHint>{t(kind === "logo" ? "memberCard.brands.logoHint" : "memberCard.brands.watermarkHint")}</FieldHint>
                </div>
              );
            })}
            {pending && (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-elevated p-2 text-sm">
                <span className="text-text-muted">{t("memberCard.brands.pendingPreview")}</span>
                <Button type="button" size="sm" onClick={upload} loading={busy === "upload"} disabled={!!busy && busy !== "upload"}>
                  {t("memberCard.brands.upload")}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setPending(null)} disabled={busy === "upload"}>{t("common.cancel")}</Button>
              </div>
            )}
          </div>
        )}
        {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}
      </div>
      <div>
        <p className="mb-2 text-xs uppercase tracking-wider text-text-muted">{t("memberCard.brands.preview")}</p>
        <CourtsideCard
          brand={{ entityId: row.entityId, displayName: displayName || row.entityName, subtitle: subtitle || null, logoUrl, watermarkUrl,
                   sources: [], isFallback: false }}
          name={PREVIEW_NAMES[0]} photoUrl={null} qrSvg={null} cardActive={false}
          labels={{ ...labels, inactive: t("memberCard.brands.sampleQr") }} />
      </div>
    </section>
  );
}
