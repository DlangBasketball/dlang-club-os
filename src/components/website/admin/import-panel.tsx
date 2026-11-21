"use client";

import * as React from "react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, FieldHint, Input, Label } from "@/components/ui";
import { Select } from "@/components/teams/fields";
import { useFormat, useT } from "@/lib/i18n/client";
import { previewWebsiteImport, runWebsiteImport } from "@/lib/actions/website-import";
import type { ImportKind, ImportPreview, ImportResult, PreviewProduct } from "@/lib/website/importers/run";
import { NEW_TEAM, gameTitle, noiseWords, suggestAppTeam } from "@/lib/website/importers/team-match";
import { Status, useRunner } from "./shared";

const KINDS: ImportKind[] = ["sportspress", "woo", "posts"];

type TeamMap = Record<string, string>; // website team source id -> app team id | NEW_TEAM | "" (not chosen)

/** Fill the app-team choice of ticked teams that have none yet (or only an automatic one) with a confident suggestion. */
function withSuggestions(preview: ImportPreview, ticked: string[], map: TeamMap, auto: Set<string>): { map: TeamMap; auto: Set<string> } {
  const tickedNames = preview.teams.filter((x) => ticked.includes(x.sourceId)).map((x) => x.name);
  const noise = noiseWords(preview.teams.map((x) => x.name), tickedNames, preview.appTeams, preview.clubName);
  const next = { ...map };
  const nextAuto = new Set(auto);
  for (const tm of preview.teams) {
    if (!ticked.includes(tm.sourceId)) continue;
    if (next[tm.sourceId] && !nextAuto.has(tm.sourceId)) continue; // the admin's (or a remembered) choice wins
    const s = suggestAppTeam(tm.name, preview.appTeams, noise);
    next[tm.sourceId] = s ?? "";
    if (s) nextAuto.add(tm.sourceId); else nextAuto.delete(tm.sourceId);
  }
  return { map: next, auto: nextAuto };
}

/** Admin -> Website -> Import: load a preview, map the club's website teams onto app teams, pick products, dry run, then import. */
export function ImportPanel({ websiteUrl }: { websiteUrl: string | null }) {
  const t = useT();
  const f = useFormat();
  const loader = useRunner();
  const runner = useRunner();
  const [kinds, setKinds] = React.useState<ImportKind[]>([...KINDS]);
  const [ourTeams, setOurTeams] = React.useState<string[]>([]);
  const [teamMap, setTeamMap] = React.useState<TeamMap>({});
  const [autoPicked, setAutoPicked] = React.useState<Set<string>>(new Set());
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [preview, setPreview] = React.useState<ImportPreview | null>(null);
  const [result, setResult] = React.useState<{ dryRun: boolean; data: ImportResult } | null>(null);
  const [stock, setStock] = React.useState(0);

  const load = (teams: string[]) =>
    loader.run(() => previewWebsiteImport({ kinds, ourTeams: teams }), (r) => {
      if (!r.ok) return;
      const p = r.data;
      // Remembered mappings: pre-tick those teams on the first load.
      const remembered = Object.fromEntries(p.teams.filter((x) => x.mappedTeamId).map((x) => [x.sourceId, x.mappedTeamId!]));
      const ticked = teams.length ? teams : Object.keys(remembered);
      const base: TeamMap = { ...remembered, ...Object.fromEntries(Object.entries(teamMap).filter(([, v]) => v)) };
      const s = withSuggestions(p, ticked, base, autoPicked);
      const before = new Set(preview?.products.map((x) => x.sourceId) ?? []);
      setSelected((cur) => new Set(p.products.filter((x) => (before.has(x.sourceId) ? cur.has(x.sourceId) : x.selected)).map((x) => x.sourceId)));
      setOurTeams(ticked);
      setTeamMap(s.map);
      setAutoPicked(s.auto);
      setPreview(p);
      setResult(null);
    });

  const toggleTeam = (id: string, on: boolean) => {
    const ticked = on ? [...ourTeams, id] : ourTeams.filter((y) => y !== id);
    setOurTeams(ticked);
    if (preview) {
      const s = withSuggestions(preview, ticked, teamMap, autoPicked);
      setTeamMap(s.map);
      setAutoPicked(s.auto);
    }
  };
  const chooseTeam = (id: string, value: string) => {
    setTeamMap((m) => ({ ...m, [id]: value }));
    setAutoPicked((a) => { const n = new Set(a); n.delete(id); return n; });
  };
  const unmapped = kinds.includes("sportspress") && ourTeams.some((id) => !teamMap[id]);

  const run = (dryRun: boolean) =>
    runner.run(() => runWebsiteImport({
      kinds, ourTeams, dryRun, defaultStock: stock,
      teamMap: Object.fromEntries(ourTeams.filter((id) => teamMap[id]).map((id) => [id, teamMap[id]!])),
      products: preview ? preview.products.filter((p) => selected.has(p.sourceId)).map((p) => p.sourceId) : undefined,
    }), (r) => {
      if (r.ok) setResult({ dryRun, data: r.data });
    });

  const appTeamName = (sourceId: string): string | null => {
    const v = teamMap[sourceId];
    if (!v || !preview) return null;
    if (v === NEW_TEAM) return preview.teams.find((x) => x.sourceId === sourceId)?.name ?? null;
    return preview.appTeams.find((x) => x.id === v)?.name ?? null;
  };

  const groups = React.useMemo(() => {
    const m = new Map<string, PreviewProduct[]>();
    for (const p of preview?.products ?? []) {
      const k = p.category ?? "";
      m.set(k, [...(m.get(k) ?? []), p]);
    }
    return [...m.entries()].sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
  }, [preview]);
  if (!websiteUrl) return <p className="text-sm text-text-muted">{t("website.import.errors.noWebsiteUrl")}</p>;

  const setMany = (ids: string[], on: boolean) =>
    setSelected((cur) => { const n = new Set(cur); for (const id of ids) (on ? n.add(id) : n.delete(id)); return n; });

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
                <ul className="space-y-2">
                  {preview.teams.map((tm) => {
                    const ticked = ourTeams.includes(tm.sourceId);
                    const value = teamMap[tm.sourceId] ?? "";
                    return (
                      <li key={tm.sourceId} className="grid gap-2 sm:grid-cols-2 sm:items-center">
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={ticked} onChange={(e) => toggleTeam(tm.sourceId, e.target.checked)} />
                          {tm.name}
                          {tm.existing && <Badge tone="info">{t("website.import.existing")}</Badge>}
                        </label>
                        {ticked && (
                          <div className="space-y-1">
                            <Select aria-label={`${t("website.import.appTeam")}: ${tm.name}`} value={value} required
                              aria-invalid={!value || undefined} onChange={(e) => chooseTeam(tm.sourceId, e.target.value)}>
                              <option value="">{t("website.import.chooseTeam")}</option>
                              {preview.appTeams.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                              <option value={NEW_TEAM}>{t("website.import.createNewTeam")}</option>
                            </Select>
                            {!value && <p className="text-xs text-danger">{t("website.import.noSuggestion")}</p>}
                            {value && autoPicked.has(tm.sourceId) && <p className="text-xs text-text-muted">{t("website.import.suggested")}</p>}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <Button type="button" variant="secondary" size="sm" onClick={() => load(ourTeams)} loading={loader.busy}>{t("website.import.refresh")}</Button>
              </section>
            )}

            {preview.events.length > 0 && (
              <section className="space-y-2">
                <h3 className="font-semibold">{t("website.import.events", { count: preview.events.length })}</h3>
                <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded border border-border text-sm">
                  {preview.events.slice(0, 100).map((e) => {
                    const team = appTeamName(e.ourTeamSourceId);
                    return (
                      <li key={e.sourceId} className="flex flex-wrap justify-between gap-2 p-2">
                        <span>{f.dateTime(e.startsAt)} · {team ? gameTitle(team, e.opponent) : `${e.title}${e.opponent ? ` (${e.opponent})` : ""}`}</span>
                        <span className="text-text-muted">{e.scoreFor !== null ? `${e.scoreFor}:${e.scoreAgainst}` : ""} {e.existing ? t("website.import.existing") : t("website.import.new")}</span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
            {preview.skipped.events > 0 && <FieldHint>{t("website.import.skippedEvents", { count: preview.skipped.events })}</FieldHint>}

            {preview.products.length > 0 && (
              <section className="space-y-2">
                <h3 className="font-semibold">{t("website.import.products", { count: preview.products.length })}</h3>
                <FieldHint>{t("website.import.productsHint")}</FieldHint>
                <p className="text-xs text-text-muted">{t("website.import.productsSelected", { selected: selected.size, total: preview.products.length })}</p>
                <div className="max-h-96 space-y-3 overflow-y-auto rounded border border-border p-2 text-sm">
                  {groups.map(([cat, items]) => {
                    const label = cat || t("website.import.uncategorised");
                    const all = items.every((p) => selected.has(p.sourceId));
                    return (
                      <fieldset key={cat || "_"} className="space-y-1">
                        <legend className="w-full">
                          <label className="flex items-center gap-2 font-medium">
                            <input type="checkbox" checked={all} aria-label={t("website.import.selectCategory", { category: label })}
                              onChange={(e) => setMany(items.map((p) => p.sourceId), e.target.checked)} />
                            {label}
                          </label>
                        </legend>
                        <ul className="divide-y divide-border pl-6">
                          {items.map((p) => (
                            <li key={p.sourceId} className="flex flex-wrap items-center justify-between gap-2 py-1">
                              <label className="flex items-center gap-2">
                                <input type="checkbox" checked={selected.has(p.sourceId)} onChange={(e) => setMany([p.sourceId], e.target.checked)} />
                                {p.name}{p.variants.length > 1 ? ` · ${t("website.import.variants", { count: p.variants.length })}` : ""}
                              </label>
                              <span className="text-text-muted">{f.money(p.price, p.currency)} {p.existing ? t("website.import.existing") : t("website.import.new")}</span>
                            </li>
                          ))}
                        </ul>
                      </fieldset>
                    );
                  })}
                </div>
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
              <Button type="button" variant="secondary" onClick={() => run(true)} loading={runner.busy} disabled={unmapped}>{t("website.import.dryRun")}</Button>
              <Button type="button" onClick={() => { if (window.confirm(t("website.import.confirm"))) run(false); }} loading={runner.busy} disabled={unmapped}>{t("website.import.run")}</Button>
              {unmapped && <span className="text-xs text-danger">{t("website.import.errors.teamUnmapped")}</span>}
              <Status msg={runner.msg} />
            </div>
            {result && (
              <div className="rounded border border-border p-3 text-sm">
                <p className="font-medium">{result.dryRun ? t("website.import.dryRunResult") : t("website.import.result")}</p>
                <ul className="mt-1 space-y-0.5 text-text-muted">
                  {(["teams", "events", "products", "posts"] as const).map((k) => (
                    <li key={k}>{t.dynamic(`website.import.resultKinds.${k}`, {}, k)}: {t("website.import.counts", { created: result.data[k].created, updated: result.data[k].updated, failed: result.data[k].failed })}</li>
                  ))}
                  {result.data.productsSkipped > 0 && <li>{t("website.import.productsSkipped", { count: result.data.productsSkipped })}</li>}
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
