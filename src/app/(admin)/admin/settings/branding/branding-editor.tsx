"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Lock, RotateCcw } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Input, Label } from "@/components/ui";
import { BrandMark } from "@/components/layout/brand-mark";
import { cn } from "@/lib/utils";
import {
  COMMON_TIMEZONES,
  DEFAULT_BRANDING,
  DEFAULT_LIGHT_COLORS,
  DEFAULT_TERMINOLOGY,
  SPORTS,
  SUPPORTED_CURRENCIES,
  SUPPORTED_LOCALES,
  TERMINOLOGY_PRESETS,
} from "@/lib/tenant/defaults";
import { brandingContrastChecks, brandingToCssVars, googleFontsHref, isHexColor, normalizeHex } from "@/lib/tenant/theme";
import { makeTerm } from "@/lib/tenant/terms";
import { TERM_KEYS, type Tenant, type TenantBranding, type TenantColors, type TermKey, type Terminology } from "@/lib/tenant/types";
import { saveTenantBranding } from "./actions";

export type PlatformInfo = {
  slug: string;
  customDomain: string | null;
  plan: string;
  status: string;
  dataRegion: string;
  rootDomain: string | null;
};

type Draft = {
  name: string;
  sport: string | null;
  branding: TenantBranding;
  terminology: Terminology;
  country: string;
  currency: string;
  defaultLocale: string;
  supportedLocales: string[];
  timezone: string;
};

const COLOR_FIELDS: { key: keyof TenantColors; label: string; hint: string }[] = [
  { key: "primary", label: "Primary", hint: "Buttons, active states" },
  { key: "primaryDark", label: "Primary (hover)", hint: "Pressed / hover" },
  { key: "accent", label: "Accent", hint: "Highlights, badges" },
  { key: "background", label: "Background", hint: "Page" },
  { key: "surface", label: "Surface", hint: "Cards, panels" },
  { key: "text", label: "Text", hint: "Body copy" },
];

const FONT_CHOICES = ["Fraunces", "Geist", "Geist Mono", "Inter", "Manrope", "DM Sans", "Poppins", "Montserrat", "Oswald", "Playfair Display", "Roboto", "Roboto Mono", "JetBrains Mono", "Source Serif 4", "Barlow", "Bebas Neue"];

const TERM_LABELS: Record<TermKey, string> = {
  organization: "Organization",
  athlete: "Participant",
  coach: "Staff / instructor",
  program: "Program",
  session: "Session",
  season: "Season / period",
  family: "Family",
  guardian: "Guardian",
};

const THEME_PRESETS: { id: string; label: string; colors: TenantColors; darkMode: boolean }[] = [
  { id: "v5", label: "Dark luxury", colors: DEFAULT_BRANDING.colors, darkMode: true },
  { id: "light", label: "Light classic", colors: { ...DEFAULT_LIGHT_COLORS }, darkMode: false },
  { id: "navy", label: "Navy & gold", colors: { primary: "#1D4ED8", primaryDark: "#1E3A8A", accent: "#B45309", background: "#F8FAFC", surface: "#FFFFFF", text: "#0F172A" }, darkMode: false },
  { id: "forest", label: "Forest night", colors: { primary: "#16A34A", primaryDark: "#166534", accent: "#EAB308", background: "#0B1210", surface: "#131D19", text: "#ECFDF5" }, darkMode: true },
];

const sel = "h-10 w-full rounded border border-line bg-surface-input px-3 text-sm text-ink";

function fromTenant(t: Tenant): Draft {
  return {
    name: t.name,
    sport: t.sport,
    branding: t.branding,
    terminology: t.terminology,
    country: t.country,
    currency: t.currency,
    defaultLocale: t.defaultLocale,
    supportedLocales: t.supportedLocales,
    timezone: t.timezone,
  };
}

export function BrandingEditor({ tenant, platform, canEdit }: { tenant: Tenant; platform: PlatformInfo; canEdit: boolean }) {
  const router = useRouter();
  const initial = React.useMemo(() => fromTenant(tenant), [tenant]);
  const [d, setD] = React.useState<Draft>(initial);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [acceptLow, setAcceptLow] = React.useState(false);

  const checks = React.useMemo(() => brandingContrastChecks(d.branding.colors), [d.branding.colors]);
  const failing = checks.filter((c) => !c.ok);
  const dirty = JSON.stringify(d) !== JSON.stringify(initial);

  const setBranding = (patch: Partial<TenantBranding>) => setD((x) => ({ ...x, branding: { ...x.branding, ...patch } }));
  const setColor = (k: keyof TenantColors, v: string) =>
    setD((x) => ({ ...x, branding: { ...x.branding, colors: { ...x.branding.colors, [k]: v } } }));
  const setTerm = (k: TermKey, form: "one" | "other", v: string) =>
    setD((x) => ({ ...x, terminology: { ...x.terminology, [k]: { ...x.terminology[k], [form]: v } } }));

  const colorsValid = COLOR_FIELDS.every((f) => isHexColor(d.branding.colors[f.key]));

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!colorsValid) return setMsg({ ok: false, text: "Fix invalid colors first" });
    setBusy(true);
    setMsg(null);
    const res = await saveTenantBranding({
      name: d.name,
      sport: d.sport || null,
      branding: {
        logoUrl: d.branding.logoUrl ?? "",
        faviconUrl: d.branding.faviconUrl ?? "",
        darkMode: d.branding.darkMode,
        colors: Object.fromEntries(Object.entries(d.branding.colors).map(([k, v]) => [k, normalizeHex(v)])) as TenantColors,
        fonts: d.branding.fonts,
      },
      terminology: d.terminology,
      country: d.country,
      currency: d.currency,
      defaultLocale: d.defaultLocale,
      supportedLocales: d.supportedLocales,
      timezone: d.timezone,
      acceptLowContrast: acceptLow,
    });
    setBusy(false);
    setMsg({ ok: res.ok, text: res.ok ? "Saved — the whole app now uses this branding" : res.error });
    if (res.ok) router.refresh();
  }

  const toggleLocale = (code: string) =>
    setD((x) => {
      const has = x.supportedLocales.includes(code);
      if (has && code === x.defaultLocale) return x;
      return { ...x, supportedLocales: has ? x.supportedLocales.filter((c) => c !== code) : [...x.supportedLocales, code] };
    });

  return (
    <form onSubmit={onSave} className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <fieldset disabled={!canEdit || busy} className="min-w-0 space-y-6">
        {/* Identity */}
        <Card>
          <CardHeader><CardTitle>Identity</CardTitle></CardHeader>
          <CardBody className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div><Label htmlFor="b-name">Organization name</Label><Input id="b-name" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></div>
              <div>
                <Label htmlFor="b-sport">Sport / activity</Label>
                <select id="b-sport" className={sel} value={d.sport ?? ""} onChange={(e) => setD({ ...d, sport: e.target.value || null })}>
                  <option value="">—</option>
                  {SPORTS.map((s) => <option key={s} value={s}>{s.replace("-", " ")}</option>)}
                </select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><Label htmlFor="b-logo">Logo URL</Label><Input id="b-logo" value={d.branding.logoUrl ?? ""} onChange={(e) => setBranding({ logoUrl: e.target.value || null })} placeholder="https://…/logo.png" /></div>
              <div><Label htmlFor="b-fav">Favicon URL</Label><Input id="b-fav" value={d.branding.faviconUrl ?? ""} onChange={(e) => setBranding({ faviconUrl: e.target.value || null })} placeholder="https://…/favicon.png" /></div>
            </div>
            <p className="text-xs text-ink-4">Square PNG/SVG works best. Used in the app, browser tab, invoices and emails.</p>
          </CardBody>
        </Card>

        {/* Colors */}
        <Card>
          <CardHeader>
            <CardTitle>Colors</CardTitle>
            <label className="flex items-center gap-2 text-sm text-ink-2">
              <input type="checkbox" checked={d.branding.darkMode} onChange={(e) => setBranding({ darkMode: e.target.checked })} /> Dark mode
            </label>
          </CardHeader>
          <CardBody className="space-y-5">
            <div className="flex flex-wrap gap-2">
              {THEME_PRESETS.map((p) => (
                <button key={p.id} type="button" onClick={() => setBranding({ colors: { ...p.colors }, darkMode: p.darkMode })}
                  className="flex items-center gap-2 rounded-full border border-line bg-surface-elevated px-3 py-1.5 text-xs text-ink-2 hover:text-ink">
                  <span className="flex">
                    {[p.colors.background, p.colors.primary, p.colors.accent].map((c, i) => (
                      <span key={i} className="-ml-1 h-3.5 w-3.5 rounded-full border border-line first:ml-0" style={{ background: c }} />
                    ))}
                  </span>
                  {p.label}
                </button>
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {COLOR_FIELDS.map((f) => {
                const v = d.branding.colors[f.key];
                const ok = isHexColor(v);
                return (
                  <div key={f.key}>
                    <Label htmlFor={`c-${f.key}`}>{f.label} <span className="text-ink-4">· {f.hint}</span></Label>
                    <div className="flex items-center gap-2">
                      <input type="color" aria-label={`${f.label} picker`} value={ok ? normalizeHex(v).toLowerCase() : "#000000"}
                        onChange={(e) => setColor(f.key, e.target.value.toUpperCase())}
                        className="h-10 w-11 shrink-0 cursor-pointer rounded border border-line bg-transparent" />
                      <Input id={`c-${f.key}`} value={v} onChange={(e) => setColor(f.key, e.target.value)} className={cn("tnum", !ok && "border-danger")} />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Contrast check */}
            <div className="rounded-md border border-line-soft">
              <div className="flex items-center justify-between border-b border-line-soft px-4 py-2.5">
                <span className="text-sm font-medium text-ink">Accessibility contrast (WCAG)</span>
                {failing.length ? <Badge tone="warning"><AlertTriangle className="h-3 w-3" /> {failing.length} issue{failing.length > 1 ? "s" : ""}</Badge> : <Badge tone="success"><CheckCircle2 className="h-3 w-3" /> All pass</Badge>}
              </div>
              <ul className="divide-y divide-line-soft">
                {checks.map((c) => (
                  <li key={c.label} className="flex items-center gap-3 px-4 py-2 text-sm">
                    <span className="flex h-7 w-12 shrink-0 items-center justify-center rounded border border-line text-xs font-semibold" style={{ background: c.bg, color: c.fg }}>Aa</span>
                    <span className="flex-1 text-ink-2">{c.label}</span>
                    <span className="tnum text-ink-3">{c.ratio.toFixed(2)}:1</span>
                    <Badge tone={c.ok ? "success" : "danger"}>{c.ok ? c.grade : `needs ${c.min}:1`}</Badge>
                  </li>
                ))}
              </ul>
              {failing.length > 0 && (
                <label className="flex items-center gap-2 border-t border-line-soft px-4 py-2.5 text-xs text-ink-3">
                  <input type="checkbox" checked={acceptLow} onChange={(e) => setAcceptLow(e.target.checked)} /> Save anyway (not recommended — some people won&apos;t be able to read the app)
                </label>
              )}
            </div>
          </CardBody>
        </Card>

        {/* Fonts */}
        <Card>
          <CardHeader><CardTitle>Typography</CardTitle></CardHeader>
          <CardBody>
            <div className="grid gap-4 sm:grid-cols-3">
              {(["display", "ui", "mono"] as const).map((k) => (
                <div key={k}>
                  <Label htmlFor={`f-${k}`}>{k === "display" ? "Headings" : k === "ui" ? "Interface" : "Numbers / mono"}</Label>
                  <Input id={`f-${k}`} list="font-choices" value={d.branding.fonts[k]}
                    onChange={(e) => setBranding({ fonts: { ...d.branding.fonts, [k]: e.target.value } })} />
                </div>
              ))}
              <datalist id="font-choices">{FONT_CHOICES.map((f) => <option key={f} value={f} />)}</datalist>
            </div>
            <p className="mt-3 text-xs text-ink-4">Any Google Fonts family name. Loaded automatically.</p>
          </CardBody>
        </Card>

        {/* Terminology */}
        <Card>
          <CardHeader><CardTitle>Terminology</CardTitle></CardHeader>
          <CardBody className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {TERMINOLOGY_PRESETS.map((p) => (
                <button key={p.id} type="button" onClick={() => setD({ ...d, terminology: { ...DEFAULT_TERMINOLOGY, ...p.terms } })}
                  className="rounded-full border border-line bg-surface-elevated px-3 py-1.5 text-xs text-ink-2 hover:text-ink">{p.label}</button>
              ))}
            </div>
            <div className="grid gap-x-4 gap-y-3 sm:grid-cols-[160px_1fr_1fr]">
              <span className="hidden text-xs text-ink-4 sm:block">Concept</span>
              <span className="hidden text-xs text-ink-4 sm:block">Singular</span>
              <span className="hidden text-xs text-ink-4 sm:block">Plural</span>
              {TERM_KEYS.map((k) => (
                <React.Fragment key={k}>
                  <span className="self-center text-sm text-ink-2">{TERM_LABELS[k]}</span>
                  <Input aria-label={`${TERM_LABELS[k]} singular`} value={d.terminology[k].one} onChange={(e) => setTerm(k, "one", e.target.value)} />
                  <Input aria-label={`${TERM_LABELS[k]} plural`} value={d.terminology[k].other} onChange={(e) => setTerm(k, "other", e.target.value)} />
                </React.Fragment>
              ))}
            </div>
          </CardBody>
        </Card>

        {/* Locale */}
        <Card>
          <CardHeader><CardTitle>Region, language &amp; currency</CardTitle></CardHeader>
          <CardBody className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div><Label htmlFor="l-country">Country (ISO)</Label><Input id="l-country" maxLength={2} value={d.country} onChange={(e) => setD({ ...d, country: e.target.value.toUpperCase() })} placeholder="CH" /></div>
              <div>
                <Label htmlFor="l-cur">Currency</Label>
                <select id="l-cur" className={sel} value={d.currency} onChange={(e) => setD({ ...d, currency: e.target.value })}>
                  {Array.from(new Set([d.currency, ...SUPPORTED_CURRENCIES])).map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <Label htmlFor="l-loc">Default language</Label>
                <select id="l-loc" className={sel} value={d.defaultLocale}
                  onChange={(e) => setD({ ...d, defaultLocale: e.target.value, supportedLocales: d.supportedLocales.includes(e.target.value) ? d.supportedLocales : [e.target.value, ...d.supportedLocales] })}>
                  {Array.from(new Set([d.defaultLocale, ...SUPPORTED_LOCALES.map((l) => l.code)])).map((c) => (
                    <option key={c} value={c}>{SUPPORTED_LOCALES.find((l) => l.code === c)?.label ?? c}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="l-tz">Timezone</Label>
                <select id="l-tz" className={sel} value={d.timezone} onChange={(e) => setD({ ...d, timezone: e.target.value })}>
                  {Array.from(new Set([d.timezone, ...COMMON_TIMEZONES])).map((z) => <option key={z} value={z}>{z}</option>)}
                </select>
              </div>
            </div>
            <div>
              <Label>Available languages</Label>
              <div className="flex flex-wrap gap-2">
                {SUPPORTED_LOCALES.map((l) => {
                  const on = d.supportedLocales.includes(l.code);
                  return (
                    <button key={l.code} type="button" onClick={() => toggleLocale(l.code)}
                      className={cn("rounded-full border px-3 py-1 text-xs", on ? "border-maroon bg-maroon-soft text-inverse" : "border-line text-ink-3 hover:text-ink")}>
                      {l.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Platform-managed */}
        <Card>
          <CardHeader><CardTitle>Address &amp; plan</CardTitle><Lock className="h-4 w-4 text-ink-4" /></CardHeader>
          <CardBody className="grid gap-3 text-sm sm:grid-cols-2">
            <Info k="Workspace address" v={platform.rootDomain ? `${platform.slug}.${platform.rootDomain}` : platform.slug} />
            <Info k="Custom domain" v={platform.customDomain ?? "Not configured"} />
            <Info k="Plan" v={platform.plan} />
            <Info k="Status" v={platform.status} />
            <Info k="Data region" v={platform.dataRegion.toUpperCase()} />
            <p className="text-xs text-ink-4 sm:col-span-2">Managed by the platform. Contact support to connect a custom domain or change plan.</p>
          </CardBody>
        </Card>

        {canEdit ? (
          <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-3 border-t border-line bg-bg/95 px-1 py-3 backdrop-blur">
            <Button type="submit" disabled={busy || !dirty || !colorsValid || (failing.length > 0 && !acceptLow)}>{busy ? "Saving…" : "Save branding"}</Button>
            <Button type="button" variant="ghost" disabled={!dirty || busy} onClick={() => { setD(initial); setMsg(null); }}><RotateCcw className="h-4 w-4" /> Reset</Button>
            {msg && <span className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</span>}
          </div>
        ) : (
          <p className="text-sm text-ink-3">Only admins can change branding.</p>
        )}
      </fieldset>

      <div className="xl:sticky xl:top-6 xl:self-start">
        <LivePreview draft={d} />
      </div>
    </form>
  );
}

function Info({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-xs text-ink-4">{k}</div>
      <div className="text-ink">{v}</div>
    </div>
  );
}

/**
 * Live preview: the draft's CSS variables are applied to this subtree only,
 * so the real Tailwind tokens (bg-bg, text-ink, bg-maroon…) render exactly as
 * they will app-wide after saving.
 */
function LivePreview({ draft }: { draft: Draft }) {
  const vars = brandingToCssVars(draft.branding) as React.CSSProperties;
  const t = makeTerm(draft.terminology);
  const fontsHref = googleFontsHref(draft.branding);
  let money = "";
  try {
    money = new Intl.NumberFormat(draft.defaultLocale, { style: "currency", currency: draft.currency }).format(1250);
  } catch {
    money = `${draft.currency} 1250.00`;
  }
  let when = "";
  try {
    when = new Intl.DateTimeFormat(draft.defaultLocale, { dateStyle: "medium", timeStyle: "short", timeZone: draft.timezone }).format(new Date());
  } catch {
    when = "";
  }
  const logo = draft.branding.logoUrl && /^(https:\/\/|\/)/.test(draft.branding.logoUrl) ? draft.branding.logoUrl : null;

  return (
    <div>
      {fontsHref && <link rel="stylesheet" href={fontsHref} precedence="default" />}
      <div className="mb-2 flex items-center justify-between text-xs text-ink-3"><span>Live preview</span><span>{draft.branding.darkMode ? "Dark" : "Light"}</span></div>
      <div style={vars} className="overflow-hidden rounded-lg border border-line bg-bg font-sans text-ink shadow-lg">
        <div className="flex items-center justify-between border-b border-line bg-bg-secondary px-4 py-3">
          <BrandMark name={draft.name || "Your club"} logoUrl={logo} />
          <span className="h-2 w-2 rounded-full bg-maroon" />
        </div>
        <div className="grid grid-cols-[110px_1fr]">
          <nav className="space-y-1 border-r border-line bg-bg-secondary p-2 text-xs">
            {[t("program", { plural: true }), t("athlete", { plural: true }), t("family", { plural: true }), "Payments"].map((l, i) => (
              <div key={l} className={cn("rounded px-2 py-1.5", i === 0 ? "bg-maroon-soft text-inverse" : "text-ink-2")}>{l}</div>
            ))}
          </nav>
          <div className="space-y-3 p-4">
            <div>
              <div className="font-display text-lg text-ink">{t("season")} 2026 · {t("program", { plural: true })}</div>
              <div className="text-xs text-ink-3">{when}</div>
            </div>
            <div className="rounded-md border border-line bg-surface p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-ink">U14 {t("program")}</span>
                <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: "color-mix(in srgb, var(--brand-accent) 14%, transparent)", color: "var(--brand-accent-text)" }}>Featured</span>
              </div>
              <div className="mt-1 text-xs text-ink-2">18 {t("athlete", { plural: true, case: "lower" })} · 2 {t("coach", { plural: true, case: "lower" })}</div>
              <div className="tnum mt-2 font-mono text-sm text-maroon">{money}</div>
            </div>
            <div className="flex gap-2">
              <span className="inline-flex h-8 items-center rounded bg-maroon px-3 text-xs font-medium text-inverse shadow-glow-red">Register</span>
              <span className="inline-flex h-8 items-center rounded border border-line bg-surface-elevated px-3 text-xs text-ink">Message {t("guardian", { plural: true, case: "lower" })}</span>
            </div>
            <div className="rounded border border-line bg-surface-input px-3 py-2 text-xs text-ink-3">Search {t("athlete", { plural: true, case: "lower" })}…</div>
          </div>
        </div>
      </div>
    </div>
  );
}
