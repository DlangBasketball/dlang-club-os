"use client";

import * as React from "react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, FieldHint, Input, Label } from "@/components/ui";
import { useFormat, useT } from "@/lib/i18n/client";
import { previewWebsiteImport, runWebsiteImport } from "@/lib/actions/website-import";
import type { ImportKind, ImportPreview, ImportResult } from "@/lib/website/importers/run";
import { Status, useRunner } from "./shared";

const KINDS: ImportKind[] = ["sportspress", "woo", "posts"];

/** Admin -> Website -> Import: load a preview from the club's website, pick the club's own teams, dry run, then import. */
export function ImportPanel({ websiteUrl }: { websiteUrl: string | null }) {
  const t = useT();
  const f = useFormat();
  const loader = useRunner();
  const runner = useRunner();
  const [kinds, setKinds] = React.useState<ImportKind[]>([...KINDS]);
  const [ourTeams, setOurTeams] = React.useState<string[]>([]);
  const [preview, setPreview] = React.useState<ImportPreview | null>(null);
  const [result, setResult] = React.useState<{ dryRun: boolean; data: ImportResult } | null>(null);
  const [stock, setStock] = React.useState(0);

  if (!websiteUrl) return <p className="text-sm text-text-muted">{t("website.import.errors.noWebsiteUrl")}</p>;

  const load = (teams: string[]) =>
    loader.run(() => previewWebsiteImport({ kinds, ourTeams: teams }), (r) => {
      if (r.ok) setPreview(r.data);
      setResult(null);
    });
  const run = (dryRun: boolean) =>
    runner.run(() => runWebsiteImport({ kinds, ourTeams, dryRun, defaultStock: stock }), (r) => {
      if (r.ok) setResult({ dryRun, data: r.data });
    });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("website.import.title")}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <p className="text-sm text-text-muted">{t("website.import.intro", { url: websiteUrl })}</p>
          <div className="flex flex-wrap gap-4">
            {KINDS.map((k) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={kinds.includes(k)} onChange={(e) => setKinds((x) => (e.target.checked ? [...x, k] : x.filter((y) => y !== k)))} />
                {t.dynamic(`website.import.kinds.${k}`, {}, k)}
              </label>
            ))}
          </div>
          <p className="text-xs text-text-muted">{t("website.import.privacy")}</p>
          <div className="flex items-center gap-3">
            <Button type="button" onClick={() => load(ourTeams)} loading={loader.busy} disabled={!kinds.length}>{t("website.import.load")}</Button>
            <Status msg={loader.msg} />
          </div>
        </CardBody>
      </Card>

      {preview && (
        <Card>
          <CardHeader>
            <CardTitle>{t("website.import.preview")}</CardTitle>
          </CardHeader>
          <CardBody className="space-y-6">
            {Object.entries(preview.errors).map(([k, code]) => (
              <p key={k} role="alert" className="rounded border border-danger/40 bg-danger-soft p-2 text-sm text-danger">
                {t.dynamic(`website.import.kinds.${k}`, {}, k)}: {t.dynamic(`website.import.errors.${code}`, {}, String(code))}
              </p>
            ))}

            {preview.teams.length > 0 && (
              <section className="space-y-2">
                <h3 className="font-semibold">{t("website.import.teams")}</h3>
                <FieldHint>{t("website.import.teamsHint")}</FieldHint>
                <ul className="grid gap-1 sm:grid-cols-2">
                  {preview.teams.map((tm) => (
                    <li key={tm.sourceId}>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={ourTeams.includes(tm.sourceId)} onChange={(e) => setOurTeams((x) => (e.target.checked ? [...x, tm.sourceId] : x.filter((y) => y !== tm.sourceId)))} />
                        {tm.name}
                        {tm.existing && <Badge tone="info">{t("website.import.existing")}</Badge>}
                      </label>
                    </li>
                  ))}
                </ul>
                <Button type="button" variant="secondary" size="sm" onClick={() => load(ourTeams)} loading={loader.busy}>{t("website.import.refresh")}</Button>
              </section>
            )}

            {preview.events.length > 0 && (
              <section className="space-y-2">
                <h3 className="font-semibold">{t("website.import.events", { count: preview.events.length })}</h3>
                <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded border border-border text-sm">
                  {preview.events.slice(0, 100).map((e) => (
                    <li key={e.sourceId} className="flex flex-wrap justify-between gap-2 p-2">
                      <span>{f.dateTime(e.startsAt)} · {e.title}{e.opponent ? ` (${e.opponent})` : ""}</span>
                      <span className="text-text-muted">{e.scoreFor !== null ? `${e.scoreFor}:${e.scoreAgainst}` : ""} {e.existing ? t("website.import.existing") : t("website.import.new")}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {preview.skipped.events > 0 && <FieldHint>{t("website.import.skippedEvents", { count: preview.skipped.events })}</FieldHint>}

            {preview.products.length > 0 && (
              <section className="space-y-2">
                <h3 className="font-semibold">{t("website.import.products", { count: preview.products.length })}</h3>
                <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded border border-border text-sm">
                  {preview.products.map((p) => (
                    <li key={p.sourceId} className="flex flex-wrap justify-between gap-2 p-2">
                      <span>{p.name}{p.variants.length > 1 ? ` · ${t("website.import.variants", { count: p.variants.length })}` : ""}</span>
                      <span className="text-text-muted">{f.money(p.price, p.currency)} {p.existing ? t("website.import.existing") : t("website.import.new")}</span>
                    </li>
                  ))}
                </ul>
                <div className="max-w-xs">
                  <Label htmlFor="imp-stock">{t("website.import.defaultStock")}</Label>
                  <Input id="imp-stock" type="number" min={0} max={999} value={stock} onChange={(e) => setStock(Number(e.target.value) || 0)} />
                  <FieldHint>{t("website.import.defaultStockHint")}</FieldHint>
                </div>
              </section>
            )}

            {preview.posts.length > 0 && (
              <section className="space-y-2">
                <h3 className="font-semibold">{t("website.import.posts", { count: preview.posts.length })}</h3>
                <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded border border-border text-sm">
                  {preview.posts.map((p) => (
                    <li key={p.sourceId} className="flex flex-wrap justify-between gap-2 p-2">
                      <span>{p.title}</span>
                      <span className="text-text-muted">{f.date(p.publishedAt)} {p.existing ? t("website.import.existing") : t("website.import.new")}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
              <Button type="button" variant="secondary" onClick={() => run(true)} loading={runner.busy}>{t("website.import.dryRun")}</Button>
              <Button type="button" onClick={() => { if (window.confirm(t("website.import.confirm"))) run(false); }} loading={runner.busy}>{t("website.import.run")}</Button>
              <Status msg={runner.msg} />
            </div>
            {result && (
              <div className="rounded border border-border p-3 text-sm">
                <p className="font-medium">{result.dryRun ? t("website.import.dryRunResult") : t("website.import.result")}</p>
                <ul className="mt-1 space-y-0.5 text-text-muted">
                  {(["teams", "events", "products", "posts"] as const).map((k) => (
                    <li key={k}>{t.dynamic(`website.import.resultKinds.${k}`, {}, k)}: {t("website.import.counts", { created: result.data[k].created, updated: result.data[k].updated, failed: result.data[k].failed })}</li>
                  ))}
                  {!result.dryRun && <li>{t("website.import.images", { count: result.data.images })}</li>}
                </ul>
              </div>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
