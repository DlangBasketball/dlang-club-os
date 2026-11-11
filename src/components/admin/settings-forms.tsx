"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardBody, Button, Input, Label } from "@/components/ui";
import {
  updateClubProfile, updateBranding, updateVenues, updateLocalization,
  updatePaymentInstructions, updateInvoiceSettings, updateTax, updatePrivacy, updateRetention,
} from "@/lib/actions/settings";
import type { ClubSettings, Venue } from "@/lib/data/settings";

type Res = { ok: boolean; error?: string };
function useSaver() {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  async function run(fn: () => Promise<Res>) {
    setBusy(true); setMsg(null);
    const res = await fn();
    setBusy(false);
    setMsg({ ok: res.ok, text: res.ok ? "Saved" : res.error ?? "Failed" });
    if (res.ok) router.refresh();
  }
  return { busy, msg, run };
}
function SaveRow({ busy, msg, label = "Save changes" }: { busy: boolean; msg: { ok: boolean; text: string } | null; label?: string }) {
  return (
    <div className="flex items-center gap-3">
      <Button type="submit" disabled={busy}>{busy ? "Saving…" : label}</Button>
      {msg && <span className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</span>}
    </div>
  );
}
const sel = "mt-1 w-full rounded border border-line bg-surface-input px-3 py-2 text-sm text-ink";

export function ClubProfileForm({ s }: { s: ClubSettings }) {
  const { busy, msg, run } = useSaver();
  const [f, setF] = React.useState({ ...s.profile });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Card className="max-w-2xl">
      <CardHeader><CardTitle>Club profile</CardTitle></CardHeader>
      <CardBody>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run(() => updateClubProfile(f)); }}>
          <div><Label>Club name</Label><Input value={f.name} onChange={set("name")} /></div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div><Label>Legal name</Label><Input value={f.legalName} onChange={set("legalName")} /></div>
            <div><Label>Country</Label><Input value={f.country} onChange={set("country")} placeholder="CH" /></div>
          </div>
          <div><Label>Address</Label><Input value={f.address} onChange={set("address")} placeholder="Rue du Sport 1, 1200 Genève" /></div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div><Label>Contact email</Label><Input type="email" value={f.contactEmail} onChange={set("contactEmail")} /></div>
            <div><Label>Contact phone</Label><Input value={f.contactPhone} onChange={set("contactPhone")} /></div>
          </div>
          <div><Label>Website</Label><Input value={f.website} onChange={set("website")} placeholder="https://…" /></div>
          <SaveRow busy={busy} msg={msg} />
        </form>
      </CardBody>
    </Card>
  );
}

export function BrandingForm({ s }: { s: ClubSettings }) {
  const { busy, msg, run } = useSaver();
  const [color, setColor] = React.useState(s.brand.primaryColor);
  const [logo, setLogo] = React.useState(s.brand.logoUrl);
  return (
    <Card className="max-w-2xl">
      <CardHeader><CardTitle>Logo & brand color</CardTitle></CardHeader>
      <CardBody>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run(() => updateBranding({ primaryColor: color, logoUrl: logo })); }}>
          <div className="flex items-end gap-3">
            <div className="flex-1"><Label>Primary color</Label><Input value={color} onChange={(e) => setColor(e.target.value)} placeholder="#DA2627" className="tnum" /></div>
            <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : "#DA2627"} onChange={(e) => setColor(e.target.value)} className="h-10 w-12 rounded border border-line bg-transparent" aria-label="Pick color" />
            <div className="h-10 w-10 rounded border border-line" style={{ background: /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#DA2627" }} />
          </div>
          <div><Label>Logo URL</Label><Input value={logo} onChange={(e) => setLogo(e.target.value)} placeholder="https://…/logo.png" /></div>
          <p className="text-xs text-ink-4">Used on invoices, emails and public registration pages.</p>
          <SaveRow busy={busy} msg={msg} />
        </form>
      </CardBody>
    </Card>
  );
}

export function VenuesEditor({ s }: { s: ClubSettings }) {
  const { busy, msg, run } = useSaver();
  const [venues, setVenues] = React.useState<Venue[]>(s.venues.length ? s.venues : []);
  const update = (i: number, k: keyof Venue, v: string) => setVenues(venues.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <Card className="max-w-2xl">
      <CardHeader><CardTitle>Venues</CardTitle></CardHeader>
      <CardBody>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(() => updateVenues(venues)); }}>
          {venues.length === 0 && <p className="text-sm text-ink-3">No venues yet.</p>}
          {venues.map((v, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input value={v.name} onChange={(e) => update(i, "name", e.target.value)} placeholder="Venue name" />
              <Input value={v.address} onChange={(e) => update(i, "address", e.target.value)} placeholder="Address" />
              <Button type="button" size="sm" variant="ghost" onClick={() => setVenues(venues.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 className="h-4 w-4 text-danger" /></Button>
            </div>
          ))}
          <Button type="button" size="sm" variant="secondary" onClick={() => setVenues([...venues, { name: "", address: "" }])}><Plus className="h-4 w-4" /> Add venue</Button>
          <SaveRow busy={busy} msg={msg} label="Save venues" />
        </form>
      </CardBody>
    </Card>
  );
}

const ALL_LANGS = [{ k: "en", l: "English" }, { k: "fr", l: "Français" }, { k: "de", l: "Deutsch" }, { k: "it", l: "Italiano" }];
export function LocalizationForm({ s }: { s: ClubSettings }) {
  const { busy, msg, run } = useSaver();
  const [currency, setCurrency] = React.useState(s.localization.currency);
  const [locale, setLocale] = React.useState(s.localization.defaultLocale);
  const [langs, setLangs] = React.useState<string[]>(s.localization.languages);
  const toggle = (k: string) => setLangs(langs.includes(k) ? langs.filter((x) => x !== k) : [...langs, k]);
  return (
    <Card className="max-w-2xl">
      <CardHeader><CardTitle>Languages & currency</CardTitle></CardHeader>
      <CardBody>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run(() => updateLocalization({ currency, defaultLocale: locale, languages: langs })); }}>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Currency</Label><Input value={currency} onChange={(e) => setCurrency(e.target.value)} /></div>
            <div><Label>Default language</Label><select className={sel} value={locale} onChange={(e) => setLocale(e.target.value)}>{ALL_LANGS.map((l) => <option key={l.k} value={l.k}>{l.l}</option>)}</select></div>
          </div>
          <div>
            <Label>Enabled languages</Label>
            <div className="mt-1 flex flex-wrap gap-3">{ALL_LANGS.map((l) => (
              <label key={l.k} className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" checked={langs.includes(l.k)} onChange={() => toggle(l.k)} className="accent-maroon" /> {l.l}</label>
            ))}</div>
          </div>
          <SaveRow busy={busy} msg={msg} />
        </form>
      </CardBody>
    </Card>
  );
}

export function PaymentInstructionsForm({ s }: { s: ClubSettings }) {
  const { busy, msg, run } = useSaver();
  const [f, setF] = React.useState({ ...s.payments });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Card className="max-w-2xl">
      <CardHeader><CardTitle>Payment instructions</CardTitle></CardHeader>
      <CardBody>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run(() => updatePaymentInstructions(f)); }}>
          <div><Label>Creditor (payee)</Label><Input value={f.creditor} onChange={set("creditor")} /></div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div><Label>IBAN</Label><Input value={f.iban} onChange={set("iban")} className="tnum" /></div>
            <div><Label>QR-IBAN</Label><Input value={f.qrIban} onChange={set("qrIban")} className="tnum" /></div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div><Label>TWINT number</Label><Input value={f.twint} onChange={set("twint")} /></div>
            <div><Label>Reference type</Label><select className={sel} value={f.referenceType} onChange={set("referenceType")}><option value="QRR">QRR</option><option value="SCOR">SCOR</option><option value="NON">NON</option></select></div>
            <div><Label>Reference prefix</Label><Input value={f.referencePrefix} onChange={set("referencePrefix")} className="tnum" /></div>
          </div>
          <SaveRow busy={busy} msg={msg} />
        </form>
      </CardBody>
    </Card>
  );
}

const METHODS = ["card", "twint", "bank_transfer", "manual"];
export function InvoiceSettingsForm({ s }: { s: ClubSettings }) {
  const { busy, msg, run } = useSaver();
  const [pattern, setPattern] = React.useState(s.invoicing.pattern);
  const [next, setNext] = React.useState(s.invoicing.nextCounter);
  const [methods, setMethods] = React.useState<string[]>(s.acceptedMethods.length ? s.acceptedMethods : METHODS);
  const toggle = (m: string) => setMethods(methods.includes(m) ? methods.filter((x) => x !== m) : [...methods, m]);
  return (
    <Card className="max-w-2xl">
      <CardHeader><CardTitle>Invoice numbering</CardTitle></CardHeader>
      <CardBody>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run(() => updateInvoiceSettings({ pattern, nextCounter: next, acceptedMethods: methods })); }}>
          <div><Label>Number pattern</Label><Input value={pattern} onChange={(e) => setPattern(e.target.value)} className="tnum" /><p className="mt-1 text-xs text-ink-4">Tokens: <code>{"{YYYY}"}</code> year, <code>{"{####}"}</code> zero-padded counter.</p></div>
          <div><Label>Next invoice number</Label><Input type="number" min={1} value={next} onChange={(e) => setNext(Number(e.target.value))} className="tnum" /></div>
          <div><Label>Accepted payment methods</Label><div className="mt-1 flex flex-wrap gap-3">{METHODS.map((m) => (<label key={m} className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" checked={methods.includes(m)} onChange={() => toggle(m)} className="accent-maroon" /> {m}</label>))}</div></div>
          <SaveRow busy={busy} msg={msg} />
        </form>
      </CardBody>
    </Card>
  );
}

export function TaxForm({ s }: { s: ClubSettings }) {
  const { busy, msg, run } = useSaver();
  const [rate, setRate] = React.useState(s.tax.vatRate);
  const [num, setNum] = React.useState(s.tax.vatNumber);
  const [inclusive, setInclusive] = React.useState(s.tax.inclusive);
  return (
    <Card className="max-w-2xl">
      <CardHeader><CardTitle>Tax / VAT</CardTitle></CardHeader>
      <CardBody>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run(() => updateTax({ vatRate: rate, vatNumber: num, inclusive })); }}>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>VAT rate (%)</Label><Input type="number" step="0.1" min={0} max={100} value={rate} onChange={(e) => setRate(Number(e.target.value))} className="tnum" /></div>
            <div><Label>VAT number</Label><Input value={num} onChange={(e) => setNum(e.target.value)} placeholder="CHE-123.456.789" /></div>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" checked={inclusive} onChange={(e) => setInclusive(e.target.checked)} className="accent-maroon" /> Prices include VAT</label>
          <SaveRow busy={busy} msg={msg} />
        </form>
      </CardBody>
    </Card>
  );
}

export function PrivacyForm({ s }: { s: ClubSettings }) {
  const { busy, msg, run } = useSaver();
  const [att, setAtt] = React.useState(s.privacy.parentAttendanceVisible);
  const [media, setMedia] = React.useState(s.privacy.shareMediaInternally);
  return (
    <Card className="max-w-2xl">
      <CardHeader><CardTitle>Privacy settings</CardTitle></CardHeader>
      <CardBody>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(() => updatePrivacy({ parentAttendanceVisible: att, shareMediaInternally: media })); }}>
          <label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" checked={att} onChange={(e) => setAtt(e.target.checked)} className="accent-maroon" /> Parents can see their child&apos;s attendance</label>
          <label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" checked={media} onChange={(e) => setMedia(e.target.checked)} className="accent-maroon" /> Share media internally between coaches</label>
          <SaveRow busy={busy} msg={msg} />
        </form>
      </CardBody>
    </Card>
  );
}

export function RetentionForm({ s }: { s: ClubSettings }) {
  const { busy, msg, run } = useSaver();
  const [months, setMonths] = React.useState(s.retention.months);
  return (
    <Card className="max-w-2xl">
      <CardHeader><CardTitle>Data retention</CardTitle></CardHeader>
      <CardBody>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(() => updateRetention(months)); }}>
          <div><Label>Retain inactive records for (months)</Label><Input type="number" min={1} value={months} onChange={(e) => setMonths(Number(e.target.value))} className="tnum max-w-[140px]" /></div>
          <p className="text-xs text-ink-4">Swiss FADP / GDPR: records of former members are purged after this period.</p>
          <SaveRow busy={busy} msg={msg} />
        </form>
      </CardBody>
    </Card>
  );
}
