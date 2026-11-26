# Adding a language

The product is sold country by country (Switzerland first, then the EU track,
then the USA, each behind a gate in `docs/company/00_EXECUTIVE_PLAN.md`).
Languages are data, not code: **one catalog file + one registry entry**, then a
generator run. Nothing else changes: the settings picker, the language
switcher, negotiation, emails, PDFs, the checker and the coverage report all
read the registry.

See also `docs/i18n.md` (how the runtime works).

## The pieces

| File | What it is |
|---|---|
| `src/lib/i18n/languages.ts` | Registry: tag, English and native name, direction, fallback chain, catalog status, default region, overlay base/transform, auto-regions |
| `src/messages/<tag>.json` | Catalog. `en.json` is the source (US English); base catalogs are complete key sets; regional variants are thin overlays |
| `src/messages/overlays/<tag>.terms.json` | Hand-written regional terms for **generated** overlays (de-CH, en-GB) |
| `src/messages/index.ts` | Generated catalog index (do not edit) |
| `scripts/i18n-sync.mjs` | Regenerates generated overlays + the index |
| `scripts/i18n-check.mjs` | CI gate (`npm run i18n:check -- --strict`) |
| `scripts/i18n-coverage.mjs` | % translated + missing keys per language |
| `scripts/i18n-export.mjs`, `scripts/i18n-import.mjs` | Exchange with translators (JSON or XLIFF 1.2) |

## Catalog status and the quality rule

| Status | Meaning | Checker |
|---|---|---|
| `none` | Planned. No file. Shown under "Coming later" in Settings → Languages, not selectable | Fails if a file exists |
| `partial` | **Beta.** Selectable with a "Beta" badge; missing keys fall back along the chain, finally to English | Missing keys allowed (reported) |
| `complete` | Every key present **and reviewed by a native speaker** | 0 missing keys, or CI fails |

**Machine drafts are allowed only as `partial`/beta.** A language moves to
`complete` only after a native speaker has reviewed the whole catalog (and the
emails and invoice PDF rendered in it). `i18n:import -- --machine` (or XLIFF
units in state `needs-review-translation`) is refused for a `complete`
language. Legal texts (terms, privacy notices, consent wording) are never
machine-translated: they are translated only from lawyer-approved source text.

## Steps: a new base language (example: Dutch, `nl`)

1. **Registry**: the entry exists with `status: "none"`; change it to
   `"partial"` (new languages: add one entry, e.g.
   `{ tag: "nl", englishName: "Dutch", nativeName: "Nederlands", dir: "ltr", status: "partial", fallback: ["en"], region: "NL" }`).
2. **Export for the translator**:
   `npm run i18n:export -- --lang nl --format xliff --out nl.xlf`
   (`--missing-only` for later rounds). Each unit carries the English source
   and a note with the placeholders to keep (`{name}`, `{count, plural, …}`).
3. **Import**: `npm run i18n:import -- nl.xlf` (add `--machine` for a machine
   draft). Units with broken placeholders or plural blocks without `other` are
   rejected and listed. This writes `src/messages/nl.json`.
4. `npm run i18n:sync` (adds it to `src/messages/index.ts`).
5. `npm run i18n:coverage` and `npm run i18n:check -- --strict`.
6. Native-speaker review: app walk-through, every email template, an invoice
   PDF with a QR-bill (if CHF/EUR), the registration flow. Fix, re-import.
7. Set `status: "complete"`. From now on `tsc` and the checker require every
   new key in this catalog.

Formatting needs nothing: numbers, dates and money use `Intl` with the
language and the club's region (`nl` + `BE` → `nl-BE`), currency from the club.

## Steps: a regional variant (example: Austrian German, `de-AT`)

Only when wording or spelling really differs from the base (otherwise the
club just picks region AT for "Deutsch": formats follow automatically).

- **Hand-written overlay** (`transform: "none"`): add
  `{ tag: "de-AT", englishName: "German (Austria)", nativeName: "Deutsch (Österreich)", dir: "ltr", status: "complete", fallback: ["de", "en"], region: "AT", overlay: { base: "de", transform: "none" }, autoForRegions: ["AT"] }`
  and `src/messages/de-AT.json` with only the keys that differ (Jänner,
  Matura …). Run `npm run i18n:sync`.
- **Generated overlay** (a mechanical rule over the whole base, like
  `swiss-german` "ß" → "ss" or `british-english` spelling): add the transform
  to `src/lib/i18n/overlay-transforms.ts` (with a unit test), regional terms
  to `src/messages/overlays/<tag>.terms.json`, run `npm run i18n:sync`.
  Never edit the generated `<tag>.json` by hand; the checker fails when it
  drifts from base + terms.

`autoForRegions` makes a club in that region get the variant when it simply
enables the base language (a Swiss club enabling "Deutsch" gets de-CH).

## Right-to-left languages

Set `dir: "rtl"` in the registry (`ar` is already planned that way).
`<html dir>` follows, layout uses logical utilities (`ms-/me-/ps-/pe-`,
`start-/end-`, `border-s/e`, `text-start/end`) and `rtl:` variants. Before
moving an RTL language past `partial`: review the shells, tables, the invoice
PDF (pdf-lib standard fonts cannot shape Arabic/Hebrew: embed a font with the
script and test) and emails in a real RTL client.

## Launch plan (dates from `00_EXECUTIVE_PLAN.md`, base / downside)

| Phase | Languages | Status today | Condition |
|---|---|---|---|
| **Switzerland, now** | de (de-CH), fr (fr-CH), it (it-CH), en (en-GB for Swiss/European clubs) | complete | FR/DE/EN for parent registration, invoices and reminders by 28 Feb 2027; Italian for Ticino (GTM plans 2028; catalog ready) |
| **EU track** (EUR gate: ≥10 paying Swiss clubs; first paid EUR club Q2 2028) | fr (France), de (Germany/Austria) from the base catalogs; then nl (Benelux), it (northern Italy), pt, pl, sv, da as markets open | fr/de/it complete; es beta; nl, pt, pl, sv, da planned | Each new language: native review before `complete`; DPA/terms in that language from lawyer-approved text |
| **USA** (discounted design-partner pilot from fall 2027; paid US gate not before H2 2029) | en (US English, the source catalog); es (US Spanish) later | en complete; es beta | COPPA/FERPA wording reviewed by counsel before any US launch |

Rules of thumb: add a language when a signed or gated market needs it, not
before; a language a club can see must be at least `partial`, and a launch
language must be `complete`.
